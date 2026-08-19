// Kyiv-lore endpoints.
//
//   /lore/discover — the map's long-press "sniff this place" gesture.
//     Given a press point + a list of already-shown ids, returns one
//     nearby lore entry the dog can talk about. Pick strategy: take the
//     10 closest entries within radius, pick one at random. That gives
//     variety on re-press without ever surfacing a place too far from
//     where the human actually pointed.
//
//   /lore/route — the stops a planned walk should be re-plotted
//     through, so an ordinary walk becomes a small exploration. Takes
//     several candidate walks at once and answers for each, because the
//     client wants to spend its walk on the candidate with the most to
//     see and can only know which that is by asking.

import type { FastifyPluginAsync } from 'fastify';
import { and, notInArray, sql } from 'drizzle-orm';
import type { LatLng } from '../utils/geo.js';
import { db, schema } from '../db/index.js';
import { limitRead } from '../lib/rateLimit.js';
import {
  pathLengthM,
  planStops,
  waypointsThrough,
  type LorePoint,
  type LoreStop,
} from '../services/loreWalk.js';

const DEFAULT_RADIUS_M = 350;
const POOL_SIZE = 10;

// ---- /lore/route knobs -------------------------------------------------
//
// Ceilings, not preferences: the caller says how many stops it wants and
// how wide a corridor it will accept, and these bound what it can ask
// for. Everything else is derived from the length of the walk itself, so
// a 1 km stroll and a 3 km hike get proportionate treatment without the
// client having to restate its own intent.

// One request may ask about this many candidate walks. The client ranks
// its destinations and sends the top few; more than this is a client
// that has stopped choosing and started enumerating.
const MAX_ROUTES = 6;
// A candidate walk is origin + destination (+ via + home). Anything
// longer is not a shape this planner produces.
const MAX_PATH_POINTS = 8;
// KEEP THIS UNDER 8. Every stop becomes an INTERMEDIATE waypoint on the
// client's Google Routes call, and the Essentials SKU is "basic features
// with a maximum of 10 intermediate waypoints"; past ten, the same
// request bills at a higher tier. A roundtrip already spends two on the
// destination and the return via-point, so five stops is seven — under
// the line with room, and this project has already been surprised once
// by a Google bill (see placesCache in db/schema.ts).
const MAX_STOPS_CEILING = 5;
const DEFAULT_MAX_STOPS = 3;
// How far off the planned line a landmark may sit. The client passes a
// corridor scaled to the walk; these bound it. 350 m off a straight line
// is already a visible dog-leg on the map.
const MIN_CORRIDOR_M = 60;
const MAX_CORRIDOR_M = 350;
const DEFAULT_CORRIDOR_M = 200;
// Extra walking the stops may add, as a share of the planned distance,
// with a floor so short walks can still detour somewhere and a ceiling
// so long ones don't wander. A walk asked for at "close" must still feel
// close when it arrives.
const DETOUR_SHARE = 0.3;
const MIN_DETOUR_M = 250;
const MAX_DETOUR_M = 900;
// Stops closer together than this along the walk read as one stop with
// two labels. Scaled off the walk so a 3 km route doesn't cluster its
// stops in one square, floored so a 700 m one can still have two.
const SPACING_SHARE = 0.12;
const MIN_SPACING_M = 180;
// Ceiling on how many lore rows one request pulls. A 3 km roundtrip's
// bounding box over the old centre is the worst case; past this the
// extra rows are all far outside the corridor anyway and only cost
// projection time.
const POOL_LIMIT = 800;

interface RouteRequest {
  id: string;
  path: LatLng[];
}

