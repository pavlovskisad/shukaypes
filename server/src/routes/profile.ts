import type { FastifyPluginAsync } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { xpProgress, MAX_LEVEL } from '../lib/xp.js';

// Profile endpoint — aggregate counts for the Profile tab. Separate
// from /state (which is hot-pathed every 5s by useGameLoop) so the
// extra count queries don't run on every poll. Profile tab fetches
// once on focus.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/profile/me', async (req) => {
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

    // Quest counts split by status — gives "pets searched" (active +
    // completed) plus historical detail. abandoned is dropped from the
    // "searched" sum since we don't want to credit walks the user
    // bailed on.
    const questRows = await db
      .select({
        status: schema.quests.status,
        n: sql<number>`count(*)::int`,
      })
      .from(schema.quests)
      .where(eq(schema.quests.userId, userId))
      .groupBy(schema.quests.status);
    const questCounts: Record<string, number> = {};
    for (const r of questRows) questCounts[r.status] = r.n;
    const petsSearched =
      (questCounts.active ?? 0) + (questCounts.completed ?? 0);

    // Sightings the user reported.
    const [sightingsRow] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.sightings)
      .where(eq(schema.sightings.reporterId, userId));
    const sightingsReported = sightingsRow?.n ?? 0;

    // Bones eaten — counted from collect_events (only the accepted ones
    // for this user, kind='food'). Same source the daily-task counter
    // ticks against.
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
    const bonesEaten = bonesRow?.n ?? 0;

    const daysPlayed = Math.max(
      1,
      Math.floor((Date.now() - user.createdAt.getTime()) / MS_PER_DAY) + 1,
    );

    const { level, xpInLevel, xpForNextLevel } = xpProgress(companion.xp);

    return {
      user: {
        id: user.id,
        username: user.username,
        createdAt: user.createdAt.toISOString(),
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
        hunger: companion.hunger,
        happiness: companion.happiness,
      },
      stats: {
        daysPlayed,
        pawsCollected: user.totalTokens,
        bonesEaten,
        petsSearched,
        questsCompleted: questCounts.completed ?? 0,
        questsAbandoned: questCounts.abandoned ?? 0,
        sightingsReported,
      },
    };
  });
};

export default plugin;
