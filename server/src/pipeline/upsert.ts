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
import { findLandmark, jitterAround } from './landmarks.js';
import { isSamePet, DEDUPE_RADIUS_M } from './samePet.js';

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
// Exported because it is the project's one definition of "inside the
// map". /places/* uses it to refuse coordinates outside the city, which
// is what stops somebody walking the globe to force cache misses on a
// billable Google API. Two bounding boxes would drift, and then the
// ingest gate and the spend gate would disagree about where Kyiv is.
export const KYIV_BBOX = {
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
  // Somebody HAS this animal and wants its owner, rather than having lost
  // it. Decided from the LISTING TITLE by the caller, because that is
  // where the distinction is stated plainly — «песик (знайдений)» — and
  // the title is not part of ParsedDog.
  isFoundReport?: boolean;
}

export async function upsertLostDog({
  parsed,
  source,
  reportedBy,
  isFoundReport,
}: UpsertInput): Promise<IngestResult> {
  // Named-city gate, before the coord gate. The bbox check below can
  // only reject a pet whose coords resolved somewhere real, and a post
  // about a cat in Uzhhorod almost never geocodes to anything — it
  // lands on the fallback coord, which the bbox check deliberately lets
  // through. That combination is how 9+ out-of-city pets ended up
  // active on the Kyiv fallback pin. Reading the city out of the post
  // text catches them at the only point where the full text exists.
  if (parsed.outOfArea) {
    return {
      id: null,
      action: 'skipped',
      skipReason: `out-of-region (post names ${parsed.outOfArea.city} via "${parsed.outOfArea.token}")`,
      parsed,
    };
  }

  // Geo gate second — outside Greater Kyiv we don't want the pet on
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
  // ORDER BY distance, because without it the 20 rows are whichever 20
  // Postgres felt like returning. That is not a theoretical complaint:
  // 81 active pets share the exact ungeocoded fallback coordinate, so
  // for any pet landing there the candidate set was a lottery among
  // identically-placed rows, and the same input could dedupe differently
  // on two runs.
  //
  // The limit stays at 20 deliberately. The measured problem is not that
  // real duplicates are missed — only one genuine duplicate pair exists
  // in the whole active table — it is that the old identity rule merged
  // pets that were not the same animal. Widening the net would have made
  // that worse, not better.
  const candidates = await db
    .select({
      id: schema.lostDogs.id,
      name: schema.lostDogs.name,
      species: schema.lostDogs.species,
      breed: schema.lostDogs.breed,
      lastSeenAt: schema.lostDogs.lastSeenAt,
      source: schema.lostDogs.source,
      dist: distExpr,
    })
    .from(schema.lostDogs)
    .where(and(eq(schema.lostDogs.status, 'active'), sql`${distExpr} < ${DEDUPE_RADIUS_M}`))
    .orderBy(distExpr, schema.lostDogs.id)
    .limit(20);

  // Identity lives in pipeline/samePet.ts, which is a pure function with
  // its own fixture check. It used to be four lines inline here, and it
  // was wrong in the expensive direction: measured on production, three
  // of the four pairs it called the same pet were different animals.
  // Merging those would have overwritten one family's lost pet with
  // another's, and the losing record leaves no trace.
  const match = candidates.find((c) =>
    isSamePet(
      {
        name: c.name,
        species: c.species as ParsedDog['species'],
        breed: c.breed,
        lastSeenAtMs: c.lastSeenAt.getTime(),
      },
      {
        name: parsed.name,
        species: parsed.species,
        breed: parsed.breed,
        lastSeenAtMs: lastSeenMs,
      },
      typeof c.dist === 'number' ? c.dist : Number.POSITIVE_INFINITY,
    ),
  );

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
        photoFileId: parsed.photoFileId ?? undefined,
      };
      if (!coordDriftSmall) {
        // Same landmark-jitter the insert path uses, seeded by the
        // existing id so the dog stays at the same scattered point.
        const lm = findLandmark(parsed.lastSeenLat, parsed.lastSeenLng);
        const pin = lm || parsed.placementSource.startsWith('gazetteer-')
          ? jitterAround(parsed.lastSeenLat, parsed.lastSeenLng, match.id, 120)
          : { lat: parsed.lastSeenLat, lng: parsed.lastSeenLng };
        updateFields.lastSeenLat = pin.lat;
        updateFields.lastSeenLng = pin.lng;
        // The pin moved, so the record of what placed it moves too.
        updateFields.placementSource = placementLabel(parsed, lm?.name ?? null);
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
  // If the parser landed on one of the ~30 landmark coords (its
  // "good enough" geocoding for posts that don't mention an exact
  // street), jitter the pin ~120 m around the landmark so multiple
  // landmark-matched pets spread out instead of stacking on the
  // pixel. Seeded by the row id so re-upserts keep the same point.
  //
  // Gazetteer placements get the same jitter for the same reason: the
  // resolver hands back a place's centroid, so two pets lost on
  // «Троєщина» would otherwise sit on the identical pixel. 120 m is
  // cosmetic against any search zone (500 m floor).
  const landmark = findLandmark(parsed.lastSeenLat, parsed.lastSeenLng);
  const pin = landmark || parsed.placementSource.startsWith('gazetteer-')
    ? jitterAround(parsed.lastSeenLat, parsed.lastSeenLng, id, 120)
    : { lat: parsed.lastSeenLat, lng: parsed.lastSeenLng };
  await db.insert(schema.lostDogs).values({
    id,
    name: parsed.name,
    species: parsed.species,
    breed: parsed.breed,
    emoji: parsed.emoji,
    photoUrl: parsed.photoUrl ?? null,
    photoFileId: parsed.photoFileId ?? null,
    lastSeenLat: pin.lat,
    lastSeenLng: pin.lng,
    lastSeenAt,
    lastSeenDescription: parsed.lastSeenDescription,
    urgency: parsed.urgency,
    searchZoneRadiusM: parsed.searchZoneRadiusM,
    rewardPoints: parsed.rewardPoints,
    source,
    status: parsed.urgency === 'resolved' ? 'found' : 'active',
    isFoundReport: isFoundReport ?? false,
    reportedBy: reportedBy ?? null,
    placementSource: placementLabel(parsed, landmark?.name ?? null),
  });
  return { id, action: 'inserted', parsed };
}

// The parser labels its own placement ('gazetteer-marked:<name>',
// 'fall-through', …) but cannot tell a coordinate the model composed
// from one it copied out of the prompt's hints table — only this module
// checks the coord against LANDMARKS. Refine 'model-geo' to
// 'model-landmark:<name>' when that check fires, so the audit that used
// to prove landmark placement by re-deriving jitter for every pet can
// just count the column.
function placementLabel(parsed: ParsedDog, landmarkName: string | null): string {
  if (parsed.placementSource === 'model-geo' && landmarkName) {
    return `model-landmark:${landmarkName}`;
  }
  return parsed.placementSource;
}

function sourceSlug(source: string): string {
  // Turn "telegram:poshuk_kyiv" → "telegram-poshuk-kyiv" so ids stay URL-safe.
  return source.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'dog';
}
