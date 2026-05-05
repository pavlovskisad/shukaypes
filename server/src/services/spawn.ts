import { and, eq, isNull, not, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, schema } from '../db/index.js';
import { balance } from '../config/balance.js';
import type { LatLng } from '../utils/geo.js';
import { distanceMeters, scatter, scatterInRadius } from '../utils/geo.js';
import {
  shouldTopupUserArea,
  noteUserAreaTopup,
  parkPawsGate,
  parkBonesGate,
  dogZoneGate,
} from './spawnCooldown.js';

// Server-side dedup threshold for the parks the client passes in.
// The client already collapses Places entries within 120m, but Google
// occasionally returns the same physical park at slightly different
// coords across syncs (sub-section + entrance + plaza for one big
// area). When per-park bones/paws spawn off each of those entries,
// you end up with 4-6 bones piled in a small disk. 150m is wide enough
// to absorb that drift without merging legitimately distinct parks
// that survived the client's tighter 120m pass.
const SERVER_PARK_DEDUP_M = 150;
function dedupeParks(parks: LatLng[]): LatLng[] {
  const out: LatLng[] = [];
  for (const p of parks) {
    if (out.some((q) => distanceMeters(q, p) < SERVER_PARK_DEDUP_M)) continue;
    out.push(p);
  }
  return out;
}

// Parser landmark fallback used by the OLX pipeline. Pets at the exact
// Kyiv city-center coord are low-signal (no real geography in the post),
// so we skip seeding zones for them — otherwise they'd all overlap and
// the per-pet pool would just dump paws at one landmark.
const FALLBACK_LAT = 50.4501;
const FALLBACK_LNG = 30.5234;

function haversineSql(a: LatLng, colLat: unknown, colLng: unknown) {
  return sql<number>`(
    2 * 6371000 * ASIN(SQRT(
      POWER(SIN(RADIANS(${a.lat} - ${colLat}) / 2), 2)
      + COS(RADIANS(${a.lat})) * COS(RADIANS(${colLat}))
      * POWER(SIN(RADIANS(${a.lng} - ${colLng}) / 2), 2)
    ))
  )`;
}

function buildTokenRows(userId: string, positions: LatLng[]) {
  return positions.map((p) => ({
    id: nanoid(),
    ownerId: userId,
    type: 'regular' as const,
    lat: p.lat,
    lng: p.lng,
    value: 1 + Math.floor(Math.random() * 3),
  }));
}

export async function ensureTokensForUser(
  userId: string,
  center: LatLng,
  parks: LatLng[] = [],
) {
  parks = dedupeParks(parks);
  // 1. Age out uncollected tokens older than `tokenExpireMinutes`. The
  // previous distance-based cull didn't fit the new pool model — a paw
  // seeded inside a dog's zone 3km from the walker is legitimate even
  // when the walker is elsewhere. Time-based expiry keeps the set
  // bounded without touching pool correctness. The cutoff is computed
  // in SQL via make_interval — postgres-js 3.4 rejects JS Date bind
  // params and would 500 the whole /tokens/nearby call (paws vanish
  // client-side because the sync errors).
  await db
    .update(schema.tokens)
    .set({ collectedAt: new Date() })
    .where(
      and(
        eq(schema.tokens.ownerId, userId),
        isNull(schema.tokens.collectedAt),
        sql`${schema.tokens.spawnedAt} < NOW() - make_interval(mins => ${balance.tokenExpireMinutes})`,
      ),
    );

  // 2. User-area pool — base supply around the walker, with radial
  // bias so it's denser near them and thins out toward the edge.
  // Gated by movement+time: only refills if the walker has actually
  // moved >userAreaMovementThresholdM since the last topup, OR
  // userAreaCooldownMs has elapsed. Without this, every 15s sync
  // refilled paws the user just collected and the count never went
  // down — undermining the whole "made progress" feeling.
  const userAreaOk = await shouldTopupUserArea(userId, center);
  if (userAreaOk) {
    const userDistExpr = haversineSql(center, schema.tokens.lat, schema.tokens.lng);
    const userRows = await db
      .select({ live: sql<number>`count(*)::int` })
      .from(schema.tokens)
      .where(
        and(
          eq(schema.tokens.ownerId, userId),
          isNull(schema.tokens.collectedAt),
          sql`${userDistExpr} <= ${balance.userAreaRadiusM}`,
        ),
      );
    const userLive = userRows[0]?.live ?? 0;
    if (userLive < balance.tokensInUserArea) {
      const missing = balance.tokensInUserArea - userLive;
      const positions = scatterInRadius(
        center,
        missing,
        balance.userAreaRadiusM,
        balance.tokenCenterBias,
        balance.userAreaInnerRadiusM,
      );
      const rows = buildTokenRows(userId, positions);
      if (rows.length) await db.insert(schema.tokens).values(rows);
    }
    // Note the topup whether or not we wrote rows — the gate's job
    // is to throttle the EXPENSIVE step (the count + insert), not
    // just the insert itself. If the user-area was already full,
    // we still don't want to recheck for another threshold/cooldown.
    await noteUserAreaTopup(userId, center);
  }

  // 3. Per-pet pool — each nearby active lost pet gets its search
  // zone seeded. Tokens already inside the zone (from earlier syncs,
  // or from the user-area pool if the pet happens to be close) count
  // toward the quota, so we only top up the gap.
  const nearbyDogs = await db
    .select({
      id: schema.lostDogs.id,
      lat: schema.lostDogs.lastSeenLat,
      lng: schema.lostDogs.lastSeenLng,
      zoneRadiusM: schema.lostDogs.searchZoneRadiusM,
    })
    .from(schema.lostDogs)
    .where(
      and(
        eq(schema.lostDogs.status, 'active'),
        not(
          and(
            eq(schema.lostDogs.lastSeenLat, FALLBACK_LAT),
            eq(schema.lostDogs.lastSeenLng, FALLBACK_LNG),
          )!,
        ),
        sql`${haversineSql(center, schema.lostDogs.lastSeenLat, schema.lostDogs.lastSeenLng)} <= ${balance.dogAreaScanRadiusM}`,
      ),
    );

  for (const d of nearbyDogs) {
    if (!(await dogZoneGate.shouldTopup(userId, d.id))) continue;
    const dogPos = { lat: d.lat, lng: d.lng };
    const zoneDistExpr = haversineSql(dogPos, schema.tokens.lat, schema.tokens.lng);
    const zoneRows = await db
      .select({ live: sql<number>`count(*)::int` })
      .from(schema.tokens)
      .where(
        and(
          eq(schema.tokens.ownerId, userId),
          isNull(schema.tokens.collectedAt),
          sql`${zoneDistExpr} <= ${d.zoneRadiusM}`,
        ),
      );
    const zoneLive = zoneRows[0]?.live ?? 0;
    await dogZoneGate.note(userId, d.id);
    if (zoneLive >= balance.tokensPerDogArea) continue;
    const missing = balance.tokensPerDogArea - zoneLive;
    const positions = scatterInRadius(dogPos, missing, d.zoneRadiusM);
    const rows = buildTokenRows(userId, positions);
    if (rows.length) await db.insert(schema.tokens).values(rows);
  }

  // 4. Per-park pool — paws cluster around nearby parks so a walk
  // toward one reads as following a trail. Same shape as the
  // dog-zone seeding: count what's already inside the ring, top up
  // the gap. Skipped if the client hasn't passed parks yet (first
  // sync before Places loads).
  for (const park of parks) {
    if (!(await parkPawsGate.shouldTopup(userId, park))) continue;
    const parkDistExpr = haversineSql(park, schema.tokens.lat, schema.tokens.lng);
    const parkRows = await db
      .select({ live: sql<number>`count(*)::int` })
      .from(schema.tokens)
      .where(
        and(
          eq(schema.tokens.ownerId, userId),
          isNull(schema.tokens.collectedAt),
          sql`${parkDistExpr} <= ${balance.parkPawRadiusM}`,
        ),
      );
    const parkLive = parkRows[0]?.live ?? 0;
    await parkPawsGate.note(userId, park);
    if (parkLive >= balance.tokensPerPark) continue;
    const missing = balance.tokensPerPark - parkLive;
    const positions = scatterInRadius(park, missing, balance.parkPawRadiusM);
    const rows = buildTokenRows(userId, positions);
    if (rows.length) await db.insert(schema.tokens).values(rows);
  }
}

