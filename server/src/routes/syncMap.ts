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
import { syncPresence, takePokes } from '../services/presence.js';
import {
  fetchMapTerritory,
  noteHomeGround,
  resetTerritory,
  simulateRaidOnSelf,
  takeRaids,
  territoryLeaderboard,
  territoryStanding,
} from '../services/territory.js';
import type { LatLng } from '../utils/geo.js';

// Server kill-switch for multiplayer presence. Off only if explicitly set to
// 'off'; otherwise presence runs when the client opts in via `mp=1` (so prod
// clients that don't send the flag neither appear to nor see other players).
const MULTIPLAYER_ON = process.env.MULTIPLAYER !== 'off';

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
  // '1' when the client wants multiplayer presence (write self position +
  // return nearby players). Only the multiplayer-enabled build sends it.
  mp?: string;
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
  // Wipe the caller's own territory. Only ever touches your own ground, so
  // it needs no special guard — and it makes the mechanic re-testable from
  // a clean slate without going near the database.
  app.post('/territory/reset', async (req) => {
    await resetTerritory(req.userId);
    return { ok: true };
  });

  // Send a bot onto your newest mark so the raid path can be exercised
  // without waiting for one to wander in on its own. Real contest, real
  // raid row — and it can only cost the caller their own ground.
  app.post('/territory/raid-test', async (req) => {
    const ok = await simulateRaidOnSelf(req.userId);
    return { ok };
  });

  // Who holds the most of the city, plus where the caller stands. Read
  // from the profile tab rather than the map, so it's its own trip —
  // putting it on the 15s sync would recompute a scoreboard nobody is
  // looking at.
  app.get('/territory/leaderboard', async (req) => {
    // Sequential on purpose: the standing needs the board to find your
    // rank in it, and running both concurrently would have each miss the
    // cache and recompute every hull in the city twice.
    const board = await territoryLeaderboard().catch(() => []);
    const you = await territoryStanding(req.userId, board).catch(() => ({
      areaM2: 0,
      rank: null,
    }));
    return { board, you };
  });

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

    // Territory comes FIRST, alone: the spawn topup below needs to know
    // whether the walker is on home ground (paws are denser there). One
    // read of every mark in view serves the dots, your shapes, everyone
    // else's, and the home flag — they all come out of a single partition,
    // which is what stops two people holding the same block.
    const territory = await fetchMapTerritory(req.userId, pos, radiusM).catch(() => null);
    const home = territory?.home ?? false;

    // Top-up writes next (idempotent), then reads in parallel. The
    // ensure* calls have to land before the SELECT or the just-spawned
    // rows would miss this response — same ordering the per-resource
    // endpoints used.
    await Promise.all([
      ensureTokensForUser(req.userId, pos, parks, { home }),
      ensureFoodForUser(req.userId, pos, parks),
      // Remember home ground for the decay cron, which can branch on a
      // column but can't compute a hull. Writes only on a change, and
      // never blocks the map on a hiccup.
      noteHomeGround(req.userId, home).catch(() => {}),
    ]);

    const wantPlayers = MULTIPLAYER_ON && req.query.mp === '1';

    const [tokens, food, dogs, state, players, pokes, raids] =
      await Promise.all([
      fetchNearbyTokens(req.userId, pos),
      fetchNearbyFood(req.userId),
      fetchNearbyLostDogs(pos, radiusM),
      fetchUserState(req.userId),
      // Presence never blocks the map response — on any Redis hiccup we just
      // return no players / pokes.
      wantPlayers ? syncPresence(req.userId, pos).catch(() => []) : Promise.resolve([]),
      wantPlayers ? takePokes(req.userId).catch(() => []) : Promise.resolve([]),
      // "Somebody took your territory, dawg!" — queued in Postgres rather
      // than Redis so a raid that lands overnight still reaches you.
      takeRaids(req.userId).catch(() => []),
    ]);

    if (!state) {
      reply.code(404);
      return { error: 'user not found' };
    }

    return {
      tokens,
      food,
      dogs,
      state,
      players,
      pokes,
      marks: territory?.marks ?? [],
      shapes: territory?.shapes ?? [],
      // Neighbours' just-made marks, so a border moving has a visible cause.
      rivalMarks: territory?.rivalMarks ?? [],
      // Everyone else's ground in view, each tagged with its owner so the
      // client can give them their own colour.
      rivals: territory?.rivals ?? [],
      // Standing on ground you hold — the passive perks hang off this.
      // Area held is deliberately NOT reported here: the standing endpoint
      // owns that number, and two places computing it is how they drift.
      home,
      raids,
    };
  });
};

export default plugin;
