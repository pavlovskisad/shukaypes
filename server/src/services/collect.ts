// Picking up a paw and eating a bone — the one place either happens.
//
// Lifted out of routes/tokens.ts and routes/food.ts (D-76) so a bot
// walking its patch goes through exactly the transaction a person's
// tap does: the item consumed, the points, the companion's hunger,
// happiness and XP by the real balance, the decay clock reset, and a
// collect_events row. The routes keep their validation and rejection
// logging; the write is here.

import { and, eq, isNull, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, schema } from '../db/index.js';
import { balance } from '../config/balance.js';
import type { LatLng } from '../utils/geo.js';

// A paw: points to the person, a small happiness bump, XP with the
// lucky 2× when happiness is high enough (pure bonus, never a penalty).
// Dice roll and multiplier happen in SQL so they are atomic with the
// bump. The ::int casts matter: postgres-js binds JS numbers untyped,
// and CASE branches default to TEXT without them.
// Returns true if THIS call collected the token, false if it was already
// collected (a lost race or a replayed request). The caller credits nothing
// on false. The claim is the conditional UPDATE below: only the request that
// flips collected_at from NULL proceeds, so N concurrent taps on one token
// credit exactly once — the route's earlier collected_at read is a fast
// path, not the guard (two requests can both pass it before either writes).
export async function collectTokenTx(
  userId: string,
  tokenId: string,
  value: number,
  pos: LatLng,
): Promise<boolean> {
  const now = new Date();
  const base = balance.xp.perPaw;
  const luckyXp = base * balance.xp.luckyPawMultiplier;
  const threshold = balance.xp.luckyPawHappinessThreshold;
  const chance = balance.xp.luckyPawChance;
  return db.transaction(async (tx) => {
    const claimed = await tx
      .update(schema.tokens)
      .set({ collectedAt: now })
      .where(and(eq(schema.tokens.id, tokenId), isNull(schema.tokens.collectedAt)))
      .returning({ id: schema.tokens.id });
    if (claimed.length === 0) return false;
    await tx
      .update(schema.users)
      .set({
        points: sql`${schema.users.points} + ${value}`,
        totalTokens: sql`${schema.users.totalTokens} + 1`,
        lastSeenAt: now,
      })
      .where(eq(schema.users.id, userId));
    await tx
      .update(schema.companionState)
      .set({
        hunger: sql`LEAST(${balance.hunger.max}, ${schema.companionState.hunger} + ${balance.token.hunger})`,
        happiness: sql`LEAST(${balance.happiness.max}, ${schema.companionState.happiness} + ${balance.token.happiness})`,
        xp: sql`${schema.companionState.xp} + CASE WHEN ${schema.companionState.happiness} >= ${threshold} AND random() < ${chance}::float8 THEN ${luckyXp}::int ELSE ${base}::int END`,
        // Reset the decay clock — the walker is actively engaged.
        // Without this, the first collect after an idle gap gets
        // clobbered by a single capped decay tick.
        lastDecayAt: now,
      })
      .where(eq(schema.companionState.userId, userId));
    await tx.insert(schema.collectEvents).values({
      id: nanoid(),
      userId,
      kind: 'token',
      targetId: tokenId,
      lat: pos.lat,
      lng: pos.lng,
      accepted: true,
    });
    return true;
  });
}

// A bone: the meal. Bones are scarcer than paws, so they are worth
// more XP — feeding the dog at parks is the small daily ritual.
// Same contract as collectTokenTx: true if this call ate the bone, false if
// it was already consumed. The conditional claim makes concurrent /feed
// calls on one bone credit exactly once.
export async function eatFoodTx(userId: string, foodId: string, pos: LatLng): Promise<boolean> {
  const now = new Date();
  return db.transaction(async (tx) => {
    const claimed = await tx
      .update(schema.foodItems)
      .set({ consumedAt: now })
      .where(and(eq(schema.foodItems.id, foodId), isNull(schema.foodItems.consumedAt)))
      .returning({ id: schema.foodItems.id });
    if (claimed.length === 0) return false;
    await tx
      .update(schema.companionState)
      .set({
        hunger: sql`LEAST(${balance.hunger.max}, ${schema.companionState.hunger} + ${balance.bone.hunger})`,
        happiness: sql`LEAST(${balance.happiness.max}, ${schema.companionState.happiness} + ${balance.bone.happiness})`,
        xp: sql`${schema.companionState.xp} + ${balance.xp.perBone}`,
        lastFedAt: now,
        lastDecayAt: now,
      })
      .where(eq(schema.companionState.userId, userId));
    await tx.insert(schema.collectEvents).values({
      id: nanoid(),
      userId,
      kind: 'food',
      targetId: foodId,
      lat: pos.lat,
      lng: pos.lng,
      accepted: true,
    });
    return true;
  });
}
