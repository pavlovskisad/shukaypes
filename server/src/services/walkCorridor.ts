// THE LAST STRETCH OF STREET THE WALKER COVERED.
//
// /collect/path knows it — it is the segment it just swept for paws and
// bones. /quests/advance needs it, because a waypoint walked past with
// the phone locked is otherwise simply missed: that handler tests one
// point (where you are now) against the waypoint's reach radius, so a
// person who strolled straight through a stop and pulled their phone
// out a street later has advanced nothing, with no way to notice.
//
// Why a record of its own rather than reading the path anchor. The
// anchor moves the instant /collect/path runs, and the two calls are
// not ordered — the client fires the sync and the quest advance
// independently, so whichever lands second would find the anchor
// already collapsed onto the current position and the corridor gone.
// This is written once per swept segment and read without consuming,
// which makes the race harmless.
//
// Short TTL on purpose. A corridor is evidence about the last few
// minutes of walking; an hour-old one would let somebody advance a
// waypoint from a street they left long ago.

import { redis } from '../db/redis.js';
import { balance } from '../config/balance.js';
import type { LatLng } from '../utils/geo.js';

export interface WalkCorridor {
  from: LatLng;
  to: LatLng;
  /** When the segment ENDED — i.e. the fix that closed it. Epoch ms. */
  at: number;
}

function key(userId: string): string {
  return `path:corridor:${userId}`;
}

export async function writeCorridor(userId: string, from: LatLng, to: LatLng): Promise<void> {
  try {
    if (redis.status !== 'ready') return;
    const value: WalkCorridor = { from, to, at: Date.now() };
    await redis.set(key(userId), JSON.stringify(value), 'EX', balance.walk.corridorTtlS);
  } catch {
    // Best-effort, exactly like the anchor it rides along with: a Redis
    // hiccup costs a retroactive waypoint, never the sync.
  }
}

export async function readCorridor(userId: string): Promise<WalkCorridor | null> {
  try {
    if (redis.status !== 'ready') return null;
    const raw = await redis.get(key(userId));
    if (!raw) return null;
    return JSON.parse(raw) as WalkCorridor;
  } catch {
    return null;
  }
}
