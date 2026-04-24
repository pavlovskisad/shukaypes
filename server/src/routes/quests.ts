import type { FastifyPluginAsync } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, schema, type StoredWaypoint } from '../db/index.js';
import { distanceMeters, type LatLng } from '../utils/geo.js';
import {
  generateDetectiveWaypoints,
  WAYPOINT_REACH_RADIUS_M,
} from '../services/quest.js';
import {
  narrateQuestStart,
  narrateWaypointReached,
  narrateQuestComplete,
} from '../services/questNarration.js';

interface StartBody {
  dogId: string;
  lat: number;
  lng: number;
}

interface AdvanceBody {
  questId: string;
  lat: number;
  lng: number;
  // Testing flag — skips the WAYPOINT_REACH_RADIUS_M check so the
  // current waypoint can be marked reached via a tap instead of
  // physically walking to it. Gate this later if it ever ships to
  // non-dev builds.
  force?: boolean;
}

interface AbandonBody {
  questId: string;
}

// One active quest per user at a time. Starting a new one flips any
// existing active quest to 'abandoned' first.

// Response matches the shared Quest type: currentWaypoint (not
// currentIndex), waypoints carry clue as string|undefined (shared uses
// optional). We also surface `status` even though the shared type
// doesn't — harmless extra field, useful for the client to branch on
// active vs completed.
function rowToQuest(r: {
  id: string;
  userId: string;
  dogId: string | null;
  type: string;
  status: string;
  waypoints: StoredWaypoint[];
  currentIndex: number;
  rewardPoints: number;
  startedAt: Date;
  completedAt: Date | null;
}) {
  return {
    id: r.id,
    userId: r.userId,
    dogId: r.dogId ?? undefined,
    type: r.type,
    status: r.status,
    waypoints: r.waypoints.map((w) => ({
      position: w.position,
      clue: w.clue ?? undefined,
      reached: w.reached,
    })),
    currentWaypoint: r.currentIndex,
    rewardPoints: r.rewardPoints,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt?.toISOString(),
  };
}

