// THE PART OF THE LOST-PET AUDIT THAT NEEDS NOTHING BUT THE DATABASE.
//
// The sweep script asks two kinds of question. One kind needs the open
// internet — is this photo still there, is this ad still in Kyiv — and
// takes minutes, because it is hundreds of polite sequential requests.
// The other kind is just counting rows, and every question worth asking
// repeatedly turns out to be that kind: how many pets can the map
// actually draw, when did each source last bring one in, what are the
// invisible ones actually made of.
//
// Those answers were only reachable by SSHing into the production
// machine and running a CLI, which means they were only reachable from
// a laptop, which means in practice they were reachable rarely. So the
// counting half lives here, returns data rather than printing it, and
// has two front doors: the CLI still prints it, and an admin endpoint
// serves it as JSON.
//
// Deliberately read-only. Nothing in this file writes, so exposing it
// over HTTP costs nothing but the reading of it.

import { and, desc, eq, ne } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

// Where the parser puts a pet whose post it could not place: Kyiv's
// centre, exactly. /dogs/nearby and /sync/map filter this pin out rather
// than pile every ungeocoded pet on one spot — so these rows are in the
// table, counted as active, and invisible to the app.
export const FALLBACK_LAT = 50.4501;
export const FALLBACK_LNG = 30.5234;
// Past this, a source is not producing any more.
const STALE_DAYS = 3;
// /dogs/nearby is radius-bounded; nothing this far out is ever drawn.
const FAR_OUT_M = 60_000;

export interface AuditRow {
  id: string;
  name: string;
  photoUrl: string | null;
  urgency: string;
  source: string;
  lat: number;
  lng: number;
  description: string | null;
  // Filled from scrape_log by the caller that needs it (the network
  // sweep); the counting half has no use for it.
  sourceUrl?: string | null;
}

export interface LostDogsReport {
  activeTotal: number;
  bySource: { source: string; count: number }[];
  invisible: {
    onFallbackPin: number;
    beyond60km: number;
  };
  heartbeat: {
    source: string;
    newestAgeDays: number;
    stale: boolean;
  }[];
  fallbackPin: {
    byUrgency: {
      urgency: string;
      count: number;
      samples: { name: string; description: string | null }[];
    }[];
    withoutDescription: number;
  };
}

export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

export function onFallbackPin(r: { lat: number; lng: number }): boolean {
  return r.lat === FALLBACK_LAT && r.lng === FALLBACK_LNG;
}

// Every active pet that did not come from a human using the app.
//
// Matched by excluding 'in_app' rather than by naming the scrapers:
// lost_dogs.source stores whatever the ingest was called — 'olx',
// 'telegram:<channel>', 'admin-sideload' — never the literal 'scrape'
// the column comment implies.
export async function loadAuditRows(): Promise<AuditRow[]> {
  return db
    .select({
      id: schema.lostDogs.id,
      name: schema.lostDogs.name,
      photoUrl: schema.lostDogs.photoUrl,
      urgency: schema.lostDogs.urgency,
      source: schema.lostDogs.source,
      lat: schema.lostDogs.lastSeenLat,
      lng: schema.lostDogs.lastSeenLng,
      description: schema.lostDogs.lastSeenDescription,
    })
    .from(schema.lostDogs)
    .where(and(eq(schema.lostDogs.status, 'active'), ne(schema.lostDogs.source, 'in_app')));
}

export async function buildLostDogsReport(
  rows: AuditRow[],
  nowMs: number,
): Promise<LostDogsReport> {
  const bySourceMap = new Map<string, number>();
  for (const r of rows) bySourceMap.set(r.source, (bySourceMap.get(r.source) ?? 0) + 1);

  const fallback = rows.filter(onFallbackPin);
  const farOut = rows.filter(
    (r) => !onFallbackPin(r) && haversineM(r.lat, r.lng, FALLBACK_LAT, FALLBACK_LNG) > FAR_OUT_M,
  );

  // A scraper that stops working does not announce it, and the only
  // externally visible symptom is that the newest pet stops moving.
  const newest = await db
    .select({ source: schema.lostDogs.source, createdAt: schema.lostDogs.createdAt })
    .from(schema.lostDogs)
    .orderBy(desc(schema.lostDogs.createdAt));
  const latestBySource = new Map<string, Date>();
  for (const n of newest) {
    if (!latestBySource.has(n.source)) latestBySource.set(n.source, n.createdAt);
  }

  // Two populations land on the fallback pin and want opposite fixes: a
  // real lost pet the geocoder couldn't place (rescue it) and a rehoming
  // ad the parser parked there on purpose but upsert left as `active`
  // (expire it). Urgency separates them without guessing.
  const byUrgencyMap = new Map<string, AuditRow[]>();
  for (const r of fallback) {
    const list = byUrgencyMap.get(r.urgency) ?? [];
    list.push(r);
    byUrgencyMap.set(r.urgency, list);
  }

  return {
    activeTotal: rows.length,
    bySource: [...bySourceMap]
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count),
    invisible: { onFallbackPin: fallback.length, beyond60km: farOut.length },
    heartbeat: [...latestBySource]
      .map(([source, at]) => {
        const newestAgeDays = (nowMs - at.getTime()) / 86_400_000;
        return { source, newestAgeDays, stale: newestAgeDays > STALE_DAYS };
      })
      .sort((a, b) => a.newestAgeDays - b.newestAgeDays),
    fallbackPin: {
      byUrgency: [...byUrgencyMap]
        .map(([urgency, list]) => ({
          urgency,
          count: list.length,
          samples: list.slice(0, 3).map((r) => ({
            name: r.name,
            description: r.description?.replace(/\s+/g, ' ').slice(0, 160) ?? null,
          })),
        }))
        .sort((a, b) => b.count - a.count),
      withoutDescription: fallback.filter((r) => !r.description?.trim()).length,
    },
  };
}

// One text rendering, shared by the CLI and the endpoint, so the two can
// never drift into describing the same database differently.
export function formatLostDogsReport(rep: LostDogsReport): string {
  const out: string[] = [];
  out.push(`  ${rep.activeTotal} active pets to check`);
  for (const s of rep.bySource) out.push(`     ${s.count}\t${s.source}`);
  if (rep.activeTotal === 0) {
    out.push('  (nothing matched — check lost_dogs.source values before trusting this)');
  }
  out.push('  of those, invisible to the map:');
  out.push(`     ${rep.invisible.onFallbackPin}\tsitting on the ungeocoded fallback pin`);
  out.push(`     ${rep.invisible.beyond60km}\tmore than 60km from the city centre`);
  out.push('');
  out.push('  newest pet per source (ingest heartbeat):');
  for (const h of rep.heartbeat) {
    out.push(
      `     ${h.newestAgeDays.toFixed(1)}d ago\t${h.source}${h.stale ? '  <-- STALE' : ''}`,
    );
  }
  out.push('');
  if (rep.invisible.onFallbackPin > 0) {
    out.push('  the fallback-pin pets, by urgency:');
    for (const u of rep.fallbackPin.byUrgency) {
      out.push(`     ${u.count}\t${u.urgency}`);
      for (const s of u.samples) {
        out.push(`        · ${s.name} — ${s.description ?? '(no description)'}`);
      }
    }
    out.push(
      `     (${rep.fallbackPin.withoutDescription} of them have no description text to re-geocode from)`,
    );
    out.push('');
  }
  return out.join('\n');
}
