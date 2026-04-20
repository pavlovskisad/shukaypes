import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

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
        level: companion.level,
        xp: companion.xp,
        skinId: companion.skinId,
        hunger: companion.hunger,
        happiness: companion.happiness,
        lastFedAt: companion.lastFedAt?.toISOString() ?? null,
      },
    };
  });
};

export default plugin;
