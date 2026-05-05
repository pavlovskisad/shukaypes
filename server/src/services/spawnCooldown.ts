// Spawn-topup gates that stop items from instantly respawning after
// a collect / eat. Each gate is best-effort — if Redis hiccups, we
// fall through to "allow topup" so the spawn pipeline keeps the map
// healthy even with no cache. Mirrors the path.ts pattern.
//
// Two flavours:
//   - User-area gate: requires the user to have moved
//     `userAreaMovementThresholdM` meters since the last topup, OR
//     `userAreaCooldownMs` to have elapsed. Either condition opens
//     the gate.
//   - Keyed gate: simple time-based lock for a per-pool key (a park,
//     a dog zone, etc). Used by parks + dog zones where movement
//     isn't the right signal — the pool is anchored to a fixed point,
//     not the walker.

import { redis } from '../db/redis.js';
import { balance } from '../config/balance.js';
import { distanceMeters, type LatLng } from '../utils/geo.js';

const TTL_S = 24 * 60 * 60;

interface UserAreaRecord {
  at: number;
  lat: number;
  lng: number;
}

function userAreaKey(userId: string): string {
  return `topup:user-area:${userId}`;
}

// Stable-string key for a per-pool cooldown. Lat/lng come as floats
// that DRIFT meaningfully between syncs — Google Places returns the
// same physical park at slightly different coords on re-fetch (we've
// seen 5-30m drift on big parks where sub-sections / entrances are
// inconsistently picked). The previous toFixed(5) (~1m precision)
// minted a fresh gate key for each drift step, so each drifted
// position spawned its own bone+paws round on the next 3min cycle and
// stacks accumulated. toFixed(3) snaps to a ~110m grid — same physical
// park within a few tens of meters of drift now hits the same gate.
// 110m is roughly the SERVER_PARK_DEDUP_M (150m) ballpark, comfortably
// above any legitimate drift while staying tighter than the client's
// 120m park-dedup threshold (so two genuinely distinct parks that
// survived client dedup are still very unlikely to grid-collide).
function poolKey(userId: string, kind: string, anchor: LatLng | string): string {
  const a = typeof anchor === 'string' ? anchor : `${anchor.lat.toFixed(3)}_${anchor.lng.toFixed(3)}`;
  return `topup:${kind}:${userId}:${a}`;
}

export async function shouldTopupUserArea(userId: string, pos: LatLng): Promise<boolean> {
  try {
    if (redis.status !== 'ready') return true;
    const raw = await redis.get(userAreaKey(userId));
    if (!raw) return true; // first sync — bootstrap.
    const rec = JSON.parse(raw) as UserAreaRecord;
    const elapsed = Date.now() - rec.at;
    if (elapsed >= balance.userAreaCooldownMs) return true;
    const moved = distanceMeters({ lat: rec.lat, lng: rec.lng }, pos);
    return moved >= balance.userAreaMovementThresholdM;
  } catch {
    return true;
  }
}

export async function noteUserAreaTopup(userId: string, pos: LatLng): Promise<void> {
  try {
    if (redis.status !== 'ready') return;
    const value: UserAreaRecord = { at: Date.now(), lat: pos.lat, lng: pos.lng };
    await redis.set(userAreaKey(userId), JSON.stringify(value), 'EX', TTL_S);
  } catch {
    /* best-effort */
  }
}

// Generic time-based gate for a (userId, kind, anchor) pool. Returns
// true if no record OR the record is older than `poolCooldownMs`.
async function shouldTopupKeyed(
  userId: string,
  kind: string,
  anchor: LatLng | string,
): Promise<boolean> {
  try {
    if (redis.status !== 'ready') return true;
    const raw = await redis.get(poolKey(userId, kind, anchor));
    if (!raw) return true;
    const at = Number(raw);
    if (!Number.isFinite(at)) return true;
    return Date.now() - at >= balance.poolCooldownMs;
  } catch {
    return true;
  }
}

async function noteKeyedTopup(
  userId: string,
  kind: string,
  anchor: LatLng | string,
): Promise<void> {
  try {
    if (redis.status !== 'ready') return;
    await redis.set(poolKey(userId, kind, anchor), String(Date.now()), 'EX', TTL_S);
  } catch {
    /* best-effort */
  }
}

export const parkPawsGate = {
  shouldTopup: (userId: string, anchor: LatLng) =>
    shouldTopupKeyed(userId, 'park-paws', anchor),
  note: (userId: string, anchor: LatLng) => noteKeyedTopup(userId, 'park-paws', anchor),
};

export const parkBonesGate = {
  shouldTopup: (userId: string, anchor: LatLng) =>
    shouldTopupKeyed(userId, 'park-bones', anchor),
  note: (userId: string, anchor: LatLng) => noteKeyedTopup(userId, 'park-bones', anchor),
};

export const dogZoneGate = {
  shouldTopup: (userId: string, dogId: string) => shouldTopupKeyed(userId, 'dog-zone', dogId),
  note: (userId: string, dogId: string) => noteKeyedTopup(userId, 'dog-zone', dogId),
};
