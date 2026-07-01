// Multiplayer presence via Redis GEO.
//
// Every authed /sync/map poll (from a multiplayer-enabled client) writes the
// caller's live position into a Redis GEO set with a short TTL, then reads the
// nearby online players back. Bots (services/bots.ts) write into the SAME set,
// so to a real client they're indistinguishable from other players — that's
// what lets us populate + tune the UX before real density exists.
//
// Positions are lightly JITTERED (a stable per-id offset) before storing, so
// we never expose a user's exact live location — just "someone's around here".
//
// Keys:
//   mp:pos   GEO set (a ZSET under the hood) member=id -> position
//   mp:seen  ZSET member=id -> lastSeen ms (drives TTL + purge)
//   mp:meta  HASH member=id -> JSON {n:name, p:photoUrl, b:isBot}

import { redis } from '../db/redis.js';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import type { LatLng } from '../utils/geo.js';

// Local shape (matches @shukajpes/shared NearbyPlayer). Defined here rather
// than imported so the server never resolves the shared TS package at runtime.
export interface NearbyPlayer {
  id: string;
  position: LatLng;
  name: string;
  photoUrl: string | null;
  bot?: boolean;
}

const POS_KEY = 'mp:pos';
const SEEN_KEY = 'mp:seen';
const META_KEY = 'mp:meta';

// A client refreshes every ~15s poll; 45s TTL keeps them alive across a
// missed tick and drops them within ~3 ticks once they stop.
export const PRESENCE_TTL_MS = 45_000;
const RADIUS_M = 2200;
const MAX_NEARBY = 60;
const JITTER_M = 25;

// Stable per-id positional offset (privacy). Deterministic so a player's dog
// doesn't jitter around each poll — it's their real movement + a fixed ~25m
// offset, obscuring the exact point without the marker jumping.
function jitter(id: string, pos: LatLng): LatLng {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const ang = ((h >>> 0) % 3600) / 10 * (Math.PI / 180);
  const r = (((h >>> 9) % 1000) / 1000) * JITTER_M;
  const dLat = (r * Math.cos(ang)) / 110540;
  const dLng =
    (r * Math.sin(ang)) / (111320 * Math.cos((pos.lat * Math.PI) / 180));
  return { lat: pos.lat + dLat, lng: pos.lng + dLng };
}

// In-memory name/photo cache so we don't hit Postgres on every poll — a
// user's display identity barely changes. 1h TTL per user.
const metaCache = new Map<string, { name: string; photo: string | null; exp: number }>();
async function selfMeta(userId: string): Promise<{ name: string; photo: string | null }> {
  const cached = metaCache.get(userId);
  if (cached && cached.exp > Date.now()) return cached;
  let name = 'walker';
  let photo: string | null = null;
  try {
    const [u] = await db
      .select({
        u: schema.users.username,
        f: schema.users.telegramFirstName,
        p: schema.users.telegramPhotoUrl,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (u) {
      name = u.f || u.u || 'walker';
      photo = u.p || null;
    }
  } catch {
    /* fall back to defaults */
  }
  const rec = { name, photo, exp: Date.now() + 3_600_000 };
  metaCache.set(userId, rec);
  return rec;
}

// Write one presence entry (a real user or a bot). shownPos is the position to
// store (already jittered for real users; bots pass their sim position).
export async function writePresence(
  id: string,
  shownPos: LatLng,
  name: string,
  photo: string | null,
  now: number,
  bot = false,
): Promise<void> {
  const meta = JSON.stringify({ n: name, p: photo, b: bot ? 1 : 0 });
  const pipe = redis.pipeline();
  pipe.geoadd(POS_KEY, shownPos.lng, shownPos.lat, id);
  pipe.zadd(SEEN_KEY, now, id);
  pipe.hset(META_KEY, id, meta);
  await pipe.exec();
}

// Write self-presence and return nearby online players (excluding self).
export async function syncPresence(userId: string, pos: LatLng): Promise<NearbyPlayer[]> {
  const now = Date.now();
  const meta = await selfMeta(userId);
  await writePresence(userId, jitter(userId, pos), meta.name, meta.photo, now, false);

  let raw: unknown;
  try {
    raw = await redis.geosearch(
      POS_KEY,
      'FROMLONLAT',
      pos.lng,
      pos.lat,
      'BYRADIUS',
      RADIUS_M,
      'm',
      'ASC',
      'COUNT',
      MAX_NEARBY + 20,
      'WITHCOORD',
    );
  } catch {
    return [];
  }
  // WITHCOORD → array of [member, [lng, lat]]
  const rows = (raw as [string, [string, string]][]).filter(
    (r) => Array.isArray(r) && r[0] !== userId,
  );
  if (!rows.length) return [];

  const ids = rows.map((r) => r[0]);
  const [scores, metas] = await Promise.all([
    (redis.zmscore(SEEN_KEY, ...ids) as Promise<(string | null)[]>).catch(() =>
      ids.map(() => null),
    ),
    redis.hmget(META_KEY, ...ids).catch(() => ids.map(() => null)),
  ]);

  const out: NearbyPlayer[] = [];
  for (let i = 0; i < rows.length && out.length < MAX_NEARBY; i++) {
    const row = rows[i];
    if (!row) continue;
    const score = scores[i] ? Number(scores[i]) : 0;
    if (now - score > PRESENCE_TTL_MS) continue; // stale (not yet purged)
    const coord = row[1];
    let name = 'walker';
    let photo: string | null = null;
    let bot = false;
    const m = metas[i];
    if (m) {
      try {
        const j = JSON.parse(m);
        name = j.n ?? name;
        photo = j.p ?? null;
        bot = !!j.b;
      } catch {
        /* keep defaults */
      }
    }
    out.push({
      id: row[0],
      position: { lat: Number(coord[1]), lng: Number(coord[0]) },
      name,
      photoUrl: photo,
      bot,
    });
  }
  return out;
}

// Drop entries that haven't pinged within the TTL. GEO sets are ZSETs, so
// ZREM removes a geo member. Runs on a cron (services/bots.ts).
export async function purgeStalePresence(now = Date.now()): Promise<void> {
  const cutoff = now - PRESENCE_TTL_MS;
  const stale = await redis.zrangebyscore(SEEN_KEY, 0, cutoff);
  if (!stale.length) return;
  const pipe = redis.pipeline();
  pipe.zrem(POS_KEY, ...stale);
  pipe.zrem(SEEN_KEY, ...stale);
  pipe.hdel(META_KEY, ...stale);
  await pipe.exec();
}
