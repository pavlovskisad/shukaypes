import type { FastifyPluginAsync } from 'fastify';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { balance } from '../config/balance.js';
import { distanceMeters, type LatLng } from '../utils/geo.js';
import { ensureTokensForUser } from '../services/spawn.js';
import { nanoid } from 'nanoid';

interface NearbyQuery {
  lat: string;
  lng: string;
}

interface CollectBody {
  tokenId: string;
  lat: number;
  lng: number;
}

// Distance beyond which an uncollected token is not returned to the
// client, even if it still belongs to this user. Sized to the spawn
// pools' current reach: userAreaRadiusM (800m) + dogAreaScanRadiusM
// (1500m) + zone radius (~500m) ≈ 2km with buffer. Keeps the client
// from rendering a citywide pile of paws accumulated across sessions.
const TOKEN_VIEW_RADIUS_M = 2000;

const plugin: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: NearbyQuery }>('/tokens/nearby', async (req, reply) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      reply.code(400);
      return { error: 'invalid lat/lng' };
    }

    await ensureTokensForUser(req.userId, { lat, lng });

    const rows = await db
      .select({
        id: schema.tokens.id,
        type: schema.tokens.type,
        lat: schema.tokens.lat,
        lng: schema.tokens.lng,
        value: schema.tokens.value,
        spawnedAt: schema.tokens.spawnedAt,
      })
      .from(schema.tokens)
      .where(
        and(
          eq(schema.tokens.ownerId, req.userId),
          isNull(schema.tokens.collectedAt),
          sql`(
            2 * 6371000 * ASIN(SQRT(
              POWER(SIN(RADIANS(${lat} - ${schema.tokens.lat}) / 2), 2)
              + COS(RADIANS(${lat})) * COS(RADIANS(${schema.tokens.lat}))
              * POWER(SIN(RADIANS(${lng} - ${schema.tokens.lng}) / 2), 2)
            ))
          ) <= ${TOKEN_VIEW_RADIUS_M}`,
        ),
      );

    return {
      tokens: rows.map((r) => ({
        id: r.id,
        type: r.type,
        value: r.value,
        position: { lat: r.lat, lng: r.lng } satisfies LatLng,
        spawnedAt: r.spawnedAt.toISOString(),
      })),
    };
  });

  app.post<{ Body: CollectBody }>('/collect/token', async (req, reply) => {
    const { tokenId, lat, lng } = req.body ?? ({} as CollectBody);
    if (!tokenId || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      reply.code(400);
      return { error: 'invalid body' };
    }

    const [token] = await db
      .select()
      .from(schema.tokens)
      .where(eq(schema.tokens.id, tokenId))
      .limit(1);

    const logReject = async (reason: string) => {
      await db.insert(schema.collectEvents).values({
        id: nanoid(),
        userId: req.userId,
        kind: 'token',
        targetId: tokenId,
        lat,
        lng,
        accepted: false,
        reason,
      });
    };

    if (!token || token.ownerId !== req.userId) {
      await logReject('not_found_or_forbidden');
      reply.code(404);
      return { error: 'token not found' };
    }
    if (token.collectedAt) {
      await logReject('already_collected');
      reply.code(409);
      return { error: 'already collected' };
    }
    const dist = distanceMeters(
      { lat, lng },
      { lat: token.lat, lng: token.lng },
    );
    if (dist > balance.collectMaxDistanceM) {
      await logReject(`too_far_${Math.round(dist)}m`);
      reply.code(403);
      return { error: 'too far from token' };
    }

    // Mark collected + credit points + bump companion stats, atomically.
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(schema.tokens)
        .set({ collectedAt: now })
        .where(eq(schema.tokens.id, tokenId));
      await tx
        .update(schema.users)
        .set({
          points: sql`${schema.users.points} + ${token.value}`,
          totalTokens: sql`${schema.users.totalTokens} + 1`,
          lastSeenAt: now,
        })
        .where(eq(schema.users.id, req.userId));
      await tx
        .update(schema.companionState)
        .set({
          hunger: sql`LEAST(${balance.hunger.max}, ${schema.companionState.hunger} + ${balance.token.hunger})`,
          happiness: sql`LEAST(${balance.happiness.max}, ${schema.companionState.happiness} + ${balance.token.happiness})`,
          xp: sql`${schema.companionState.xp} + ${token.value}`,
          // Reset the decay clock — the user is actively engaged, the
          // companion isn't sitting alone losing happiness. Without
          // this, the first collect after a long idle gap gets clobbered
          // by a single -30 decay tick (the per-tick cap), making the
          // meter visibly drop *despite* the +bump landing.
          lastDecayAt: now,
        })
        .where(eq(schema.companionState.userId, req.userId));
      await tx.insert(schema.collectEvents).values({
        id: nanoid(),
        userId: req.userId,
        kind: 'token',
        targetId: tokenId,
        lat,
        lng,
        accepted: true,
      });
    });

    return { ok: true, value: token.value };
  });
};

export default plugin;
