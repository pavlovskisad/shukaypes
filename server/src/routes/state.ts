import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
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
