import { and, eq, isNull, not, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, schema } from '../db/index.js';
import { balance } from '../config/balance.js';
import type { LatLng } from '../utils/geo.js';
import { scatter, scatterInRadius } from '../utils/geo.js';

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

export async function ensureTokensForUser(userId: string, center: LatLng) {
  // 1. Age out uncollected tokens older than `tokenExpireMinutes`. The
  // previous distance-based cull didn't fit the new pool model — a paw
  // seeded inside a dog's zone 3km from the walker is legitimate even
  // when the walker is elsewhere. Time-based expiry keeps the set
  // bounded without touching pool correctness.
  const ageCutoff = new Date(Date.now() - balance.tokenExpireMinutes * 60_000);
  await db
    .update(schema.tokens)
    .set({ collectedAt: new Date() })
    .where(
      and(
        eq(schema.tokens.ownerId, userId),
        isNull(schema.tokens.collectedAt),
        sql`${schema.tokens.spawnedAt} < ${ageCutoff}`,
      ),
    );

  // 2. User-area pool — base supply around the walker, with radial
  // bias so it's denser near them and thins out toward the edge.
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
    );
    const rows = buildTokenRows(userId, positions);
    if (rows.length) await db.insert(schema.tokens).values(rows);
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
    if (zoneLive >= balance.tokensPerDogArea) continue;
    const missing = balance.tokensPerDogArea - zoneLive;
    const positions = scatterInRadius(dogPos, missing, d.zoneRadiusM);
    const rows = buildTokenRows(userId, positions);
    if (rows.length) await db.insert(schema.tokens).values(rows);
  }
}

export async function ensureFoodForUser(userId: string, center: LatLng) {
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
