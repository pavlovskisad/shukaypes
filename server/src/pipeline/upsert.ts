// Dedupe + upsert logic. Every source (admin sideload today, automated scrapers
// later) funnels through here so we can't silently double-insert the same dog
// reported twice across Telegram + OLX + a shelter page.
//
// Dedupe rule: active dog with a similar name within 1500m and lastSeenAt
// within 7 days of the candidate is the same dog. "Similar" = case-insensitive
// substring match either way (so "Бусинка" matches "бусинка" matches "буся").
// Not perfect but fine for pilot volume (~dozens of posts/day in Kyiv).

import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, schema } from '../db/index.js';
import type { IngestAction, IngestResult, ParsedDog } from './types.js';

const DEDUPE_RADIUS_M = 1500;
const DEDUPE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Newer reposts of the same dog often have coords that drift 30-150m
// from the original — different parser run, slightly different landmark
// match, etc. Below this threshold we keep the existing pin coords and
// only refresh the other fields (description, urgency, photo, lastSeenAt).
// Above it, we treat it as a real geographic update and move the pin.
// Sightings (real user-driven moves) take a different code path
// (routes/sightings.ts) and are not subject to this threshold.
const POSITION_UPDATE_THRESHOLD_M = 150;

// Greater Kyiv bounding box — generous enough to include Vyshgorod,
// Brovary, Bucha, Boryspil, Vasylkiv approaches, but small enough to
// reject Dnipro / Kryvyi Rih / Lviv etc that occasionally slip past
// the title filter when a pet name happens to overlap. Pets whose
// parsed coords fall outside this box are skipped at upsert time;
// fallback-coord pets (geocode failure → city center) stay in because
// they're already filtered from /dogs/nearby on the way out.
const KYIV_BBOX = {
  north: 50.65,
  south: 50.20,
  west: 30.10,
  east: 30.90,
};
const FALLBACK_LAT = 50.4501;
const FALLBACK_LNG = 30.5234;

function inKyivBbox(lat: number, lng: number): boolean {
  return (
    lat >= KYIV_BBOX.south &&
    lat <= KYIV_BBOX.north &&
    lng >= KYIV_BBOX.west &&
    lng <= KYIV_BBOX.east
  );
}

function isFallbackCoord(lat: number, lng: number): boolean {
  return lat === FALLBACK_LAT && lng === FALLBACK_LNG;
}

interface UpsertInput {
  parsed: ParsedDog;
  source: string;          // 'admin-sideload' | 'telegram:<channel>' | 'olx' | ...
  reportedBy?: string | null; // user id if the sideload came from an authenticated user
}

export async function upsertLostDog({ parsed, source, reportedBy }: UpsertInput): Promise<IngestResult> {
  // Geo gate first — outside Greater Kyiv we don't want the pet on
  // the map at all. Fallback coords (geocode failure) are allowed
  // through; they're filtered from /dogs/nearby separately so they
  // never show but stay in the DB for audit.
  if (
    !isFallbackCoord(parsed.lastSeenLat, parsed.lastSeenLng) &&
    !inKyivBbox(parsed.lastSeenLat, parsed.lastSeenLng)
  ) {
    return {
      id: null,
      action: 'skipped',
      skipReason: `out-of-region (${parsed.lastSeenLat.toFixed(3)}, ${parsed.lastSeenLng.toFixed(3)})`,
      parsed,
    };
  }

  const lastSeenAt = new Date(parsed.lastSeenAt);
  const lastSeenMs = lastSeenAt.getTime();

  // Pull active-ish rows in the geographic window; dedupe in JS to keep the
  // SQL shape simple and portable. Volume is low enough that this is fine.
  const distExpr = sql<number>`(6371000 * acos(cos(radians(${parsed.lastSeenLat})) * cos(radians(last_seen_lat)) * cos(radians(last_seen_lng) - radians(${parsed.lastSeenLng})) + sin(radians(${parsed.lastSeenLat})) * sin(radians(last_seen_lat))))`;
  const candidates = await db
    .select({
      id: schema.lostDogs.id,
      name: schema.lostDogs.name,
      species: schema.lostDogs.species,
      lastSeenAt: schema.lostDogs.lastSeenAt,
      source: schema.lostDogs.source,
      dist: distExpr,
    })
    .from(schema.lostDogs)
    .where(and(eq(schema.lostDogs.status, 'active'), sql`${distExpr} < ${DEDUPE_RADIUS_M}`))
    .limit(20);

  const candidateName = parsed.name.toLowerCase().trim();
  const match = candidates.find((c) => {
    // A dog named Murka and a cat named Murka on the same block are two pets,
    // not a dedupe. Species must match before we consider anything a repost.
    if (c.species !== parsed.species) return false;
    const cn = c.name.toLowerCase().trim();
    const nameHit = cn === candidateName || cn.includes(candidateName) || candidateName.includes(cn);
    if (!nameHit) return false;
    const dt = Math.abs(c.lastSeenAt.getTime() - lastSeenMs);
    return dt < DEDUPE_WINDOW_MS;
  });

  if (match) {
    // Only refresh if the incoming post is newer. Keeps older re-posts from
    // pushing the search zone backward in time.
    if (lastSeenMs > match.lastSeenAt.getTime()) {
      // Two-tier update: small coord deltas (< POSITION_UPDATE_THRESHOLD_M)
      // are treated as parser noise and don't move the pin — the pet still
      // lives where the original post placed it. Bigger deltas (a real
      // geographic update via a follow-up post that mentions a new
      // landmark) do move it. Sightings take a separate code path
      // (routes/sightings.ts) and are not subject to this threshold.
      const coordDriftSmall =
        typeof match.dist === 'number' && match.dist < POSITION_UPDATE_THRESHOLD_M;
      const updateFields: Record<string, unknown> = {
        lastSeenAt,
        lastSeenDescription: parsed.lastSeenDescription,
        urgency: parsed.urgency === 'resolved' ? 'resolved' : parsed.urgency,
        searchZoneRadiusM: parsed.searchZoneRadiusM,
        status: parsed.urgency === 'resolved' ? 'found' : 'active',
        photoUrl: parsed.photoUrl ?? undefined,
      };
      if (!coordDriftSmall) {
        updateFields.lastSeenLat = parsed.lastSeenLat;
        updateFields.lastSeenLng = parsed.lastSeenLng;
      }
      await db
        .update(schema.lostDogs)
        .set(updateFields)
        .where(eq(schema.lostDogs.id, match.id));
      const action: IngestAction = 'updated';
      return { id: match.id, action, parsed };
    }
    return { id: match.id, action: 'duplicate', parsed };
  }

  // Fresh dog.
  const id = `${sourceSlug(source)}-${nanoid(10)}`;
  await db.insert(schema.lostDogs).values({
    id,
    name: parsed.name,
    species: parsed.species,
    breed: parsed.breed,
    emoji: parsed.emoji,
    photoUrl: parsed.photoUrl ?? null,
    lastSeenLat: parsed.lastSeenLat,
    lastSeenLng: parsed.lastSeenLng,
    lastSeenAt,
    lastSeenDescription: parsed.lastSeenDescription,
    urgency: parsed.urgency,
    searchZoneRadiusM: parsed.searchZoneRadiusM,
    rewardPoints: parsed.rewardPoints,
    source,
    status: parsed.urgency === 'resolved' ? 'found' : 'active',
    reportedBy: reportedBy ?? null,
  });
  return { id, action: 'inserted', parsed };
}

function sourceSlug(source: string): string {
  // Turn "telegram:poshuk_kyiv" → "telegram-poshuk-kyiv" so ids stay URL-safe.
  return source.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'dog';
}
