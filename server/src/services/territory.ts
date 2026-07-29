// Territory marking — the dog claims ground as you walk, and loses it when
// someone else walks over it.
//
// The whole mechanic hangs off one hook: /collect/path already gives the
// server a movement-verified position every ~15s (it owns the previous
// anchor in Redis and rejects teleports), so that's where we ask "should
// the dog mark here?". No new client trust surface — a tampered client
// can't claim ground it didn't walk to any more than it can farm paws.
//
// MARKS ARE THE ONLY TRUTH
// ------------------------
// A territory is the convex hull of a cluster of live marks. There is no
// separate ownership record. An earlier cut kept per-cell ownership
// alongside the drawn shapes, and the two diverged immediately: you owned
// a trail ribbon along everywhere you'd walked plus a blob around each
// mark, none of which was ever drawn. Harmless while nothing was
// contested, and a guaranteed source of "someone took territory that
// never looked like mine" the moment stealing lands. One truth instead.
//
// DECAY
// -----
// Marks expire (markTtlDays). Nothing is deleted — expiry is a read-time
// filter, so an untouched mark costs nothing until someone looks — and
// the shape simply shrinks to the hull of whatever is still live. Visible
// decay, unlike a per-cell strength nobody could see.
//
// CONTEST
// -------
// Marking is the same gesture for attack and defence, which is the whole
// point: you don't press a "raid" button, you walk somewhere and the dog
// does what dogs do.
//
//   • near YOUR OWN live marks  → they renew (clocks restart) and the new
//     mark lands harder (strength 2, then 3). A corner you walk daily
//     becomes a core.
//   • near a RIVAL's live marks → the nearest couple weaken by one, and
//     at zero they die and their shape shrinks. A raid row is written so
//     the loser hears about it on their next sync.
//
// Soft edges fall to a single visit; a hardened core takes several across
// separate walks. The border war happens at the border.
//
// HOME GROUND
// -----------
// Holding ground pays, and all of it is passive: on your own streets the
// paws are denser and the dog's happiness drains at half rate. Nothing to
// activate and nothing to remember — the reward still lands on a player
// who never learns the mechanic has a name. Plus the standing, which is
// the part that makes people care: total area held, ranked, derived from
// live marks so a player who stops walking slides down on their own.

import { and, desc, eq, gte, lte, ne, sql, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, schema } from '../db/index.js';
import { balance } from '../config/balance.js';
import { distanceMeters, type LatLng } from '../utils/geo.js';
import {
  convexHull,
  clusterPoints,
  polygonAreaM2,
  pointInPolygon,
} from '../utils/territoryShapes.js';
import { redis } from '../db/redis.js';

const T = balance.territory;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// Bots live in Redis presence, but they need real user rows to own marks
// (the FKs are real). They're still not people: we never queue raid
// notifications for them, because nothing would ever read them.
const BOT_PREFIX = 'bot:';
const isBot = (id: string) => id.startsWith(BOT_PREFIX);

// Ceiling on how many neighbours' ground we'll draw at once. A busy
// hotspot could have a dozen overlapping ranges, and past a handful the
// map stops saying anything — it's just grey. Nearest-first, so the ones
// you're actually walking into are the ones you see.
const MAX_RIVALS = 6;

// Marks older than this stop counting toward shapes.
function liveSince(): Date {
  return new Date(Date.now() - T.markTtlDays * DAY_MS);
}

// Degree box around a point, for the (lat, lng) index. Always a superset
// of the true circle — callers still filter by real distance after.
function bbox(pos: LatLng, radiusM: number) {
  const dLat = radiusM / 110_540;
  const dLng = radiusM / (111_320 * Math.max(0.2, Math.cos((pos.lat * Math.PI) / 180)));
  return {
    minLat: pos.lat - dLat,
    maxLat: pos.lat + dLat,
    minLng: pos.lng - dLng,
    maxLng: pos.lng + dLng,
  };
}