export async function ensureFoodForUser(
  userId: string,
  center: LatLng,
  parks: LatLng[] = [],
) {
  parks = dedupeParks(parks);
  // Age out uncollected bones the same way tokens do — keeps legacy
  // uniform-scatter bones from lingering once we switch to park mode,
  // and refreshes positions over time.
  await db
    .update(schema.foodItems)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(schema.foodItems.ownerId, userId),
        isNull(schema.foodItems.consumedAt),
        sql`${schema.foodItems.spawnedAt} < NOW() - make_interval(mins => ${balance.foodExpireMinutes})`,
      ),
    );

  // Park mode: each park gets topped up to `bonesPerPark`, with a
  // small random offset so they don't stack at the exact pin. Matches
  // the paws-per-pet pattern — places earn bones, not random streets.
  if (parks.length) {
    for (const park of parks) {
      if (!(await parkBonesGate.shouldTopup(userId, park))) continue;
      const distExpr = haversineSql(park, schema.foodItems.lat, schema.foodItems.lng);
      const zoneRows = await db
        .select({ live: sql<number>`count(*)::int` })
        .from(schema.foodItems)
        .where(
          and(
            eq(schema.foodItems.ownerId, userId),
            isNull(schema.foodItems.consumedAt),
            sql`${distExpr} <= ${balance.parkScatterRadiusM}`,
          ),
        );
      const zoneLive = zoneRows[0]?.live ?? 0;
      await parkBonesGate.note(userId, park);
      if (zoneLive >= balance.bonesPerPark) continue;
      const missing = balance.bonesPerPark - zoneLive;
      const positions = scatterInRadius(park, missing, balance.parkScatterRadiusM);
      const rows = positions.map((p) => ({
        id: nanoid(),
        ownerId: userId,
        lat: p.lat,
        lng: p.lng,
        value: 1,
      }));
      if (rows.length) await db.insert(schema.foodItems).values(rows);
    }
    return;
  }

  // No parks supplied (Places hasn't loaded yet, or the native stub
  // isn't wired). Fall back to the old uniform-scatter so the feature
  // degrades gracefully instead of leaving the walker with no bones.
  const rows0 = await db
    .select({ live: sql<number>`count(*)::int` })
    .from(schema.foodItems)
    .where(and(eq(schema.foodItems.ownerId, userId), isNull(schema.foodItems.consumedAt)));
  const live = rows0[0]?.live ?? 0;
  if (live >= balance.foodCount) return;
  const missing = balance.foodCount - live;
  const positions = scatter(center, missing, balance.foodSpreadDeg, balance.foodSpreadDeg);
  const rows = positions.map((p) => ({
    id: nanoid(),
    ownerId: userId,
    lat: p.lat,
    lng: p.lng,
    value: 1,
  }));
  if (rows.length) await db.insert(schema.foodItems).values(rows);
}
