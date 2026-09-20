// WHERE THE SERVER LAST SAW THIS WALKER.
//
// One Redis key per walker, written by /collect/path on every accepted
// sync and read by the sweep that follows — it is the anchor every
// segment is measured from, and the reason a walk can be judged at all
// (services/catchUp.ts).
//
// It lived inside routes/path.ts until the day's planned walk needed it
// too (D-99): planning a route is refused from close up, and "close"
// means close to where the SERVER last saw you, not to a position the
// phone offers alongside the request. Two readers, so the key's shape
// gets one owner rather than two copies to drift apart.
//
// Best-effort throughout: a Redis hiccup must never 500 a foreground
// sync, so every path here swallows and returns null.

import { redis } from '../db/redis.js';
import type { LatLng } from '../utils/geo.js';

const TTL_S = 24 * 60 * 60;

export interface WalkAnchor {
  lat: number;
  lng: number;
  ts: number;
}

function key(userId: string): string {
  return `path:last:${userId}`;
}

export async function readLastPos(userId: string): Promise<WalkAnchor | null> {
  try {
    if (redis.status !== 'ready') return null;
    const raw = await redis.get(key(userId));
    if (!raw) return null;
    return JSON.parse(raw) as WalkAnchor;
  } catch {
    return null;
  }
}

export async function writeLastPos(userId: string, pos: LatLng): Promise<void> {
  try {
    if (redis.status !== 'ready') return;
    const value: WalkAnchor = { lat: pos.lat, lng: pos.lng, ts: Date.now() };
    await redis.set(key(userId), JSON.stringify(value), 'EX', TTL_S);
  } catch {
    // Path collection is best-effort; a Redis hiccup shouldn't 500
    // the foreground sync.
  }
}

/** Just the point, for callers that do not care when it was seen. */
export async function lastPosOf(userId: string): Promise<LatLng | null> {
  const a = await readLastPos(userId);
  return a ? { lat: a.lat, lng: a.lng } : null;
}
