// Bulk endpoint that fetches everything the map needs in one
// round-trip. Replaces the client's serial /tokens/nearby +
// /food/nearby + /dogs/nearby + /state calls (4 round-trips → 1) so
// tab transitions and the 15s sync interval don't pay 4× the network
// cost.
//
// Internally still calls the same query helpers as the per-resource
// endpoints (services/mapData.ts), so there's no behaviour drift —
// just one HTTP call doing what four did.

import { createHash } from 'node:crypto';
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
import { limitExpensive, limitPolling, limitRead } from '../lib/rateLimit.js';
import { DEV_KEY_HEADER, devAccessAllowed } from '../lib/devAuth.js';

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
  // The fingerprint of the pets list this client already holds. Matching
  // means we send `dogs: null` instead of re-sending an identical 29 KB.
  // Absent on a first sync and from any older client, which then simply
  // gets the full list as before.
  dogsTag?: string;
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
  // POSITIONS ONLY, and nothing else — no Postgres, no territory, no
  // partition. One Redis geo read.
  //
  // Split out because /sync/map bundles the most latency-sensitive data
  // with the least. Measured on prod: other dogs' positions are 3.7KB of a
  // 66.4KB payload (6%), while the territory in the other 94% only changes
  // every few minutes — and the partition behind it costs 2.47s of a 3.57s
  // sync. Polling the whole thing faster to make the dogs smoother would
  // have meant 80MB/hour of mobile data and five times the query load, to
  // refresh polygons that had not moved.
  //
  // The floor on how fresh this can be is the SIMULATION, not the
  // transport: bots step on a 3.5s server tick and real GPS lands about
  // once a second, so there is nothing to gain below ~3s and no protocol
  // that could find it.
  app.get<{ Querystring: { lat: string; lng: string } }>('/presence', limitPolling, async (req) => {
    if (!MULTIPLAYER_ON) return { players: [] };
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { players: [] };
    // Same call /sync/map makes, so the two can never disagree about who
    // is nearby: it publishes the caller's own position and reads back the
    // neighbours in one trip.
    const players = await syncPresence(req.userId, { lat, lng }).catch(() => []);
    return { players };
  });

  // Wipe the caller's own territory. Only ever touches your own ground, so
  // it needs no special guard — and it makes the mechanic re-testable from
  // a clean slate without going near the database.
  //
  // The client half is DEV_TOOLS-gated (app/constants/devTools.ts), but a
  // flag in a browser is a suggestion — anyone can flip it in devtools. So
  // this destructive route asks for the shared dev password itself, and
  // the client sends it from whatever the operator typed at /dev.
  // 404, not 403 — there is nothing here to discover.
  app.post('/territory/reset', limitExpensive, async (req, reply) => {
    if (!devAccessAllowed(req.headers[DEV_KEY_HEADER])) {
      return reply.code(404).send({ error: 'not found' });
    }
    await resetTerritory(req.userId);
    return { ok: true };
  });

  // Send a bot onto your newest mark so the raid path can be exercised
  // without waiting for one to wander in on its own. Real contest, real
  // raid row — and it can only cost the caller their own ground.
  app.post('/territory/raid-test', limitExpensive, async (req, reply) => {
    if (!devAccessAllowed(req.headers[DEV_KEY_HEADER])) {
      return reply.code(404).send({ error: 'not found' });
    }
    const ok = await simulateRaidOnSelf(req.userId);
    return { ok };
  });

  // Who holds the most of the city, plus where the caller stands. Read
  // from the profile tab rather than the map, so it's its own trip —
  // putting it on the 15s sync would recompute a scoreboard nobody is
  // looking at.
  app.get('/territory/leaderboard', limitRead, async (req) => {
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

  app.get<{ Querystring: SyncMapQuery }>('/sync/map', limitPolling, async (req, reply) => {
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

    // THE PETS LIST IS THE BIGGEST THING IN THIS RESPONSE, AND THE ONE
    // THAT ALMOST NEVER CHANGES.
    //
    // Measured against a database seeded to production's shape — 244
    // active pets, six rivals holding full territory — `dogs` was 29.3 KB
    // of a 54 KB response: 49%, larger than rivalMarks and rivals
    // together. It is re-sent in full every 15 seconds. OLX inserts about
    // seventeen pets a WEEK, so all but a handful of those sends are
    // byte-for-byte identical to the last one.
    //
    // So the client echoes back the fingerprint it last received and gets
    // `dogs: null` when nothing has moved, meaning "keep what you have".
    // Null rather than an omitted key, because an absent field and an
    // empty list must not be confusable: "no pets near you" is a real
    // answer that has to survive this.
    //
    // The fingerprint is over the serialised payload, so ANY change —
    // a new pet, a moved pin, an expiry, an edited photo — produces a
    // different one. Cheap: one hash of a string we already built.
    const dogsPayload = JSON.stringify(dogs);
    const dogsTag = createHash('sha1').update(dogsPayload).digest('base64url').slice(0, 16);
    const unchanged = typeof req.query.dogsTag === 'string' && req.query.dogsTag === dogsTag;

    return {
      tokens,
      food,
      dogs: unchanged ? null : dogs,
      dogsTag,
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
