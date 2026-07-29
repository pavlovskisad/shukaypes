// Bot walkers for the multiplayer presence system.
//
// A pool of simulated dogs that behave like people out walking: they roam,
// linger, and go OFFLINE for a while then come back — so the live population
// breathes (connect/reconnect) instead of drifting uniformly forever. They
// write into the SAME Redis presence set as real players, so to a client
// they're indistinguishable. Enabled via MULTIPLAYER_BOTS=<count> (0 = off).
//
// Each bot LIVES ON ITS OWN PATCH. Its home is picked once from the hotspot
// list (separated from every other bot's), it seeds territory there, and it
// walks that ground rather than touring the city. Before that, the dog you
// met on the street had its zone kilometres away, which made the territory
// layer read as unrelated scenery — and its marks smeared a thin trail
// across the map instead of building anything worth taking.
//
// The same cron also purges stale presence, so real-player presence works
// even with 0 bots.

import type { FastifyBaseLogger } from 'fastify';
import { writePresenceBatch, purgeStalePresence, type PresenceEntry } from './presence.js';
import { runCronTick } from './cronUtils.js';
import { db, schema } from '../db/index.js';
import { balance } from '../config/balance.js';
import { markAsBot, seedBotTerritory } from './territory.js';

interface LatLng {
  lat: number;
  lng: number;
}

// Central Kyiv parks / squares / landmarks the bots gravitate to and linger
// at, so they cluster like real walkers do rather than scattering evenly.
const HOTSPOTS: LatLng[] = [
  { lat: 50.4500, lng: 30.5236 }, // Maidan Nezalezhnosti
  { lat: 50.4577, lng: 30.5230 }, // Volodymyrska Hirka
  { lat: 50.4470, lng: 30.5385 }, // Mariinsky Park
  { lat: 50.4433, lng: 30.5145 }, // Shevchenko Park
  { lat: 50.4655, lng: 30.5155 }, // Kontraktova Sq (Podil)
  { lat: 50.4485, lng: 30.5130 }, // Golden Gate
  { lat: 50.4600, lng: 30.5157 }, // Peizazhna Alley
  { lat: 50.4595, lng: 30.5265 }, // Poshtova Sq
  { lat: 50.4523, lng: 30.5147 }, // St. Sophia
  { lat: 50.4330, lng: 30.5215 }, // Olimpiiska
];

// How far a bot wanders from the patch it holds. Sized against
// botSeedSpreadM (260m), so a bot on an ordinary outing is walking over
// its own marks — which is what keeps it renewing them, and what makes
// meeting one feel like meeting a neighbour rather than a tourist.
const HOME_RANGE_M = 300;
// …and RAIDING TRIPS well past its own edge, deep enough to reach the
// neighbours (homes are ≥420m apart, so 950m puts a bot squarely inside
// somebody else's range). Nearly half of all outings, because a city
// where everyone stays politely home has no border war in it — and
// because a bot at its mark ceiling now takes ground instead of renewing
// when it's standing on a rival, so these trips actually cost the
// neighbour something.
const HOME_STROLL_M = 950;
const HOME_STROLL_CHANCE = 0.45;
const SPEED_MIN = 1.1; // m/s
const SPEED_MAX = 1.9;
const ARRIVE_M = 22;
const DWELL_MIN_MS = 15_000; // linger at a destination
const DWELL_MAX_MS = 90_000;
const OFFLINE_CHANCE = 0.14; // after a dwell, chance to "log off"
const OFFLINE_MIN_MS = 60_000;
const OFFLINE_MAX_MS = 240_000;
const TICK_MS = 3500;
const MAX_DT_S = 10;

const NAMES = [
  'Рекс', 'Барон', 'Лакі', 'Бім', 'Джек', 'Марс', 'Тузік', 'Шарік',
  'Найда', 'Белла', 'Молі', 'Чапа', 'Персик', 'Умка', 'Гав', 'Кузя',
  'Арчі', 'Боня', 'Джесі', 'Локі',
];

const mPerLat = 110540;
const mPerLng = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);
const rand = (min: number, max: number) => min + Math.random() * (max - min);

function offset(base: LatLng, radiusM: number): LatLng {
  const ang = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.random()) * radiusM; // uniform over the disc
  return {
    lat: base.lat + (r * Math.cos(ang)) / mPerLat,
    lng: base.lng + (r * Math.sin(ang)) / mPerLng(base.lat),
  };
}

function distM(a: LatLng, b: LatLng): number {
  const dN = (a.lat - b.lat) * mPerLat;
  const dE = (a.lng - b.lng) * mPerLng(a.lat);
  return Math.sqrt(dN * dN + dE * dE);
}