export interface MarkResult {
  marked: boolean;
  // Why the dog passed, for the caller's bubble. 'cooldown' / 'too-close'
  // are the boring ones (stay silent); 'hungry' / 'grumpy' are worth
  // voicing occasionally.
  reason?: 'cooldown' | 'too-close' | 'hungry' | 'grumpy' | 'no-state';
  position?: LatLng;
  // Set when this mark is the one that gave its cluster area for the
  // first time — the third of a group. The client makes a moment of it.
  enclosed?: boolean;
  // How hard this mark landed (1-3). 2+ means it renewed ground you
  // already held, which is worth its own line from the dog.
  strength?: number;
  // How many rival marks this one knocked down, and whether any died.
  // The difference between "we're sniffing around their edge" and "that
  // corner is ours now".
  stolen?: number;
  captured?: boolean;
}

export interface TerritoryShape {
  kind: 'area' | 'line';
  points: { lat: number; lng: number }[];
}

// Someone else's ground, drawn only while you're near it.
export interface RivalTerritory {
  ownerId: string;
  ownerName: string;
  shapes: TerritoryShape[];
}

export interface RaidEvent {
  raiderName: string;
  lat: number;
  lng: number;
  killed: boolean;
  at: string;
}

// A user's live marks, oldest first.
async function liveMarks(userId: string) {
  const rows = await db
    .select({
      lat: schema.territoryMarks.lat,
      lng: schema.territoryMarks.lng,
      closedLoop: schema.territoryMarks.closedLoop,
      strength: schema.territoryMarks.strength,
      at: schema.territoryMarks.createdAt,
    })
    .from(schema.territoryMarks)
    .where(
      and(
        eq(schema.territoryMarks.userId, userId),
        gte(schema.territoryMarks.createdAt, liveSince()),
      ),
    )
    .orderBy(desc(schema.territoryMarks.createdAt))
    .limit(T.shapeMarkWindow);
  return rows.reverse();
}

// Live marks near a point, by everyone or by everyone-but-one. The (lat,
// lng) index turns this into a box scan; the true-circle filter happens
// in JS on the handful of rows that come back.
async function marksNear(
  pos: LatLng,
  radiusM: number,
  opts: { exceptUserId?: string; onlyUserId?: string } = {},
) {
  const b = bbox(pos, radiusM);
  const rows = await db
    .select({
      id: schema.territoryMarks.id,
      userId: schema.territoryMarks.userId,
      lat: schema.territoryMarks.lat,
      lng: schema.territoryMarks.lng,
      strength: schema.territoryMarks.strength,
    })
    .from(schema.territoryMarks)
    .where(
      and(
        gte(schema.territoryMarks.createdAt, liveSince()),
        gte(schema.territoryMarks.lat, b.minLat),
        lte(schema.territoryMarks.lat, b.maxLat),
        gte(schema.territoryMarks.lng, b.minLng),
        lte(schema.territoryMarks.lng, b.maxLng),
        ...(opts.exceptUserId ? [ne(schema.territoryMarks.userId, opts.exceptUserId)] : []),
        ...(opts.onlyUserId ? [eq(schema.territoryMarks.userId, opts.onlyUserId)] : []),
      ),
    )
    .limit(T.shapeMarkWindow * 4);
  return rows
    .map((r) => ({ ...r, d: distanceMeters(pos, { lat: r.lat, lng: r.lng }) }))
    .filter((r) => r.d <= radiusM)
    .sort((a, b2) => a.d - b2.d);
}

