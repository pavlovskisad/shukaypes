import { and, eq, isNull, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, schema } from '../db/index.js';
import { balance } from '../config/balance.js';
import type { LatLng } from '../utils/geo.js';
import { scatter } from '../utils/geo.js';

// Core-IP hook: token spawn weighted toward active lost-dog zones.
// For now we just spawn evenly; Phase 5 will add zone-biasing.
async function weightedPositions(
  center: LatLng,
  count: number,
  spread: number,
): Promise<LatLng[]> {
  return scatter(center, count, spread, spread);
}

export async function ensureTokensForUser(userId: string, center: LatLng) {
  const rows0 = await db
    .select({ live: sql<number>`count(*)::int` })
    .from(schema.tokens)
    .where(and(eq(schema.tokens.ownerId, userId), isNull(schema.tokens.collectedAt)));
  const live = rows0[0]?.live ?? 0;

  if (live >= balance.tokenCount) return;

  const missing = balance.tokenCount - live;
  const positions = await weightedPositions(center, missing, balance.tokenSpreadDeg);
  const rows = positions.map((p) => ({
    id: nanoid(),
    ownerId: userId,
    type: 'regular' as const,
    lat: p.lat,
    lng: p.lng,
    value: 1 + Math.floor(Math.random() * 3),
  }));
  if (rows.length) await db.insert(schema.tokens).values(rows);
}

export async function ensureFoodForUser(userId: string, center: LatLng) {
  const rows0 = await db
    .select({ live: sql<number>`count(*)::int` })
    .from(schema.foodItems)
    .where(and(eq(schema.foodItems.ownerId, userId), isNull(schema.foodItems.consumedAt)));
  const live = rows0[0]?.live ?? 0;

  if (live >= balance.foodCount) return;

  const missing = balance.foodCount - live;
  const positions = await weightedPositions(center, missing, balance.foodSpreadDeg);
  const rows = positions.map((p) => ({
    id: nanoid(),
    ownerId: userId,
    lat: p.lat,
    lng: p.lng,
    value: 1,
  }));
  if (rows.length) await db.insert(schema.foodItems).values(rows);
}