// Next destination. Bots WALK THEIR OWN PATCH — or go and take somebody
// else's.
//
// They used to roam the whole city, hopping between landmarks — which
// meant the dog you saw walking past had its territory kilometres away
// (Марс was 3.7km from its own zone). Nothing about that read as
// "neighbours holding ground". A dog you meet should be standing on the
// ground it defends, and its marks should land there and keep the patch
// coherent rather than smearing a thin trail across the map.
function newTarget(b: Bot): LatLng {
  // …and about half the time it goes RAIDING instead — far enough out to
  // be standing in a neighbour's range, where its next mark takes ground
  // rather than renewing its own. Still anchored on home, so however far
  // it pushes it always has somewhere to come back to.
  const r = Math.random() < HOME_STROLL_CHANCE ? HOME_STROLL_M : HOME_RANGE_M;
  return offset(b.home, r);
}

type BotState = 'walk' | 'dwell' | 'offline';

interface Bot {
  id: string;
  pos: LatLng;
  target: LatLng;
  name: string;
  speed: number;
  state: BotState;
  until: number; // ms timestamp the current dwell/offline ends
  // Territory. Bots hold ground so a city without real players still has
  // something to take — and so the PvP half of the mechanic is testable
  // before the population exists.
  home: LatLng; // the patch they seed and keep coming back to
  lastMarkAt: number;
  // Where it last marked. Same spacing rule the player's dog gets: never
  // twice on the same patch in a row, but free to mark near an OLDER mark
  // (which renews and hardens it). Held here rather than in the database
  // because it's pacing, not ownership.
  lastMarkPos: LatLng | null;
}

// Where each bot keeps its territory: its hotspot if that's still free,
// otherwise outward around a ring until it finds room.
//
// Deterministic — same layout on every boot, so a restart doesn't
// reshuffle who lives where — and, more importantly, SEPARATED. Two bots
// whose patches sit on top of each other spend their lives contesting the
// same marks (a rival mark within contestM knocks yours down), so neither
// ever holds anything and the map just shows them flickering. A naive
// per-hotspot ring isn't enough: rings around two nearby hotspots can
// collide, which put two bots 20m apart in the first cut.
const HOME_RING_M = 450;
const HOME_MIN_SEP_M = 420;
// Golden angle: successive attempts land on different bearings instead of
// marching along one line, so a crowded hotspot fills evenly.
const GOLDEN_ANGLE = 2.399963;

function planHomes(count: number): LatLng[] {
  const homes: LatLng[] = [];
  const clear = (c: LatLng) => homes.every((h) => distM(h, c) >= HOME_MIN_SEP_M);
  for (let i = 0; i < count; i++) {
    const spot = HOTSPOTS[i % HOTSPOTS.length]!;
    let chosen: LatLng | null = clear(spot) ? spot : null;
    for (let step = 1; step <= 64 && !chosen; step++) {
      // Widen the ring every eighth attempt, so we exhaust the bearings
      // at one radius before pushing further from the park.
      const r = HOME_RING_M * (1 + Math.floor((step - 1) / 8));
      const ang = step * GOLDEN_ANGLE;
      const cand: LatLng = {
        lat: spot.lat + (r * Math.cos(ang)) / mPerLat,
        lng: spot.lng + (r * Math.sin(ang)) / mPerLng(spot.lat),
      };
      if (clear(cand)) chosen = cand;
    }
    // Nowhere clear within 8 rings — take the hotspot and accept the
    // crowding rather than pushing a bot out to the edge of the city.
    homes.push(chosen ?? spot);
  }
  return homes;
}

function spawnBot(i: number, home: LatLng): Bot {
  // Start at home, not scattered across the city — a bot's first marks
  // should land on the patch it's going to defend.
  const pos = offset(home, HOME_RANGE_M);
  const bot: Bot = {
    id: `bot:${i}`,
    pos,
    target: pos,
    name: NAMES[i % NAMES.length]!,
    speed: rand(SPEED_MIN, SPEED_MAX),
    state: 'walk',
    until: 0,
    home,
    // Stagger the first marks so a restart doesn't fire the whole pool
    // into the same tick.
    lastMarkAt: Date.now() - rand(0, balance.territory.botMarkCooldownMs),
    lastMarkPos: null,
  };
  bot.target = newTarget(bot);
  return bot;
}

// Bots write into the same presence set as people, but owning marks needs
// a real user row (the FKs are real). They're created once, keyed on the
// same `bot:N` id, and are otherwise inert: no companion state, no
// tokens, no sync. `isBot` in the territory service is what keeps them
// from being sent notifications nobody reads.
async function ensureBotUsers(bots: Bot[]): Promise<void> {
  if (!bots.length) return;
  await db
    .insert(schema.users)
    .values(
      bots.map((b) => ({ id: b.id, deviceId: b.id, username: b.name })),
    )
    .onConflictDoNothing();
}