// Drop a mark at pos on behalf of userId, resolving both halves of the
// contest. Assumes the caller has already decided the dog *should* mark
// (mood, cooldown and spacing gates live with their owner — the player
// path checks companion state, the bot path checks its own timer).
async function placeMark(
  userId: string,
  raiderName: string,
  pos: LatLng,
  opts: { contest?: boolean } = {},
): Promise<{ enclosed: boolean; strength: number; stolen: number; captured: boolean }> {
  // Everything within the wider of the two radii, in one query.
  const scanM = Math.max(T.refreshM, T.contestM);
  const near = await marksNear(pos, scanM);
  const own = near.filter((m) => m.userId === userId && m.d <= T.refreshM);
  const rivals =
    opts.contest === false
      ? []
      : near.filter((m) => m.userId !== userId && m.d <= T.contestM);

  // Landing on ground you already hold makes the new mark harder to
  // shift — one step above the best mark already there.
  const strength = Math.min(
    T.maxMarkStrength,
    own.reduce((best, m) => Math.max(best, m.strength + 1), 1),
  );

  // Does this mark give its cluster area for the first time? Only used
  // for the bubble and a slightly larger dot — the shape itself is always
  // derived fresh from the marks, never stored.
  const prior = await liveMarks(userId);
  const cluster =
    clusterPoints([...prior.map((m) => ({ lat: m.lat, lng: m.lng })), pos], T.shapeLinkM).find(
      (c) => c.some((p) => p.lat === pos.lat && p.lng === pos.lng),
    ) ?? [];
  const enclosed = cluster.length === T.shapeMinMarks;

  const hits = rivals.slice(0, T.contestMaxHits);
  const killedIds = hits.filter((m) => m.strength <= 1).map((m) => m.id);
  const weakenedIds = hits.filter((m) => m.strength > 1).map((m) => m.id);
  // One raid per victim, not per mark — losing two marks to one rival
  // walking past is a single event to the person it happens to.
  const victims = new Map<string, boolean>();
  for (const m of hits) {
    victims.set(m.userId, (victims.get(m.userId) ?? false) || m.strength <= 1);
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(schema.territoryMarks).values({
      id: nanoid(),
      userId,
      lat: pos.lat,
      lng: pos.lng,
      closedLoop: enclosed,
      strength,
      createdAt: now,
    });
    // Renew what's already yours nearby — the reason to walk the same
    // streets again rather than only ever pushing outward.
    if (own.length) {
      await tx
        .update(schema.territoryMarks)
        .set({ createdAt: now })
        .where(inArray(schema.territoryMarks.id, own.map((m) => m.id)));
    }
    if (weakenedIds.length) {
      await tx
        .update(schema.territoryMarks)
        .set({ strength: sql`${schema.territoryMarks.strength} - 1` })
        .where(inArray(schema.territoryMarks.id, weakenedIds));
    }
    if (killedIds.length) {
      await tx
        .delete(schema.territoryMarks)
        .where(inArray(schema.territoryMarks.id, killedIds));
    }
    for (const [victimId, killed] of victims) {
      // Bots don't read their mail.
      if (isBot(victimId)) continue;
      await tx.insert(schema.territoryRaids).values({
        id: nanoid(),
        victimId,
        raiderId: userId,
        raiderName,
        lat: pos.lat,
        lng: pos.lng,
        killed,
        createdAt: now,
      });
    }
    // Marking costs a little effort and pays back a little joy — the wire
    // between territory and the bones/paws economy — and stamps the
    // cooldown/spacing anchor the next call gates on. In the same
    // transaction as the mark, so a failure here can't leave ground
    // claimed with no cooldown recorded and the dog marking every tick.
    // A no-op for bots, which have no companion row.
    await tx
      .update(schema.companionState)
      .set({
        hunger: sql`GREATEST(${balance.hunger.min}, ${schema.companionState.hunger} - ${T.hungerCost})`,
        happiness: sql`LEAST(${balance.happiness.max}, ${schema.companionState.happiness} + ${T.happinessGain})`,
        lastMarkAt: now,
        lastMarkLat: pos.lat,
        lastMarkLng: pos.lng,
      })
      .where(eq(schema.companionState.userId, userId));
  });

  return {
    enclosed,
    strength,
    stolen: hits.length,
    captured: killedIds.length > 0,
  };
}

