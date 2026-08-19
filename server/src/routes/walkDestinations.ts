// Places to walk TO, out of our own tables.
//
// The walk planner's only source of destinations used to be Google
// Places, which made a core loop of the app hostage to a billing
// account: with the Places key off, buildCandidates returns an empty
// list, the radial menu answers "sniffing out spots…" forever, and
// nothing downstream — landmarks, stops, commentary — ever runs.
//
// We already hold better material for this than Places did.
// kyiv_gazetteer carries 307 parks and 82 squares; kyiv_lore carries the
// museums, churches and attractions. A park is the destination the
// planner already prefers hardest (WALK_CATEGORY_BIAS park: -2), and a
// museum is a better end to a walk than the vet.
//
// So this is not a fallback bolted on for an outage. It is the source
// that should have been here first; Places now adds cafés and ratings on
// top of it rather than being the whole of it.
//
// WHAT IS DELIBERATELY NOT HERE: streets (15948 of them — a street is
// not a destination), neighbourhoods and districts (a polygon centroid
// is a field, not a place), metro stations (an errand, not a walk), and
// kyiv_lore's 'historic' category (1676 rows, mostly plaques and
// markers). Those last ones are STOPS, which /lore/route already picks —
// a walk whose stated destination is a wall plaque reads as broken.

import type { FastifyPluginAsync } from 'fastify';
import { and, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { limitRead } from '../lib/rateLimit.js';

// Matches the far-walk budget with room to spare, so one fetch serves
// every walk the planner can propose from a given standing position.
const DEFAULT_RADIUS_M = 3500;
const MAX_RADIUS_M = 6000;
const MIN_RADIUS_M = 500;

// Enough to give the planner a real choice in the densest districts
// without shipping a page of JSON to a phone. Distance-ordered, so the
// cut always falls on the far edge.
const LIMIT = 120;

// The gazetteer categories that are somewhere to go, and the lore
// categories that are somewhere to go rather than something to pass.
const GAZETTEER_CATEGORIES = ['park', 'square'];
const LORE_CATEGORIES = ['museum', 'tourism', 'religious'];

interface Destination {
  id: string;
  name: string;
  category: string;
  position: { lat: number; lng: number };
  distM: number;
}

const plugin: FastifyPluginAsync = async (app) => {
  app.get<{
    Querystring: { lat?: string; lng?: string; radius?: string };
  }>('/walk/destinations', limitRead, async (req, reply) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      reply.code(400);
      return { error: 'lat + lng required' };
    }
    const radius = Number.isFinite(Number(req.query.radius))
      ? Math.max(MIN_RADIUS_M, Math.min(MAX_RADIUS_M, Number(req.query.radius)))
      : DEFAULT_RADIUS_M;

    // Same haversine shape /lore/discover uses. Each query is
    // single-table, so the bare lat / lng column references are
    // unambiguous.
    const dist = sql<number>`(6371000 * acos(least(1, cos(radians(${lat})) * cos(radians(lat)) * cos(radians(lng) - radians(${lng})) + sin(radians(${lat})) * sin(radians(lat)))))`;

    const [parks, landmarks] = await Promise.all([
      db
        .select({
          id: schema.kyivGazetteer.id,
          nameUk: schema.kyivGazetteer.nameUk,
          nameEn: schema.kyivGazetteer.nameEn,
          category: schema.kyivGazetteer.category,
          lat: schema.kyivGazetteer.lat,
          lng: schema.kyivGazetteer.lng,
          dist,
        })
        .from(schema.kyivGazetteer)
        .where(
          and(
            inArray(schema.kyivGazetteer.category, GAZETTEER_CATEGORIES),
            sql`${dist} < ${radius}`,
          ),
        )
        .orderBy(dist)
        .limit(LIMIT),
      db
        .select({
          id: schema.kyivLore.id,
          name: schema.kyivLore.name,
          category: schema.kyivLore.category,
          lat: schema.kyivLore.lat,
          lng: schema.kyivLore.lng,
          dist,
        })
        .from(schema.kyivLore)
        .where(
          and(
            inArray(schema.kyivLore.category, LORE_CATEGORIES),
            sql`${dist} < ${radius}`,
          ),
        )
        .orderBy(dist)
        .limit(LIMIT),
    ]);

    // 'tourism' and 'religious' both mean "a landmark worth ending a
    // walk at" to the planner's scoring; only museums get their own
    // bias. Collapsing them here keeps the client's category table
    // short rather than mirroring the corpus's taxonomy into it.
    const merged: Destination[] = [
      ...parks.map((p) => ({
        id: p.id,
        name: p.nameUk || p.nameEn || 'без назви',
        category: p.category,
        position: { lat: p.lat, lng: p.lng },
        distM: Math.round(p.dist),
      })),
      ...landmarks.map((l) => ({
        id: l.id,
        name: l.name,
        category: l.category === 'museum' ? 'museum' : 'landmark',
        position: { lat: l.lat, lng: l.lng },
        distM: Math.round(l.dist),
      })),
    ]
      .sort((a, b) => a.distM - b.distM)
      .slice(0, LIMIT);

    return { destinations: merged };
  });
};

export default plugin;
