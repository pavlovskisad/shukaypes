import type { FastifyPluginAsync } from 'fastify';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, schema } from '../db/index.js';
import { balance } from '../config/balance.js';
import { distanceMeters, type LatLng } from '../utils/geo.js';
import { ensureFoodForUser } from '../services/spawn.js';

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
}

const plugin: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: NearbyQuery }>('/food/nearby', async (req, reply) => {
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

  app.post<{ Body: FeedBody }>('/feed', async (req, reply) => {
    const { foodId, lat, lng } = req.body ?? ({} as FeedBody);
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
    const dist = distanceMeters({ lat, lng }, { lat: food.lat, lng: food.lng });
    if (dist > balance.collectMaxDistanceM) {
      await logReject(`too_far_${Math.round(dist)}m`);
      reply.code(403);
      return { error: 'too far from food' };
    }

    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(schema.foodItems)
        .set({ consumedAt: now })
        .where(eq(schema.foodItems.id, foodId));
      await tx
        .update(schema.companionState)
        .set({
          hunger: sql`LEAST(${balance.hunger.max}, ${schema.companionState.hunger} + ${balance.bone.hunger})`,
          happiness: sql`LEAST(${balance.happiness.max}, ${schema.companionState.happiness} + ${balance.bone.happiness})`,
          lastFedAt: now,
          // See note in tokens.ts collect — reset decay clock on every
          // active interaction so a single post-idle tick can't eat the
          // bump.
          lastDecayAt: now,
        })
        .where(eq(schema.companionState.userId, req.userId));
      await tx.insert(schema.collectEvents).values({
        id: nanoid(),
        userId: req.userId,
        kind: 'food',
        targetId: foodId,
        lat,
        lng,
        accepted: true,
      });
    });

    return { ok: true };
  });
};

export default plugin;