// Should the dog mark here, and if so, record it.
//
// Called from /collect/path with a position the server has already
// validated as reachable — and with the COMPANION's position, since it's
// the dog that marks, not the walker.
export async function markIfDue(
  userId: string,
  pos: LatLng,
  raiderName: string,
): Promise<MarkResult> {
  const [state] = await db
    .select({
      hunger: schema.companionState.hunger,
      happiness: schema.companionState.happiness,
      lastMarkAt: schema.companionState.lastMarkAt,
      lastMarkLat: schema.companionState.lastMarkLat,
      lastMarkLng: schema.companionState.lastMarkLng,
    })
    .from(schema.companionState)
    .where(eq(schema.companionState.userId, userId))
    .limit(1);

  if (!state) return { marked: false, reason: 'no-state' };

  const now = Date.now();

  // Cooldown + spacing first — they're the common case and cost nothing
  // to check, so a dog mid-cooldown never even reads as "grumpy".
  if (state.lastMarkAt && now - state.lastMarkAt.getTime() < T.cooldownMs) {
    return { marked: false, reason: 'cooldown' };
  }
  if (
    state.lastMarkLat != null &&
    state.lastMarkLng != null &&
    distanceMeters({ lat: state.lastMarkLat, lng: state.lastMarkLng }, pos) <
      T.minDistanceM
  ) {
    return { marked: false, reason: 'too-close' };
  }
  if (state.happiness < T.minHappiness) return { marked: false, reason: 'grumpy' };
  if (state.hunger < T.minHunger) return { marked: false, reason: 'hungry' };

  const outcome = await placeMark(userId, raiderName, pos);

  return {
    marked: true,
    position: pos,
    strength: outcome.strength,
    ...(outcome.enclosed ? { enclosed: true } : {}),
    ...(outcome.stolen ? { stolen: outcome.stolen, captured: outcome.captured } : {}),
  };
}

// Bots mark too, so a new city isn't empty ground. Same placement and
// contest rules; the mood gates don't apply (a bot has no companion
// state) and the pacing is the caller's timer rather than the dog's.
//
// The spacing rule is applied here rather than by the caller, because a
// bot dwelling in the same park for days would otherwise stack hundreds
// of marks on one bench. Too close to something it already holds → the
// visit RENEWS that mark instead of adding another. Same rule a player
// gets from minDistanceM, and it's what makes a bot's home patch harden
// over time into ground worth taking.
export async function markAsBot(botId: string, botName: string, pos: LatLng): Promise<void> {
  const own = await marksNear(pos, T.minDistanceM, { onlyUserId: botId });
  if (own.length) {
    await db
      .update(schema.territoryMarks)
      .set({
        createdAt: new Date(),
        strength: sql`LEAST(${T.maxMarkStrength}, ${schema.territoryMarks.strength} + 1)`,
      })
      .where(inArray(schema.territoryMarks.id, own.map((m) => m.id)));
    return;
  }
  await placeMark(botId, botName, pos);
}

// Give a bot a starting patch so there's something to raid on day one.
// No-op once it holds anything, so a restart doesn't keep piling on.
//
// Seeding never contests: the whole pool is laid down in one loop at
// boot, and letting bot N's seed eat bot N-1's would just mean whoever
// happened to go last ends up holding everything.
export async function seedBotTerritory(
  botId: string,
  botName: string,
  around: LatLng,
): Promise<void> {
  const existing = await db
    .select({ id: schema.territoryMarks.id })
    .from(schema.territoryMarks)
    .where(
      and(
        eq(schema.territoryMarks.userId, botId),
        gte(schema.territoryMarks.createdAt, liveSince()),
      ),
    )
    .limit(1);
  if (existing.length) return;

  for (let i = 0; i < T.botSeedMarks; i++) {
    const ang = (i / T.botSeedMarks) * Math.PI * 2 + Math.random() * 0.6;
    const r = T.botSeedSpreadM * (0.55 + Math.random() * 0.45);
    await placeMark(
      botId,
      botName,
      {
        lat: around.lat + (r * Math.cos(ang)) / 110_540,
        lng:
          around.lng +
          (r * Math.sin(ang)) / (111_320 * Math.cos((around.lat * Math.PI) / 180)),
      },
      { contest: false },
    );
  }
}