const plugin: FastifyPluginAsync = async (app) => {
  app.post<{ Body: StartBody }>('/quests/start', async (req, reply) => {
    const { dogId, lat, lng } = req.body ?? ({} as StartBody);
    if (!dogId || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      reply.code(400);
      return { error: 'invalid body' };
    }

    const [dog] = await db
      .select({
        id: schema.lostDogs.id,
        name: schema.lostDogs.name,
        species: schema.lostDogs.species,
        breed: schema.lostDogs.breed,
        lat: schema.lostDogs.lastSeenLat,
        lng: schema.lostDogs.lastSeenLng,
        zoneRadiusM: schema.lostDogs.searchZoneRadiusM,
        status: schema.lostDogs.status,
      })
      .from(schema.lostDogs)
      .where(eq(schema.lostDogs.id, dogId))
      .limit(1);
    if (!dog || dog.status !== 'active') {
      reply.code(404);
      return { error: 'dog not found or inactive' };
    }

    // Abandon any existing active quest so we never have two open at once.
    await db
      .update(schema.quests)
      .set({ status: 'abandoned' })
      .where(
        and(
          eq(schema.quests.userId, req.userId),
          eq(schema.quests.status, 'active'),
        ),
      );

    const waypoints = generateDetectiveWaypoints(
      { lat, lng },
      { lat: dog.lat, lng: dog.lng },
      dog.zoneRadiusM,
      3,
    );

    const id = nanoid();
    const [inserted] = await db
      .insert(schema.quests)
      .values({
        id,
        userId: req.userId,
        dogId: dog.id,
        type: 'detective',
        status: 'active',
        waypoints,
        currentIndex: 0,
        rewardPoints: 50,
      })
      .returning();

    const narration = await narrateQuestStart(
      { name: dog.name, species: dog.species, breed: dog.breed },
      waypoints.length,
    );

    return { quest: rowToQuest(inserted!), narration };
  });

  app.get('/quests/active', async (req) => {
    const [row] = await db
      .select()
      .from(schema.quests)
      .where(
        and(
          eq(schema.quests.userId, req.userId),
          eq(schema.quests.status, 'active'),
        ),
      )
      .limit(1);
    return { quest: row ? rowToQuest(row) : null };
  });

  app.post<{ Body: AdvanceBody }>('/quests/advance', async (req, reply) => {
    const { questId, lat, lng, force } = req.body ?? ({} as AdvanceBody);
    if (!questId || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      reply.code(400);
      return { error: 'invalid body' };
    }

    const [row] = await db
      .select()
      .from(schema.quests)
      .where(eq(schema.quests.id, questId))
      .limit(1);
    if (!row || row.userId !== req.userId) {
      reply.code(404);
      return { error: 'quest not found' };
    }
    if (row.status !== 'active') {
      reply.code(409);
      return { error: 'quest not active' };
    }

    const waypoint = row.waypoints[row.currentIndex];
    if (!waypoint) {
      reply.code(409);
      return { error: 'no waypoint at current index' };
    }

    const userPos: LatLng = { lat, lng };
    if (!force) {
      const dist = distanceMeters(userPos, waypoint.position);
      if (dist > WAYPOINT_REACH_RADIUS_M) {
        reply.code(403);
        return { error: 'too far from waypoint', distM: Math.round(dist) };
      }
    }

    const nextWaypoints: StoredWaypoint[] = row.waypoints.map((w, i) =>
      i === row.currentIndex ? { ...w, reached: true } : w,
    );
    const nextIndex = row.currentIndex + 1;
    const done = nextIndex >= nextWaypoints.length;

    const [updated] = await db.transaction(async (tx) => {
      const res = await tx
        .update(schema.quests)
        .set({
          waypoints: nextWaypoints,
          currentIndex: nextIndex,
          status: done ? 'completed' : 'active',
          completedAt: done ? new Date() : null,
        })
        .where(eq(schema.quests.id, questId))
        .returning();
      if (done) {
        await tx
          .update(schema.users)
          .set({ points: sql`${schema.users.points} + ${row.rewardPoints}` })
          .where(eq(schema.users.id, req.userId));
      }
      return res;
    });

    // Pull the pet for narration context. Cheap lookup (1 row) and only
    // happens on waypoint arrivals, not the 100ms poll — client gates
    // /advance behind a 50m pre-check.
    let narration: string | null = null;
    if (row.dogId) {
      const [dog] = await db
        .select({
          name: schema.lostDogs.name,
          species: schema.lostDogs.species,
          breed: schema.lostDogs.breed,
        })
        .from(schema.lostDogs)
        .where(eq(schema.lostDogs.id, row.dogId))
        .limit(1);
      if (dog) {
        narration = done
          ? await narrateQuestComplete(dog, nextWaypoints.length)
          : await narrateWaypointReached(dog, row.currentIndex, nextWaypoints.length);
      }
    }

    return { quest: rowToQuest(updated!), completed: done, narration };
  });

  app.post<{ Body: AbandonBody }>('/quests/abandon', async (req, reply) => {
    const { questId } = req.body ?? ({} as AbandonBody);
    if (!questId) {
      reply.code(400);
      return { error: 'invalid body' };
    }
    const [row] = await db
      .select()
      .from(schema.quests)
      .where(eq(schema.quests.id, questId))
      .limit(1);
    if (!row || row.userId !== req.userId) {
      reply.code(404);
      return { error: 'quest not found' };
    }
    if (row.status !== 'active') {
      return { ok: true, alreadyClosed: true };
    }
    await db
      .update(schema.quests)
      .set({ status: 'abandoned' })
      .where(eq(schema.quests.id, questId));
    return { ok: true };
  });
};

export default plugin;
