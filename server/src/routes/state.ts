import type { FastifyPluginAsync } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { xpProgress, MAX_LEVEL } from '../lib/xp.js';

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/state', async (req) => {
    const userId = req.userId;
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    const [companion] = await db
      .select()
      .from(schema.companionState)
      .where(eq(schema.companionState.userId, userId))
      .limit(1);

    if (!user || !companion) return { error: 'user not found' };

    // Lifetime bones-eaten — counted from accepted food collect_events
    // to mirror tokensCollected. Cheaper than denormalising onto the
    // users row; /state runs ~5s and the table has an index on user_id.
    const [bonesRow] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.collectEvents)
      .where(
        and(
          eq(schema.collectEvents.userId, userId),
          eq(schema.collectEvents.kind, 'food'),
          eq(schema.collectEvents.accepted, true),
        ),
      );
    const totalBones = bonesRow?.n ?? 0;

    // Level is derived from xp via the shared curve — we don't trust
    // companion.level (legacy column kept for migration safety) so the
    // curve can be tuned without DB writes.
    const { level, xpInLevel, xpForNextLevel } = xpProgress(companion.xp);

    return {
      user: {
        id: user.id,
        username: user.username,
        points: user.points,
        totalTokens: user.totalTokens,
        totalBones,
        totalDistanceMeters: user.totalDistanceMeters,
      },
      companion: {
        name: companion.name,
        level,
        xp: companion.xp,
        xpInLevel,
        xpForNextLevel,
        maxLevel: MAX_LEVEL,
        skinId: companion.skinId,
        hunger: companion.hunger,
        happiness: companion.happiness,
        lastFedAt: companion.lastFedAt?.toISOString() ?? null,
      },
    };
  });
};

export default plugin;
