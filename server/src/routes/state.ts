import type { FastifyPluginAsync } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { xpProgress, MAX_LEVEL } from '../lib/xp.js';
import { limitPolling } from '../lib/rateLimit.js';
import { balance } from '../config/balance.js';

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/state', limitPolling, async (req) => {
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

    // "The person is with the dog" (D-75): the decay cron drains
    // happiness and counts time toward the happiness index only for
    // rows polled within the online window. Coming back after a gap
    // also restarts the decay clock, so the dog wakes as it was left
    // rather than taking a welcome-back dip for the hours away.
    await db.execute(sql`
      UPDATE ${schema.companionState}
      SET last_poll_at = NOW(),
          last_decay_at = CASE
            WHEN last_poll_at IS NULL OR last_poll_at < NOW() - (${balance.happinessIndex.onlineWindowMs}::int * interval '1 millisecond')
              THEN NOW() ELSE last_decay_at END
      WHERE user_id = ${userId}
    `);

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
