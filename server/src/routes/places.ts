// Server proxy for the client's nearby-spots + nearby-parks fetches.
// All Places API calls now go through here so we can cache shared
// across users (see services/placesCache.ts) and stop paying Google
// per device per pan.

import type { FastifyPluginAsync } from 'fastify';
import { nearbySpots } from '../services/placesCache.js';

// Same category list the client previously fanned out across.
const SPOT_CATEGORIES = ['cafe', 'restaurant', 'bar', 'pet_store', 'veterinary_care'];

const DEFAULT_RADIUS_M = 1100;
const PARK_RADIUS_M = 1500;

interface NearbyQuery {
  lat?: string;
  lng?: string;
  radius?: string;
}

function parsePos(req: { query: NearbyQuery }): { lat: number; lng: number } | null {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

const plugin: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: NearbyQuery }>('/places/spots', async (req, reply) => {
    const pos = parsePos(req);
    if (!pos) {
      reply.code(400);
      return { error: 'lat + lng required' };
    }
    const radiusM = Number.isFinite(Number(req.query.radius))
      ? Math.min(5000, Math.max(200, Number(req.query.radius)))
      : DEFAULT_RADIUS_M;
    const spots = await nearbySpots(pos, radiusM, SPOT_CATEGORIES);
    return { spots };
  });

  app.get<{ Querystring: NearbyQuery }>('/places/parks', async (req, reply) => {
    const pos = parsePos(req);
    if (!pos) {
      reply.code(400);
      return { error: 'lat + lng required' };
    }
    const radiusM = Number.isFinite(Number(req.query.radius))
      ? Math.min(5000, Math.max(200, Number(req.query.radius)))
      : PARK_RADIUS_M;
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