// Build shapes out of a bag of marks. Three or more near each other
// enclose an area; exactly two are a bare link with no ground; one is
// just a dot.
function shapesFrom(points: LatLng[]): TerritoryShape[] {
  const out: TerritoryShape[] = [];
  for (const cluster of clusterPoints(points, T.shapeLinkM)) {
    if (cluster.length >= T.shapeMinMarks) {
      const hull = convexHull(cluster);
      // Marks in a near-straight line hull to a sliver with no real area —
      // draw those as a line rather than a degenerate polygon.
      out.push({ kind: hull.length >= 3 ? 'area' : 'line', points: hull });
    } else if (cluster.length === 2) {
      out.push({ kind: 'line', points: cluster });
    }
  }
  return out;
}

// The shapes a user's own live marks make. Always drawn, wherever they are.
export async function fetchShapes(userId: string): Promise<TerritoryShape[]> {
  const marks = await liveMarks(userId);
  if (marks.length === 0) return [];
  return shapesFrom(marks.map((m) => ({ lat: m.lat, lng: m.lng })));
}

// How much ground a set of shapes actually holds. Islands are summed;
// a line contributes nothing, which is the same thing it looks like.
//
// Overlapping hulls would be double-counted, but clusterPoints only ever
// emits disjoint groups of marks, so two hulls can only touch where their
// clusters interleave — and single-linkage at shapeLinkM means they'd
// have been one cluster if they did.
function totalAreaM2(shapes: TerritoryShape[]): number {
  return shapes.reduce((s, sh) => s + (sh.kind === 'area' ? polygonAreaM2(sh.points) : 0), 0);
}

// Everything the map needs about YOUR territory, off one read of your
// marks. The sync path used to call fetchMarks and fetchShapes side by
// side and pay for the same query twice; area and home ground would have
// made it four.
export interface OwnTerritory {
  marks: { lat: number; lng: number; closedLoop: boolean; strength: number; at: string }[];
  shapes: TerritoryShape[];
  areaM2: number;
  // Is the walker standing on ground they hold? The passive perks —
  // denser paws, slower happiness drain — hang off this.
  home: boolean;
}

export async function fetchTerritory(userId: string, pos: LatLng): Promise<OwnTerritory> {
  const rows = await liveMarks(userId);
  const shapes = shapesFrom(rows.map((m) => ({ lat: m.lat, lng: m.lng })));
  return {
    marks: rows.map((r) => ({
      lat: r.lat,
      lng: r.lng,
      closedLoop: r.closedLoop,
      strength: r.strength,
      at: r.at.toISOString(),
    })),
    shapes,
    areaM2: Math.round(totalAreaM2(shapes)),
    home: isHome(pos, shapes),
  };
}

// Standing on your own ground — inside one of your shapes, or within a
// short grace band of its edge. The band exists so the perk doesn't
// strobe on and off while the dog wanders along a border, which is
// exactly where a walker naturally spends their time.
function isHome(pos: LatLng, shapes: TerritoryShape[]): boolean {
  for (const s of shapes) {
    if (s.kind !== 'area') continue;
    if (pointInPolygon(pos, s.points)) return true;
    // Cheap outside-but-close test: any vertex within the grace band.
    // A long edge whose midpoint you're standing near won't match, and
    // that's fine — this is a courtesy margin, not a second geometry.
    if (s.points.some((p) => distanceMeters(pos, p) <= T.homeEdgeM)) return true;
  }
  return false;
}

// Remember whether the dog is at home, for the decay cron — which is one
// bulk UPDATE over every companion and can branch on a column but can't
// compute a hull. Only writes on a CHANGE, so a walk inside your own
// range isn't an UPDATE every 15 seconds.
export async function noteHomeGround(userId: string, home: boolean): Promise<void> {
  await db
    .update(schema.companionState)
    .set({ onHomeGround: home })
    .where(
      and(
        eq(schema.companionState.userId, userId),
        ne(schema.companionState.onHomeGround, home),
      ),
    );
}

export interface LeaderboardEntry {
  userId: string;
  name: string;
  areaM2: number;
  bot: boolean;
}

