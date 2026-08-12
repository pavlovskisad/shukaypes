// Server proxy for the client's nearby-spots + nearby-parks fetches.
// All Places API calls now go through here so we can cache shared
// across users (see services/placesCache.ts) and stop paying Google
// per device per pan.

import type { FastifyPluginAsync } from 'fastify';
import { nearbySpots } from '../services/placesCache.js';
import { limitExpensive } from '../lib/rateLimit.js';
import { KYIV_BBOX } from '../pipeline/upsert.js';

// Same category list the client previously fanned out across.
const SPOT_CATEGORIES = ['cafe', 'restaurant', 'bar', 'pet_store', 'veterinary_care'];

const DEFAULT_RADIUS_M = 1100;
const PARK_RADIUS_M = 1500;

// THE SPEND CEILING FOR THIS FILE.
//
// Every request here fans out into billable Google Nearby Search calls:
// one per 0.01° cell inside the radius, per category. The arithmetic is
// steep because it is quadratic in the radius. At Kyiv's latitude:
//
//   radius 1100m ->  3 × 5 cells  = 15  × 5 categories =  75 calls
//   radius 2000m ->  5 × 7 cells  = 35  × 5 categories = 175 calls
//   radius 5000m -> 11 × 17 cells = 187 × 5 categories = 935 calls
//
// The old cap was 5000m, so a single unauthenticated-shaped request
// could spend roughly $30 of somebody else's money. Cached for 14 days
// afterwards — which protects the steady state, and not at all the
// adversarial one.
//
// 2000m is above both defaults below with room to spare, and cuts the
// worst single request by more than 5×.
const MAX_RADIUS_M = 2000;
const MIN_RADIUS_M = 200;

interface NearbyQuery {
  lat?: string;
  lng?: string;
  radius?: string;
}

function clampRadius(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, n));
}

// Coordinates must be inside the city we actually serve.
//
// Without this, `lat`/`lng` are free floats and every fresh pair is a
// guaranteed cache miss — so the 14-day cache, which is the real cost
// control, can be walked straight past by asking about Rio, then Cairo,
// then anywhere else. Bounded to Kyiv, the cache has a finite domain:
// ~3,600 cells for the whole city, after which every request is free.
function parsePos(req: { query: NearbyQuery }): { lat: number; lng: number } | null {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < KYIV_BBOX.south || lat > KYIV_BBOX.north) return null;
  if (lng < KYIV_BBOX.west || lng > KYIV_BBOX.east) return null;
  return { lat, lng };
}

const plugin: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: NearbyQuery }>('/places/spots', limitExpensive, async (req, reply) => {
    const pos = parsePos(req);
    if (!pos) {
      reply.code(400);
      return { error: 'lat + lng required' };
    }
    const radiusM = clampRadius(req.query.radius, DEFAULT_RADIUS_M);
    const spots = await nearbySpots(pos, radiusM, SPOT_CATEGORIES);
    return { spots };
  });

  app.get<{ Querystring: NearbyQuery }>('/places/parks', limitExpensive, async (req, reply) => {
    const pos = parsePos(req);
    if (!pos) {
      reply.code(400);
      return { error: 'lat + lng required' };
    }
    const radiusM = clampRadius(req.query.radius, PARK_RADIUS_M);
    const spots = await nearbySpots(pos, radiusM, ['park']);
    // Park response shape matches what the client used to get from
    // its own fetchNearbyParks — just id + name + position.
    const parks = spots.map((p) => ({
      id: p.id,
      name: p.name,
      position: p.position,
    }));
    return { parks };
  });
};

export default plugin;