function stepTowardTarget(b: Bot, dtS: number): void {
  const d = distM(b.pos, b.target);
  if (d < ARRIVE_M) return;
  const move = Math.min(d, b.speed * dtS);
  const dN = (b.target.lat - b.pos.lat) * mPerLat;
  const dE = (b.target.lng - b.pos.lng) * mPerLng(b.pos.lat);
  b.pos = {
    lat: b.pos.lat + ((dN / d) * move) / mPerLat,
    lng: b.pos.lng + ((dE / d) * move) / mPerLng(b.pos.lat),
  };
}

// Advance one bot's state machine. Returns true if it's ONLINE (should be
// published to presence this tick).
function tickBot(b: Bot, dtS: number, now: number): boolean {
  switch (b.state) {
    case 'offline':
      if (now >= b.until) {
        // Come back "online" on their own patch — they live there.
        b.pos = offset(b.home, HOME_RANGE_M);
        b.target = newTarget(b);
        b.speed = rand(SPEED_MIN, SPEED_MAX);
        b.state = 'walk';
        return true;
      }
      return false;
    case 'dwell':
      if (now >= b.until) {
        if (Math.random() < OFFLINE_CHANCE) {
          b.state = 'offline';
          b.until = now + rand(OFFLINE_MIN_MS, OFFLINE_MAX_MS);
          return false; // stops publishing → expires from presence → vanishes
        }
        b.state = 'walk';
        b.target = newTarget(b);
      }
      return true;
    case 'walk':
    default:
      stepTowardTarget(b, dtS);
      if (distM(b.pos, b.target) < ARRIVE_M) {
        b.state = 'dwell';
        b.until = now + rand(DWELL_MIN_MS, DWELL_MAX_MS);
      }
      return true;
  }
}

// Starts the presence maintenance cron: advances + publishes any ONLINE bots,
// and purges stale entries. Returns a stop fn. botCount 0 → purge-only (real
// presence still works).
export function startMultiplayerCron(
  log: FastifyBaseLogger,
  botCount: number,
): () => void {
  const count = Math.max(0, botCount);
  const homes = planHomes(count);
  const bots: Bot[] = Array.from({ length: count }, (_, i) => spawnBot(i, homes[i]!));
  if (bots.length) {
    log.info({ kind: 'mp_bots', count: bots.length }, `multiplayer: spawned ${bots.length} bot walkers`);
  }
  // Give the pool their user rows and a starting patch each, so the very
  // first walk a real player takes already has ground to run into.
  // Best-effort: a bot that can't be seeded just walks without marking.
  if (bots.length) {
    void (async () => {
      try {
        await ensureBotUsers(bots);
        for (const b of bots) await seedBotTerritory(b.id, b.name, b.home);
        log.info({ kind: 'mp_bots_territory', count: bots.length }, 'multiplayer: bot territory seeded');
      } catch (err) {
        log.warn({ err, kind: 'mp_bots_territory' }, 'multiplayer: bot territory seeding failed');
      }
    })();
  }

  let last = Date.now();
  const id = setInterval(() => {
    void runCronTick(
      'multiplayer',
      async () => {
        const now = Date.now();
        const dtS = Math.min(MAX_DT_S, (now - last) / 1000);
        last = now;
        if (bots.length) {
          const online: PresenceEntry[] = [];
          const marking: Bot[] = [];
          for (const b of bots) {
            if (!tickBot(b, dtS, now)) continue;
            online.push({ id: b.id, pos: b.pos, name: b.name, photo: null, bot: true });
            // Bots mark where they linger, not mid-stride — same instinct
            // a real dog has at a park, and it keeps their ground where
            // people actually walk instead of smeared along a route.
            if (
              b.state === 'dwell' &&
              now - b.lastMarkAt >= balance.territory.botMarkCooldownMs &&
              // …and not on the patch it just marked, so a patch grows
              // outward instead of piling onto one bench.
              (!b.lastMarkPos ||
                distM(b.pos, b.lastMarkPos) >= balance.territory.minDistanceM)
            ) {
              b.lastMarkAt = now;
              b.lastMarkPos = b.pos;
              marking.push(b);
            }
          }
          await writePresenceBatch(online, now);
          // Sequential: a handful of marks per tick at most, and running
          // them in parallel would have bots inside one hotspot contest
          // each other off the same pre-read snapshot.
          for (const b of marking) {
            try {
              // A bot driven off its ground entirely goes home and starts
              // again. Without this, aggression is a one-way ratchet: bots
              // raid each other to zero, seeding only ever runs at boot,
              // and the city consolidates into a handful of holders with
              // most of the map blank. No-ops unless it holds nothing.
              await seedBotTerritory(b.id, b.name, b.home);
              await markAsBot(b.id, b.name, b.pos);
            } catch (err) {
              log.warn({ err, kind: 'mp_bot_mark' }, 'multiplayer: bot mark failed');
            }
          }
        }
        await purgeStalePresence(now);
      },
      log,
    );
  }, TICK_MS);
  id.unref?.();
  return () => clearInterval(id);
}