// Who holds the most of the city. Recomputing every hull is real work, so
// this is CACHED — a standing, not a live scoreboard, and a few minutes
// of lag is invisible at the scale it's read.
//
// Everything is derived from live marks, so a player who stops walking
// slides down the board on their own as their marks expire. Nothing to
// reset, no season to run.
export async function territoryLeaderboard(): Promise<LeaderboardEntry[]> {
  const cached = await readCachedBoard();
  if (cached) return cached;

  const rows = await db
    .select({
      userId: schema.territoryMarks.userId,
      lat: schema.territoryMarks.lat,
      lng: schema.territoryMarks.lng,
    })
    .from(schema.territoryMarks)
    .where(gte(schema.territoryMarks.createdAt, liveSince()));

  const byUser = new Map<string, LatLng[]>();
  for (const r of rows) {
    const list = byUser.get(r.userId);
    if (list) list.push({ lat: r.lat, lng: r.lng });
    else byUser.set(r.userId, [{ lat: r.lat, lng: r.lng }]);
  }

  const scored = [...byUser]
    .map(([userId, pts]) => ({ userId, areaM2: Math.round(totalAreaM2(shapesFrom(pts))) }))
    .filter((e) => e.areaM2 > 0)
    .sort((a, b) => b.areaM2 - a.areaM2)
    .slice(0, T.leaderboardSize);

  const names = await ownerNames(scored.map((e) => e.userId));
  const board = scored.map((e) => ({
    ...e,
    name: names.get(e.userId) ?? 'сусід',
    bot: isBot(e.userId),
  }));
  await writeCachedBoard(board);
  return board;
}

// Where a given user stands, and how much they hold. Computed off their
// own marks rather than read out of the cached board, so someone outside
// the top ten still gets a real number for their own ground.
export async function territoryStanding(
  userId: string,
  board: LeaderboardEntry[],
): Promise<{ areaM2: number; rank: number | null }> {
  const own = await fetchShapes(userId);
  const areaM2 = Math.round(totalAreaM2(own));
  const idx = board.findIndex((e) => e.userId === userId);
  return { areaM2, rank: idx >= 0 ? idx + 1 : null };
}

const BOARD_KEY = 'terr:leaderboard';

async function readCachedBoard(): Promise<LeaderboardEntry[] | null> {
  try {
    if (redis.status !== 'ready') return null;
    const raw = await redis.get(BOARD_KEY);
    return raw ? (JSON.parse(raw) as LeaderboardEntry[]) : null;
  } catch {
    // A cache miss and a broken cache are the same thing here: recompute.
    return null;
  }
}

async function writeCachedBoard(board: LeaderboardEntry[]): Promise<void> {
  try {
    if (redis.status !== 'ready') return;
    await redis.set(
      BOARD_KEY,
      JSON.stringify(board),
      'PX',
      T.leaderboardCacheMs,
    );
  } catch {
    // Losing the write just means the next reader recomputes.
  }
}

// Everyone else's ground within sight of you. Deliberately proximity-
// gated: the map stays yours, and walking into a rival range is an event
// rather than a permanent layer of other people's paint.
export async function fetchRivalTerritory(
  userId: string,
  pos: LatLng,
): Promise<RivalTerritory[]> {
  const near = await marksNear(pos, T.rivalViewRadiusM, { exceptUserId: userId });
  if (near.length === 0) return [];

  const owners = [...new Set(near.map((m) => m.userId))].slice(0, MAX_RIVALS);
  // Their marks near you are only part of their range — pull each
  // owner's full live set so the hull we draw is the real shape's edge,
  // not a rectangle cut at your view radius. One query for all of them:
  // this runs on the 15s sync path, so a round-trip per neighbour is a
  // cost that grows exactly where the city gets busy.
  const [allMarks, names] = await Promise.all([
    db
      .select({
        userId: schema.territoryMarks.userId,
        lat: schema.territoryMarks.lat,
        lng: schema.territoryMarks.lng,
      })
      .from(schema.territoryMarks)
      .where(
        and(
          inArray(schema.territoryMarks.userId, owners),
          gte(schema.territoryMarks.createdAt, liveSince()),
        ),
      )
      .limit(T.shapeMarkWindow * owners.length),
    ownerNames(owners),
  ]);
  const byOwner = new Map<string, LatLng[]>(owners.map((id) => [id, []]));
  for (const m of allMarks) byOwner.get(m.userId)?.push({ lat: m.lat, lng: m.lng });

  const out: RivalTerritory[] = [];
  for (const [id, marks] of byOwner) {
    const shapes = shapesFrom(marks);
    // Keep only the islands that actually reach you — someone whose home
    // range happens to touch your view radius shouldn't paint their
    // patch on the other side of town onto your map.
    const visible = shapes.filter((s) =>
      s.points.some((p) => distanceMeters(pos, p) <= T.rivalViewRadiusM * 1.5),
    );
    if (visible.length) {
      out.push({ ownerId: id, ownerName: names.get(id) ?? 'сусід', shapes: visible });
    }
  }
  return out;
}

