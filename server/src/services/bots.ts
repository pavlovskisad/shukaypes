// Bot walkers for the multiplayer presence system.
//
// A pool of simulated dogs that random-walk around Kyiv and write into the
// SAME Redis presence set as real players (services/presence.ts), so to a
// multiplayer-enabled client they look exactly like other people out walking.
// This lets us populate + tune the multiplayer UX before real player density
// exists. Enabled via MULTIPLAYER_BOTS=<count> (0 = off, default).
//
// The same cron also purges stale presence entries, so real-player presence
// works even when no bots run.

import type { FastifyBaseLogger } from 'fastify';
import { writePresenceBatch, purgeStalePresence } from './presence.js';
import { runCronTick } from './cronUtils.js';

interface LatLng {
  lat: number;
  lng: number;
}

const KYIV: LatLng = { lat: 50.4501, lng: 30.5234 };
const SPREAD_M = 5500; // initial scatter radius across the city
const ROAM_M = 700; // how far a bot picks its next destination
const SPEED_MS = 1.5; // walking pace
const ARRIVE_M = 25; // "reached destination" threshold
const TICK_MS = 3500;
const MAX_DT_S = 10; // clamp dt so a paused machine doesn't teleport bots

const NAMES = [
  'Рекс', 'Барон', 'Лакі', 'Бім', 'Джек', 'Марс', 'Тузік', 'Шарік',
  'Найда', 'Белла', 'Молі', 'Чапа', 'Персик', 'Умка', 'Гав', 'Кузя',
  'Арчі', 'Боня', 'Джесі', 'Локі',
];

const mPerLat = 110540;
const mPerLng = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);

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

interface Bot {
  id: string;
  pos: LatLng;
  target: LatLng;
  name: string;
}

function newTarget(from: LatLng): LatLng {
  const t = offset(from, ROAM_M);
  // Keep bots roaming within the city envelope — if a hop would stray too
  // far, aim back toward the centre instead.
  if (distM(t, KYIV) > SPREAD_M) return offset(KYIV, SPREAD_M * 0.7);
  return t;
}

function spawnBot(i: number): Bot {
  const pos = offset(KYIV, SPREAD_M);
  return {
    id: `bot:${i}`,
    pos,
    target: newTarget(pos),
    name: NAMES[i % NAMES.length]!,
  };
}

function stepBot(b: Bot, dtS: number): void {
  const d = distM(b.pos, b.target);
  if (d < ARRIVE_M) {
    b.target = newTarget(b.pos);
    return;
  }
  const move = Math.min(d, SPEED_MS * dtS);
  const dN = (b.target.lat - b.pos.lat) * mPerLat;
  const dE = (b.target.lng - b.pos.lng) * mPerLng(b.pos.lat);
  b.pos = {
    lat: b.pos.lat + ((dN / d) * move) / mPerLat,
    lng: b.pos.lng + ((dE / d) * move) / mPerLng(b.pos.lat),
  };
}

// Starts the presence maintenance cron: steps + writes any bots, and purges
// stale entries. Returns a stop fn. botCount 0 → purge-only (real presence
// still works).
export function startMultiplayerCron(
  log: FastifyBaseLogger,
  botCount: number,
): () => void {
  const bots: Bot[] = Array.from({ length: Math.max(0, botCount) }, (_, i) =>
    spawnBot(i),
  );
  if (bots.length) {
    log.info({ kind: 'mp_bots', count: bots.length }, `multiplayer: spawned ${bots.length} bot walkers`);
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
          for (const b of bots) stepBot(b, dtS);
          // All bots in ONE round-trip.
          await writePresenceBatch(
            bots.map((b) => ({
              id: b.id,
              pos: b.pos,
              name: b.name,
              photo: null,
              bot: true,
            })),
            now,
          );
        }
        await purgeStalePresence(now);
      },
      log,
    );
  }, TICK_MS);
  id.unref?.();
  return () => clearInterval(id);
}
