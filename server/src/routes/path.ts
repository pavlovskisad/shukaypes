import type { FastifyPluginAsync } from 'fastify';
import { and, eq, isNull, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, schema } from '../db/index.js';
import { redis } from '../db/redis.js';
import { balance } from '../config/balance.js';
import { distanceMeters, pointToSegmentDistanceM, type LatLng } from '../utils/geo.js';

interface PathBody {
  lat: number;
  lng: number;
}

// Auto-collect radii reused on the server for the path sweep. Mirror
// the client's autoCollect* in app/constants/balance.ts so foreground
// auto-collect and the path sweep produce the same set of hits.
const PATH_TOKEN_RADIUS_M = 90;
const PATH_FOOD_RADIUS_M = 130;

// Two safety nets so a malicious / glitched client can't farm paws by
// claiming a wide segment:
//   - segments longer than this are treated as a teleport (skip).
//   - if Redis has no recorded "last position" for the user yet, this
//     is the first sync ever — we just record it and skip the sweep.
const MAX_SEGMENT_M = 5000;
const REDIS_LAST_POS_TTL_S = 24 * 60 * 60;

interface RedisLastPos {
  lat: number;
  lng: number;
  ts: number;
}

function lastPosKey(userId: string): string {
  return `path:last:${userId}`;
}

async function readLastPos(userId: string): Promise<RedisLastPos | null> {
  try {
    if (redis.status !== 'ready') return null;
    const raw = await redis.get(lastPosKey(userId));
    if (!raw) return null;
    return JSON.parse(raw) as RedisLastPos;
  } catch {
    return null;
  }
}

async function writeLastPos(userId: string, pos: LatLng): Promise<void> {
  try {
    if (redis.status !== 'ready') return;
    const value: RedisLastPos = { lat: pos.lat, lng: pos.lng, ts: Date.now() };
    await redis.set(lastPosKey(userId), JSON.stringify(value), 'EX', REDIS_LAST_POS_TTL_S);
  } catch {
    // Path collection is best-effort; a Redis hiccup shouldn't 500
    // the foreground sync.
  }
}