function isLatLng(v: unknown): v is LatLng {
  if (!v || typeof v !== 'object') return false;
  const p = v as { lat?: unknown; lng?: unknown };
  return Number.isFinite(p.lat) && Number.isFinite(p.lng);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

const plugin: FastifyPluginAsync = async (app) => {
  app.get<{
    Querystring: {
      lat?: string;
      lng?: string;
      radius?: string;
      exclude?: string | string[];
    };
  }>('/lore/discover', limitRead, async (req, reply) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      reply.code(400);
      return { error: 'lat + lng required' };
    }
    const radius = Number.isFinite(Number(req.query.radius))
      ? Math.max(50, Math.min(2000, Number(req.query.radius)))
      : DEFAULT_RADIUS_M;
    // Fastify exposes repeated `?exclude=` query params as either a
    // single string or an array. Normalize.
    const rawEx = req.query.exclude;
    const exclude: string[] = Array.isArray(rawEx)
      ? rawEx
      : typeof rawEx === 'string' && rawEx.length > 0
        ? rawEx.split(',')
        : [];

    const dist = sql<number>`(6371000 * acos(cos(radians(${lat})) * cos(radians(lat)) * cos(radians(lng) - radians(${lng})) + sin(radians(${lat})) * sin(radians(lat))))`;
    const whereClauses = exclude.length
      ? and(sql`${dist} < ${radius}`, notInArray(schema.kyivLore.id, exclude))
      : sql`${dist} < ${radius}`;
    const pool = await db
      .select({
        id: schema.kyivLore.id,
        name: schema.kyivLore.name,
        category: schema.kyivLore.category,
        story: schema.kyivLore.story,
        wikipediaTitle: schema.kyivLore.wikipediaTitle,
        sourceLang: schema.kyivLore.sourceLang,
        lat: schema.kyivLore.lat,
        lng: schema.kyivLore.lng,
        dist,
      })
      .from(schema.kyivLore)
      .where(whereClauses)
      .orderBy(dist)
      .limit(POOL_SIZE);

    if (pool.length === 0) {
      return { lore: null };
    }
    const pick = pool[Math.floor(Math.random() * pool.length)]!;
    return {
      lore: {
        id: pick.id,
        name: pick.name,
        category: pick.category,
        story: pick.story,
        // Wikipedia handles for the on-demand "read more" — client
        // fetches the public summary endpoint when the user expands.
        wikipediaTitle: pick.wikipediaTitle,
        sourceLang: pick.sourceLang,
        position: { lat: pick.lat, lng: pick.lng },
        distM: Math.round(pick.dist),
      },
    };
  });

  // The stops for a set of candidate walks.
  //
  // POST for a read, because the payload is several polylines and a
  // list of ids — a query string that would be pushing a kilobyte and
  // would land in every access log along the way.
  //
  // One bounding-box query serves every candidate: the candidates all
  // start from the same walker, so their boxes overlap almost entirely
  // and N narrow queries would re-read the same rows N times.
  app.post<{
    Body: {
      routes?: unknown;
      exclude?: unknown;
      maxStops?: unknown;
      corridorM?: unknown;
    };
  }>('/lore/route', limitRead, async (req, reply) => {
    const rawRoutes = Array.isArray(req.body?.routes) ? req.body.routes : null;
    if (!rawRoutes || rawRoutes.length === 0) {
      reply.code(400);
      return { error: 'routes required' };
    }
    const routes: RouteRequest[] = [];
    for (const r of rawRoutes.slice(0, MAX_ROUTES)) {
      const cand = r as { id?: unknown; path?: unknown };
      if (typeof cand.id !== 'string' || !Array.isArray(cand.path)) continue;
      const path = cand.path.slice(0, MAX_PATH_POINTS).filter(isLatLng);
      if (path.length < 2) continue;
      routes.push({ id: cand.id, path });
    }
    if (routes.length === 0) {
      reply.code(400);
      return { error: 'no usable route' };
    }

    // typeof, not Number(): Number(null) is 0, which would quietly turn a
    // null into "one stop" instead of falling through to the default.
    const rawStops = req.body?.maxStops;
    const maxStops =
      typeof rawStops === 'number' && Number.isFinite(rawStops)
        ? clamp(Math.round(rawStops), 1, MAX_STOPS_CEILING)
        : DEFAULT_MAX_STOPS;
    const rawCorridor = req.body?.corridorM;
    const corridorM =
      typeof rawCorridor === 'number' && Number.isFinite(rawCorridor)
        ? clamp(rawCorridor, MIN_CORRIDOR_M, MAX_CORRIDOR_M)
        : DEFAULT_CORRIDOR_M;
    const rawEx = req.body?.exclude;
    const exclude = Array.isArray(rawEx)
      ? rawEx.filter((x): x is string => typeof x === 'string').slice(0, 60)
      : [];

    // Bounding box over every candidate, padded by the corridor so a
    // landmark just off the end of the longest walk is still in the
    // pool. Degrees rather than haversine on purpose: this is the shape
    // lore_lat_lng_idx can actually serve, and planStops does the real
    // distance work on what comes back.
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;
    for (const r of routes) {
      for (const p of r.path) {
        if (p.lat < minLat) minLat = p.lat;
        if (p.lat > maxLat) maxLat = p.lat;
        if (p.lng < minLng) minLng = p.lng;
        if (p.lng > maxLng) maxLng = p.lng;
      }
    }
    const padLat = corridorM / 111_320;
    const padLng =
      corridorM / (111_320 * Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180));

    const bbox = sql`lat BETWEEN ${minLat - padLat} AND ${maxLat + padLat} AND lng BETWEEN ${minLng - padLng} AND ${maxLng + padLng}`;
    const pool: LorePoint[] = await db
      .select({
        id: schema.kyivLore.id,
        name: schema.kyivLore.name,
        category: schema.kyivLore.category,
        story: schema.kyivLore.story,
        wikipediaTitle: schema.kyivLore.wikipediaTitle,
        sourceLang: schema.kyivLore.sourceLang,
        lat: schema.kyivLore.lat,
        lng: schema.kyivLore.lng,
      })
      .from(schema.kyivLore)
      .where(exclude.length ? and(bbox, notInArray(schema.kyivLore.id, exclude)) : bbox)
      .limit(POOL_LIMIT);

    // A truncated pool is a worse walk chosen from a partial city, and it
    // looks exactly like a good one. The ceiling is set well above the
    // densest bounding box this endpoint sees, so reaching it means the
    // corpus grew past the assumption rather than that today's walk is
    // fine.
    if (pool.length === POOL_LIMIT) {
      req.log.warn(
        { poolLimit: POOL_LIMIT, corridorM },
        '[lore/route] landmark pool hit its ceiling — stops chosen from a truncated set',
      );
    }

    const results = routes.map((r) => {
      const totalM = pathLengthM(r.path);
      const stops: LoreStop[] = planStops({
        path: r.path,
        pool,
        corridorM,
        maxStops,
        minSpacingM: Math.max(MIN_SPACING_M, totalM * SPACING_SHARE),
        maxDetourM: clamp(totalM * DETOUR_SHARE, MIN_DETOUR_M, MAX_DETOUR_M),
      });
      return {
        id: r.id,
        stops,
        // The re-plotted walk, ready to hand to the directions call.
        // Origin excluded — that argument is passed separately — so an
        // empty stop list gives back exactly the path the client sent.
        waypoints: waypointsThrough(r.path, stops),
      };
    });

    return { results, poolSize: pool.length };
  });
};

export default plugin;
