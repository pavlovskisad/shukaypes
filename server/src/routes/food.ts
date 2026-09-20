import type { FastifyPluginAsync } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, schema } from '../db/index.js';
import { balance } from '../config/balance.js';
import { distanceMeters, type LatLng } from '../utils/geo.js';
import { ensureFoodForUser } from '../services/spawn.js';
import { limitInteractive, limitPolling } from '../lib/rateLimit.js';
import { eatFoodTx } from '../services/collect.js';
import { tickTask } from '../services/dailyTasks.js';

interface NearbyQuery {
  lat: string;
  lng: string;
  // Optional pipe-delimited park coords: "lat,lng|lat,lng|...". When
  // present, ensureFoodForUser seeds bones at those positions instead
  // of scattering uniformly.
  parks?: string;
}

function parseParks(raw?: string): LatLng[] {
  if (!raw) return [];
  const out: LatLng[] = [];
  for (const chunk of raw.split('|')) {
    const [latStr, lngStr] = chunk.split(',');
    const lat = Number(latStr);
    const lng = Number(lngStr);
    if (Number.isFinite(lat) && Number.isFinite(lng)) out.push({ lat, lng });
  }
  return out;
}

interface FeedBody {
  foodId: string;
  lat: number;
  lng: number;
  // Tap-to-eat bypass for the distance check. Same pattern as
  // /collect/token's force flag — UI taps send true, auto-eat
  // doesn't.
  force?: boolean;
}

const plugin: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: NearbyQuery }>('/food/nearby', limitPolling, async (req, reply) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      reply.code(400);
      return { error: 'invalid lat/lng' };
    }

    const parks = parseParks(req.query.parks);
    await ensureFoodForUser(req.userId, { lat, lng }, parks);

    const rows = await db
      .select({
        id: schema.foodItems.id,
        lat: schema.foodItems.lat,
        lng: schema.foodItems.lng,
        value: schema.foodItems.value,
        spawnedAt: schema.foodItems.spawnedAt,
      })
      .from(schema.foodItems)
      .where(
        and(
          eq(schema.foodItems.ownerId, req.userId),
          isNull(schema.foodItems.consumedAt),
        ),
      );

    return {
      food: rows.map((r) => ({
        id: r.id,
        value: r.value,
        position: { lat: r.lat, lng: r.lng } satisfies LatLng,
        spawnedAt: r.spawnedAt.toISOString(),
      })),
    };
  });

  app.post<{ Body: FeedBody }>('/feed', limitInteractive, async (req, reply) => {
    const { foodId, lat, lng, force } = req.body ?? ({} as FeedBody);
    if (!foodId || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      reply.code(400);
      return { error: 'invalid body' };
    }

    const [food] = await db
      .select()
      .from(schema.foodItems)
      .where(eq(schema.foodItems.id, foodId))
      .limit(1);

    const logReject = async (reason: string) => {
      await db.insert(schema.collectEvents).values({
        id: nanoid(),
        userId: req.userId,
        kind: 'food',
        targetId: foodId,
        lat,
        lng,
        accepted: false,
        reason,
      });
    };

    if (!food || food.ownerId !== req.userId) {
      await logReject('not_found_or_forbidden');
      reply.code(404);
      return { error: 'food not found' };
    }
    if (food.consumedAt) {
      await logReject('already_consumed');
      reply.code(409);
      return { error: 'already consumed' };
    }
    if (!force) {
      const dist = distanceMeters({ lat, lng }, { lat: food.lat, lng: food.lng });
      if (dist > balance.collectMaxDistanceM) {
        await logReject(`too_far_${Math.round(dist)}m`);
        reply.code(403);
        return { error: 'too far from food' };
      }
    }

    // The meal, the same write a bot makes on its walk (services/collect.ts).
    await eatFoodTx(req.userId, foodId, { lat, lng });
    // The day's bone count, from the server's own witness of the meal
    // rather than the client saying it happened (D-99). Ticked HERE and
    // not inside eatFoodTx, because bots eat through that same function
    // and a bot has no day to earn.
    const day = await tickTask(req.userId, 'bones', 1);

    return { ok: true, earned: day.earned, bonus: day.bonus, paws: day.paws };
  });
};

export default plugin;