const plugin: FastifyPluginAsync = async (app) => {
  // Path-collect endpoint. Client calls this every sync (every 15s in
  // foreground; on resume after the tab was suspended). Server
  // sweeps any uncollected token / uneaten bone whose distance to the
  // segment from the user's last known position to their current
  // position is within auto-collect radius, and grants them. The
  // anchor (last position) lives in Redis so a tampered client can't
  // claim a wide segment — the server controls one endpoint of the
  // line.
  app.post<{ Body: PathBody }>('/collect/path', async (req, reply) => {
    const { lat, lng } = req.body ?? ({} as PathBody);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      reply.code(400);
      return { error: 'invalid body' };
    }

    const userId = req.userId;
    const current: LatLng = { lat, lng };
    const last = await readLastPos(userId);

    // First sync ever — just record current and skip. No segment to sweep.
    if (!last) {
      await writeLastPos(userId, current);
      return { tokensCollected: 0, foodConsumed: 0, reason: 'no-anchor' };
    }

    const lastPos: LatLng = { lat: last.lat, lng: last.lng };
    const segLen = distanceMeters(lastPos, current);

    // No real movement (GPS jitter etc) — refresh anchor, skip sweep.
    if (segLen < 5) {
      await writeLastPos(userId, current);
      return { tokensCollected: 0, foodConsumed: 0, reason: 'no-movement' };
    }

    // Looks like a teleport — skip the sweep but still bump the
    // anchor so subsequent syncs work normally from here.
    if (segLen > MAX_SEGMENT_M) {
      await writeLastPos(userId, current);
      return { tokensCollected: 0, foodConsumed: 0, reason: 'segment-too-long' };
    }

    // Pull all uncollected tokens + uneaten bones for this user. The
    // per-user pool is small (≤ ~30 tokens, ≤ ~10 bones at any time),
    // so a JS-side filter on point-to-segment distance is cheaper +
    // simpler than a SQL bbox prefilter.
    const [tokens, foods] = await Promise.all([
      db
        .select({
          id: schema.tokens.id,
          lat: schema.tokens.lat,
          lng: schema.tokens.lng,
          value: schema.tokens.value,
        })
        .from(schema.tokens)
        .where(
          and(
            eq(schema.tokens.ownerId, userId),
            isNull(schema.tokens.collectedAt),
          ),
        ),
      db
        .select({
          id: schema.foodItems.id,
          lat: schema.foodItems.lat,
          lng: schema.foodItems.lng,
        })
        .from(schema.foodItems)
        .where(
          and(
            eq(schema.foodItems.ownerId, userId),
            isNull(schema.foodItems.consumedAt),
          ),
        ),
    ]);

    const tokenHits = tokens.filter(
      (t) =>
        pointToSegmentDistanceM(
          { lat: t.lat, lng: t.lng },
          lastPos,
          current,
        ) <= PATH_TOKEN_RADIUS_M,
    );
    const foodHits = foods.filter(
      (f) =>
        pointToSegmentDistanceM(
          { lat: f.lat, lng: f.lng },
          lastPos,
          current,
        ) <= PATH_FOOD_RADIUS_M,
    );

    if (tokenHits.length === 0 && foodHits.length === 0) {
      await writeLastPos(userId, current);
      return { tokensCollected: 0, foodConsumed: 0 };
    }

    const now = new Date();
    const totalValue = tokenHits.reduce((s, t) => s + t.value, 0);
    const tokenHungerBump = tokenHits.length * balance.token.hunger;
    const tokenHappyBump = tokenHits.length * balance.token.happiness;
    const foodHungerBump = foodHits.length * balance.bone.hunger;
    const foodHappyBump = foodHits.length * balance.bone.happiness;
    const totalHungerBump = tokenHungerBump + foodHungerBump;
    const totalHappyBump = tokenHappyBump + foodHappyBump;

    await db.transaction(async (tx) => {
      if (tokenHits.length) {
        await tx
          .update(schema.tokens)
          .set({ collectedAt: now })
          .where(
            inArray(
              schema.tokens.id,
              tokenHits.map((t) => t.id),
            ),
          );
        await tx
          .update(schema.users)
          .set({
            points: sql`${schema.users.points} + ${totalValue}`,
            totalTokens: sql`${schema.users.totalTokens} + ${tokenHits.length}`,
            lastSeenAt: now,
          })
          .where(eq(schema.users.id, userId));
        await tx.insert(schema.collectEvents).values(
          tokenHits.map((t) => ({
            id: nanoid(),
            userId,
            kind: 'token' as const,
            targetId: t.id,
            lat: t.lat,
            lng: t.lng,
            accepted: true,
            reason: 'path',
          })),
        );
      }
      if (foodHits.length) {
        await tx
          .update(schema.foodItems)
          .set({ consumedAt: now })
          .where(
            inArray(
              schema.foodItems.id,
              foodHits.map((f) => f.id),
            ),
          );
        await tx.insert(schema.collectEvents).values(
          foodHits.map((f) => ({
            id: nanoid(),
            userId,
            kind: 'food' as const,
            targetId: f.id,
            lat: f.lat,
            lng: f.lng,
            accepted: true,
            reason: 'path',
          })),
        );
      }
      // Companion bumps merge token + food contributions into a single
      // UPDATE so we don't clamp twice. lastDecayAt resets so an idle
      // gap doesn't get clawed back at the next decay tick (see
      // tokens.ts collect for the rationale).
      if (totalHungerBump > 0 || totalHappyBump > 0) {
        const xpGain = totalValue;
        await tx
          .update(schema.companionState)
          .set({
            hunger: sql`LEAST(${balance.hunger.max}, ${schema.companionState.hunger} + ${totalHungerBump})`,
            happiness: sql`LEAST(${balance.happiness.max}, ${schema.companionState.happiness} + ${totalHappyBump})`,
            xp: sql`${schema.companionState.xp} + ${xpGain}`,
            lastFedAt: foodHits.length ? now : schema.companionState.lastFedAt,
            lastDecayAt: now,
          })
          .where(eq(schema.companionState.userId, userId));
      }
    });

    await writeLastPos(userId, current);
    return {
      tokensCollected: tokenHits.length,
      foodConsumed: foodHits.length,
    };
  });
};

export default plugin;