// Display names for territory owners. Bots carry their dog name as
// username, so this reads the same for both.
async function ownerNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: schema.users.id, username: schema.users.username, first: schema.users.telegramFirstName })
    .from(schema.users)
    .where(inArray(schema.users.id, ids));
  return new Map(rows.map((r) => [r.id, r.first || r.username || 'сусід']));
}

// Raids waiting for this user, delivered once. Marked seen as they go out
// rather than on an ack: a dropped notification is a smaller cost than a
// stuck one that replays every 15 seconds.
export async function takeRaids(userId: string): Promise<RaidEvent[]> {
  const since = new Date(Date.now() - T.raidTtlHours * HOUR_MS);
  const rows = await db
    .select({
      id: schema.territoryRaids.id,
      raiderName: schema.territoryRaids.raiderName,
      lat: schema.territoryRaids.lat,
      lng: schema.territoryRaids.lng,
      killed: schema.territoryRaids.killed,
      at: schema.territoryRaids.createdAt,
    })
    .from(schema.territoryRaids)
    .where(
      and(
        eq(schema.territoryRaids.victimId, userId),
        sql`${schema.territoryRaids.seenAt} IS NULL`,
        gte(schema.territoryRaids.createdAt, since),
      ),
    )
    .orderBy(desc(schema.territoryRaids.createdAt))
    .limit(20);
  if (rows.length === 0) return [];

  await db
    .update(schema.territoryRaids)
    .set({ seenAt: new Date() })
    .where(inArray(schema.territoryRaids.id, rows.map((r) => r.id)));

  return rows.map((r) => ({
    raiderName: r.raiderName,
    lat: r.lat,
    lng: r.lng,
    killed: r.killed,
    at: r.at.toISOString(),
  }));
}

// Dev affordance: have a bot walk onto the caller's newest mark and do
// what it would have done anyway. Runs the real contest path — same
// weakening, same raid row, same notification — so it exercises the
// mechanic rather than faking its output, and it can only ever damage the
// caller's own ground. Paired with `?terrRaid=1` on the client.
export async function simulateRaidOnSelf(userId: string): Promise<boolean> {
  const [mine] = await db
    .select({ lat: schema.territoryMarks.lat, lng: schema.territoryMarks.lng })
    .from(schema.territoryMarks)
    .where(
      and(
        eq(schema.territoryMarks.userId, userId),
        gte(schema.territoryMarks.createdAt, liveSince()),
      ),
    )
    .orderBy(desc(schema.territoryMarks.createdAt))
    .limit(1);
  if (!mine) return false;

  const [bot] = await db
    .select({ id: schema.users.id, username: schema.users.username })
    .from(schema.users)
    .where(sql`${schema.users.id} LIKE ${BOT_PREFIX + '%'}`)
    .limit(1);
  if (!bot) return false;

  await placeMark(bot.id, bot.username, { lat: mine.lat, lng: mine.lng });
  return true;
}

// Wipe a user's territory. Only ever touches the caller's own marks, so
// it needs no special guard — and it makes the mechanic re-testable from
// a clean slate without going near the database.
export async function resetTerritory(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(schema.territoryMarks).where(eq(schema.territoryMarks.userId, userId));
    await tx
      .update(schema.companionState)
      .set({ lastMarkAt: null, lastMarkLat: null, lastMarkLng: null })
      .where(eq(schema.companionState.userId, userId));
  });
}
