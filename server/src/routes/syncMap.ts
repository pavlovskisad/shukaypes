// Bulk endpoint that fetches everything the map needs in one
// round-trip. Replaces the client's serial /tokens/nearby +
// /food/nearby + /dogs/nearby + /state calls (4 round-trips → 1) so
// tab transitions and the 15s sync interval don't pay 4× the network
// cost.
//
// Internally still calls the same query helpers as the per-resource
// endpoints (services/mapData.ts), so there's no behaviour drift —
// just one HTTP call doing what four did.

import type { FastifyPluginAsync } from 'fastify';
import { ensureTokensForUser, ensureFoodForUser } from '../services/spawn.js';
import {
  fetchNearbyTokens,
  fetchNearbyFood,
  fetchNearbyLostDogs,
  fetchUserState,
} from '../services/mapData.js';
import type { LatLng } from '../utils/geo.js';

interface SyncMapQuery {
  lat: string;
  lng: string;
  // Optional pipe-delimited "lat,lng|lat,lng|..." park positions, same
  // shape /tokens/nearby + /food/nearby accepted. Used by spawn
  // top-up to seed paw rings + bones around parks.
  parks?: string;
  // Lost-pet radius — defaults match /dogs/nearby (5km) so existing
  // callers see no shape change.
  radius?: string;
}

function parseParks(raw?: string): LatLng[] {
  if (!raw) return [];
  const out: LatLng[] = [];
  for (const chunk of raw.split('|')) {
    const [latStr, lngStr] = chunk.split(',');
    const lat = Number(latStr);
    const lng = Number(lngStr);
    if (Number.isFinite(lat) && Number.isFinite(lng)) out.push({ lat, lng });
  }
  return out;
}

const plugin: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: SyncMapQuery }>('/sync/map', async (req, reply) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const radiusM = Number(req.query.radius ?? '5000');
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radiusM)) {
      reply.code(400);
      return { error: 'invalid query' };
    }

    const pos: LatLng = { lat, lng };
    const parks = parseParks(req.query.parks);

    // Top-up writes first (idempotent), then reads in parallel. The
    // ensure* calls have to land before the SELECT or the just-spawned
    // rows would miss this response — same ordering the per-resource
    // endpoints used.
    await Promise.all([
      ensureTokensForUser(req.userId, pos, parks),
      ensureFoodForUser(req.userId, pos, parks),
    ]);

    const [tokens, food, dogs, state] = await Promise.all([
      fetchNearbyTokens(req.userId, pos),
      fetchNearbyFood(req.userId),
      fetchNearbyLostDogs(pos, radiusM),
      fetchUserState(req.userId),
    ]);

    if (!state) {
      reply.code(404);
      return { error: 'user not found' };
    }

    return { tokens, food, dogs, state };
  });
};

export default plugin;
