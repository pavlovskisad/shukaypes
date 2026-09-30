// Where other dogs are — the source behind the walk menu's «meet» leaf.
//
// The other two leaves send you somewhere we already knew about: a walk
// goes to a park or a landmark out of our own tables, a visit goes to a
// business out of Places. This one has no list behind it, because the
// answer is not a property of the city — it is a property of what the
// people playing have been doing this week, and it has to move when they
// do. So it is computed from the marks walkers actually left.
//
// Territory marks are the trace this reads. They are not a log kept for
// this purpose — they are the territory mechanic's own record — but a
// mark is dropped every so often as a dog walks, which makes the table a
// sampled path of every walk anyone has taken, already indexed by bbox.
// Nothing new has to be collected for this to work, and it gets denser on
// its own as people play.
//
// The rule for turning those into places is in services/gatheringSpots.ts
// and checked against fixtures there; this route is the part that reads
// the table and puts a name on the answer.

import type { FastifyPluginAsync } from 'fastify';
import { and, desc, gte, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { limitRead } from '../lib/rateLimit.js';
import {
  clusterGatherings,
  distanceM,
  type WalkerMark,
} from '../services/gatheringSpots.js';

// Matches the walk planner's far budget with room to spare, so one fetch
// serves either distance the menu can ask for.
const DEFAULT_RADIUS_M = 3500;
const MAX_RADIUS_M = 6000;
const MIN_RADIUS_M = 500;

// How far back a visit still counts. Long enough that a place used on
// weekends survives a quiet Tuesday; short enough that the map is about
// now rather than about the month the feature shipped.
const WINDOW_DAYS = 14;
// …and how fast weight falls off inside that window. Three days.
const HALF_LIFE_H = 72;

// "The same place." A park gate or a square, not an address.
const CLUSTER_RADIUS_M = 200;

// Two different dogs is the smallest thing that is a MEETING rather than
// a habit. One walker's own route is the failure this number exists to
// prevent — see the fixture check.
const MIN_WALKERS = 2;

// Enough for the planner to have a real choice at either distance.
const LIMIT = 24;

// Ceiling on marks pulled into memory for one request. At the current
// population the whole city is a fraction of this; it is here so that a
// busy future city degrades to "the most recent N" instead of to a
// request that reads an unbounded table.
const MAX_MARKS = 5000;

// Simulated walkers count. They walk a day plan, hold ground, and move
// around the city on their own, so the places they pile up in are places
// the mechanic can legitimately point at while the real population is
// still small — and excluding them would leave the feature with nothing
// to say to anyone. Flip this to true at open beta and the same code
// starts answering from real walkers only.
const REAL_WALKERS_ONLY = false;

// How close a named place has to be to a cluster's centre of mass to lend
// it its name. Past this the honest answer is a direction, not a label.
const NAME_RADIUS_M = 350;
const NAMEABLE = ['park', 'square', 'neighbourhood'];

interface GatheringResponse {
  id: string;
  name: string;
  category: 'gathering';
  position: { lat: number; lng: number };
  distM: number;
  walkers: number;
}

const plugin: FastifyPluginAsync = async (app) => {
  app.get<{
    Querystring: { lat?: string; lng?: string; radius?: string };
  }>('/social/gathering', limitRead, async (req, reply) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      reply.code(400);
      return { error: 'lat + lng required' };
    }
    const radius = Number.isFinite(Number(req.query.radius))
      ? Math.max(MIN_RADIUS_M, Math.min(MAX_RADIUS_M, Number(req.query.radius)))
      : DEFAULT_RADIUS_M;

    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
    // Same haversine shape the other geo routes use. Single-table, so the
    // bare lat / lng references are unambiguous.
    const dist = sql<number>`(6371000 * acos(least(1, cos(radians(${lat})) * cos(radians(lat)) * cos(radians(lng) - radians(${lng})) + sin(radians(${lat})) * sin(radians(lat)))))`;

    const rows = await db
      .select({
        userId: schema.territoryMarks.userId,
        lat: schema.territoryMarks.lat,
        lng: schema.territoryMarks.lng,
        at: schema.territoryMarks.createdAt,
      })
      .from(schema.territoryMarks)
      .where(
        and(
          gte(schema.territoryMarks.createdAt, since),
          sql`${dist} < ${radius}`,
          ...(REAL_WALKERS_ONLY
            ? [sql`${schema.territoryMarks.userId} NOT LIKE 'bot:%'`]
            : []),
        ),
      )
      // Newest first, so the ceiling below cuts the stalest marks rather
      // than an arbitrary slice.
      .orderBy(desc(schema.territoryMarks.createdAt))
      .limit(MAX_MARKS);

    const marks: WalkerMark[] = rows.map((r) => ({
      userId: r.userId,
      lat: r.lat,
      lng: r.lng,
      at: r.at,
    }));

    const spots = clusterGatherings(marks, {
      now: new Date(),
      radiusM: CLUSTER_RADIUS_M,
      halfLifeH: HALF_LIFE_H,
      minWalkers: MIN_WALKERS,
      limit: LIMIT,
    });
    if (spots.length === 0) return { gatherings: [] };

    // Put a name on each. One query for the whole neighbourhood rather
    // than one per cluster: the candidate set is small and the matching
    // is a distance comparison we already have in hand.
    const named = await db
      .select({
        nameUk: schema.kyivGazetteer.nameUk,
        nameEn: schema.kyivGazetteer.nameEn,
        category: schema.kyivGazetteer.category,
        lat: schema.kyivGazetteer.lat,
        lng: schema.kyivGazetteer.lng,
      })
      .from(schema.kyivGazetteer)
      .where(
        and(
          // inArray, not `= ANY(...)`: drizzle binds a JS array as one
          // scalar parameter, so ANY gets a non-array and Postgres
          // refuses the whole query at runtime. It typechecks either way
          // — this one was caught by running the route, not by reading
          // it.
          inArray(schema.kyivGazetteer.category, NAMEABLE),
          sql`${dist} < ${radius + NAME_RADIUS_M}`,
        ),
      );

    const label = (p: { lat: number; lng: number }): string => {
      let best: { name: string; d: number } | null = null;
      for (const g of named) {
        const d = distanceM(p, { lat: g.lat, lng: g.lng });
        if (d > NAME_RADIUS_M) continue;
        // A park beats the neighbourhood it sits in: it is the thing
        // somebody would say they were going to.
        const rank = g.category === 'neighbourhood' ? d + NAME_RADIUS_M : d;
        if (!best || rank < best.d) {
          best = { name: g.nameUk || g.nameEn || 'без назви', d: rank };
        }
      }
      return best?.name ?? 'вигул неподалік';
    };

    const gatherings: GatheringResponse[] = spots.map((s) => ({
      // Positional, not a database id — a gathering is a cluster that
      // exists only for the life of this answer. Rounded so the same
      // place keeps the same id between requests, which is what the
      // client's recent-destination memory needs to work at all.
      id: `gather:${s.position.lat.toFixed(4)}:${s.position.lng.toFixed(4)}`,
      name: label(s.position),
      category: 'gathering',
      position: s.position,
      distM: Math.round(distanceM({ lat, lng }, s.position)),
      walkers: s.walkers,
    }));

    return { gatherings };
  });
};

export default plugin;
