// Spawn-topup gates that stop items from instantly respawning after
// a collect / eat. Each gate is best-effort — if Redis hiccups, we
// fall through to "allow topup" so the spawn pipeline keeps the map
// healthy even with no cache. Mirrors the path.ts pattern.
//
// Two flavours:
//   - User-area gate: requires the user to have moved
//     `userAreaMovementThresholdM` meters since the last topup, OR
//     `userAreaCooldownMs` to have elapsed. Either condition opens
//     the gate. Wrapped in a tiny race-lock so two syncs landing in
//     the same millisecond don't both pass the check.
//   - Per-pool gate (park paws, park bones, dog zones): simple
//     time-based lock. Implemented as ATOMIC `SET NX EX` — the gate
//     state and the "I am claiming this round" write are one Redis
//     call, so parallel syncs can't both pass. Closes the race that
//     was causing 2-3× token piles at parks and dog zones.

import { redis } from '../db/redis.js';
import { balance } from '../config/balance.js';
import { distanceMeters, type LatLng } from '../utils/geo.js';

const TTL_S = 24 * 60 * 60;
const USER_AREA_LOCK_TTL_S = 2;

interface UserAreaRecord {
  at: number;
  lat: number;
  lng: number;
}

function userAreaKey(userId: string): string {
  return `topup:user-area:${userId}`;
}
function userAreaLockKey(userId: string): string {
  return `lock:topup:user-area:${userId}`;
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
    // Race lock — if another sync is currently inside this branch we
    // return false so we don't both pass the check and both spawn.
    // 2-second TTL is well above any single syncMap latency and
    // expires on its own if the holder crashes mid-topup.
    const lock = await redis.set(
      userAreaLockKey(userId),
      '1',
      'EX',
      USER_AREA_LOCK_TTL_S,
      'NX',
    );
    if (lock !== 'OK') return false;
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

// Atomic acquire-and-claim for a (userId, kind, anchor) pool topup.
// Returns true if THIS caller wins the topup round (and therefore
// should spawn); false if another sync already claimed it. The SET
// NX EX is one Redis call — no GET-then-SET window for a concurrent
// caller to slip through.
async function acquirePoolTopup(
  userId: string,
  kind: string,
  anchor: LatLng | string,
): Promise<boolean> {
  try {
    if (redis.status !== 'ready') return true;
    const cooldownS = Math.max(1, Math.ceil(balance.poolCooldownMs / 1000));
    const res = await redis.set(
      poolKey(userId, kind, anchor),
      String(Date.now()),
      'EX',
      cooldownS,
      'NX',
    );
    return res === 'OK';
  } catch {
    return true;
  }
}

export const parkPawsGate = {
  acquire: (userId: string, anchor: LatLng) =>
    acquirePoolTopup(userId, 'park-paws', anchor),
};

export const parkBonesGate = {
  acquire: (userId: string, anchor: LatLng) =>
    acquirePoolTopup(userId, 'park-bones', anchor),
};

export const dogZoneGate = {
  acquire: (userId: string, dogId: string) =>
    acquirePoolTopup(userId, 'dog-zone', dogId),
};

// THE WHOLE SPAWN ATTEMPT, GATED ONCE, BEFORE ANY PROBING QUERY.
//
// The per-pool gates above throttle the INSERTS, but the probing around
// them — the two expiry UPDATEs, the nearby-pets scan, the per-pool
// counts, the two cap UPDATEs — still ran on every single sync: about
// eight to fifteen Postgres round trips per user per tick, on a pool of
// ten, for a step that spawns nothing on the vast majority of ticks.
// That is the launch-day wall in 08-open-issues.md (L-2), and the fix
// it names first is this one: decide with one Redis call whether a
// spawn round is even due, and only then pay for the probes.
//
// Semantics: at most one spawn attempt per user per SPAWN_ATTEMPT_GAP_MS
// (default 30s; env-overridable so it can be tuned live). A walker at
// 1.5 m/s covers ~45m in that window — well inside a pet zone or a park
// ring, both hundreds of metres across — so a pool the walker is
// approaching seeds at most one tick later than before. The per-pool
// gates still apply on top; this only says "not yet" more often.
//
// SET NX EX makes the check and the claim one atomic call, so two syncs
// racing from the same phone cannot both pass. Fails OPEN on a Redis
// outage, like every other gate here: a map with too many spawn probes
// beats a map with no paws.
const SPAWN_ATTEMPT_GAP_MS_DEFAULT = 30_000;

export function spawnAttemptGapMs(): number {
  const n = Number(process.env.SPAWN_ATTEMPT_GAP_MS);
  return Number.isFinite(n) && n >= 0 ? n : SPAWN_ATTEMPT_GAP_MS_DEFAULT;
}

export async function shouldAttemptSpawn(userId: string): Promise<boolean> {
  try {
    const gap = spawnAttemptGapMs();
    if (gap <= 0) return true;
    if (redis.status !== 'ready') return true;
    const res = await redis.set(
      `topup:attempt:${userId}`,
      String(Date.now()),
      'PX',
      gap,
      'NX',
    );
    return res === 'OK';
  } catch {
    return true;
  }
}

