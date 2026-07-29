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
// Default import, NOT `import * as`: the package's .d.ts advertises named
// exports but the build is CJS with everything hanging off `default`, so a
// namespace import typechecks fine and then hands back `undefined` at
// runtime. That cost an afternoon once — the difference() call threw, the
// catch below swallowed it, and every territory silently came back
// unclipped and overlapping, which looks exactly like "the partition
// isn't implemented yet".
import polygonClipping from 'polygon-clipping';
import {
  convexHull,
  clusterPoints,
  polygonAreaM2,
  pointInPolygon,
  localProjection,
  voronoiCellWithin,
  clipToConvex,
  type Pt,
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
  // 'area' — the outer boundary. 'line' — the two marks it joins.
  points: { lat: number; lng: number }[];
  // Pockets inside this shape that somebody else holds, because their mark
  // is nearer to that ground than any of ours. Only on 'area'.
  holes?: { lat: number; lng: number }[][];
}

// Someone else's ground. `ownerId` is what the client turns into a colour,
// so each neighbour's range reads as theirs.
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
  opts: { exceptUserId?: string; onlyUserId?: string; limit?: number } = {},
) {
  const b = bbox(pos, radiusM);
  const rows = await db
    .select({
      id: schema.territoryMarks.id,
      userId: schema.territoryMarks.userId,
      lat: schema.territoryMarks.lat,
      lng: schema.territoryMarks.lng,
      strength: schema.territoryMarks.strength,
      closedLoop: schema.territoryMarks.closedLoop,
      at: schema.territoryMarks.createdAt,
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
    .limit(opts.limit ?? T.shapeMarkWindow * 4);
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

// SHAPES, PARTITIONED
// -------------------
// A cluster of three or more marks encloses a hull; two are a bare link
// with no ground; one is just a dot.
//
// But a hull built from one owner's marks alone over-claims. Walk a 700m
// loop and it hands you everything inside — including the park where
// somebody else's dog actually lives. So every hull is then cut back to
// the ground its owner is NEAREST to: rival marks inside (or near) the
// hull carve out their own Voronoi cells, and what's left is what you
// hold. Uncontested, the loop still fills completely. Contested, the
// rival's patch becomes a pocket drawn in their colour.
//
// The partition is computed from ONE bag of marks covering every owner,
// so it's consistent by construction — the same bisector that gives you
// a hole gives your neighbour their pocket, and no ground is ever
// claimed twice.

interface OwnedMark {
  userId: string;
  lat: number;
  lng: number;
}

// Prepare a ring for the clipper: snap to a grid, drop points the snap
// made duplicates of, and close it.
//
// The snapping is not cosmetic. Adjacent Voronoi cells are cut from the
// same hull by different half-planes, so an edge two of them share comes
// out at slightly different coordinates in each — and polygon-clipping
// reacts to that kind of near-degenerate input by throwing "Unable to
// find segment ... in SweepLine tree" from deep inside its sweep. Landing
// both copies on the same grid point makes the shared edge actually
// shared. A centimetre is far below anything visible on a map.
function prepareRing(ring: Pt[], gridM = 0.01): Pt[] | null {
  const snapped: Pt[] = [];
  for (const p of ring) {
    const q: Pt = [Math.round(p[0] / gridM) * gridM, Math.round(p[1] / gridM) * gridM];
    const prev = snapped[snapped.length - 1];
    if (prev && prev[0] === q[0] && prev[1] === q[1]) continue;
    snapped.push(q);
  }
  while (
    snapped.length > 1 &&
    snapped[0]![0] === snapped[snapped.length - 1]![0] &&
    snapped[0]![1] === snapped[snapped.length - 1]![1]
  ) {
    snapped.pop();
  }
  if (snapped.length < 3) return null;
  return [...snapped, snapped[0]!];
}

// Shoelace area of a projected ring, in m². Used to throw away bites too
// small to see, which are also the ones most likely to be slivers the
// clipper chokes on.
function ringAreaM2(ring: Pt[]): number {
  let acc = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    acc += ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1];
  }
  return Math.abs(acc) / 2;
}

// A bite smaller than this is dropped: invisible on the map, and slivers
// are exactly what makes the clipper fall over.
const MIN_BITE_M2 = 20;

// Turn every owner's marks into the shapes they actually hold.
//
// Two passes. The first builds every owner's raw hulls; the second cuts
// each hull back where a neighbour's hull overlaps it and their mark is
// the nearer one. Two passes rather than one because a bite out of your
// range has to be exactly the ground your neighbour gains — subtracting a
// rival's full Voronoi cell (the one-pass version) took 100,000m² off a
// walked loop and handed the neighbour only the 7,500m² their own hull
// covered, leaving the rest owned by nobody.
function partitionShapes(marks: OwnedMark[]): Map<string, TerritoryShape[]> {
  const out = new Map<string, TerritoryShape[]>();
  if (marks.length === 0) return out;

  const proj = localProjection(marks[0]!);
  const byOwner = new Map<string, LatLng[]>();
  for (const m of marks) {
    const list = byOwner.get(m.userId);
    if (list) list.push({ lat: m.lat, lng: m.lng });
    else byOwner.set(m.userId, [{ lat: m.lat, lng: m.lng }]);
  }

  // Pass 1 — raw shapes, before anyone's claim is cut back.
  interface Patch {
    ownerId: string;
    hull: LatLng[];
    hullXY: Pt[];
    marksXY: Pt[];
    centre: LatLng;
    reachM: number;
  }
  const patches: Patch[] = [];
  const lines = new Map<string, TerritoryShape[]>();

  const addLine = (ownerId: string, points: LatLng[]) => {
    const list = lines.get(ownerId);
    if (list) list.push({ kind: 'line', points });
    else lines.set(ownerId, [{ kind: 'line', points }]);
  };

  for (const [ownerId, own] of byOwner) {
    for (const cluster of clusterPoints(own, T.shapeLinkM)) {
      if (cluster.length === 2) {
        addLine(ownerId, cluster);
        continue;
      }
      if (cluster.length < T.shapeMinMarks) continue;
      const hull = convexHull(cluster);
      // Marks in a near-straight line hull to a sliver with no real area —
      // draw those as a link rather than a degenerate polygon.
      if (hull.length < 3) {
        addLine(ownerId, hull);
        continue;
      }
      const centre = hull.reduce(
        (a, p) => ({ lat: a.lat + p.lat / hull.length, lng: a.lng + p.lng / hull.length }),
        { lat: 0, lng: 0 },
      );
      patches.push({
        ownerId,
        hull,
        hullXY: hull.map(proj.to),
        marksXY: cluster.map(proj.to),
        centre,
        reachM: hull.reduce((r, p) => Math.max(r, distanceMeters(centre, p)), 0),
      });
    }
  }

  // Pass 2 — cut each patch back to the ground it is nearest to.
  for (const patch of patches) {
    const bites: Pt[][] = [];

    for (const other of patches) {
      if (other.ownerId === patch.ownerId) continue;
      // Hulls too far apart to touch can't take anything from each other.
      if (distanceMeters(patch.centre, other.centre) > patch.reachM + other.reachM) continue;
      // Only the ground the two actually share is ever in dispute.
      const contested = clipToConvex(patch.hullXY, other.hullXY);
      if (contested.length < 3) continue;
      // Inside that, whichever of THEIR marks beats all of ours takes it.
      // Their cells overlap each other, which is fine — the difference
      // below unions them anyway.
      //
      // Ground exactly equidistant (two owners marked the same spot) goes
      // to whichever id sorts first. The comparison is the same from both
      // sides, so the pair agrees on who gets it — without that they both
      // concede and the ground belongs to nobody.
      const tieWins = other.ownerId < patch.ownerId;
      for (const r of other.marksXY) {
        const cell = voronoiCellWithin(contested, r, patch.marksXY, tieWins);
        if (cell.length >= 3 && ringAreaM2(cell) >= MIN_BITE_M2) bites.push(cell);
      }
    }

    const shapes = out.get(patch.ownerId) ?? [];
    if (bites.length === 0) {
      shapes.push({ kind: 'area', points: patch.hull });
      out.set(patch.ownerId, shapes);
      continue;
    }

    // Cut them all out at once. One hull can come back as several
    // polygons if a neighbour's claim slices clean through it.
    //
    // Retried on a coarser grid before giving up: the clipper's failures
    // are precision failures, and rounding harder is what fixes them.
    // A metre of slop on a territory border is not something anyone can
    // see, let alone care about.
    const cut = (gridM: number): polygonClipping.MultiPolygon | null => {
      const subject = prepareRing(patch.hullXY, gridM);
      if (!subject) return null;
      const clips = bites
        .map((c) => prepareRing(c, gridM))
        .filter((c): c is Pt[] => c !== null)
        .map((c) => [c] as polygonClipping.Polygon);
      if (clips.length === 0) return null;
      return polygonClipping.difference([subject], ...clips);
    };

    let pieces: polygonClipping.MultiPolygon | null = null;
    for (const grid of [0.01, 1]) {
      try {
        pieces = cut(grid);
        break;
      } catch (err) {
        if (grid !== 1) continue;
        // Both passes failed. Falling back to the uncut hull is
        // wrong-but-visible (that ground now reads as claimed twice);
        // dropping the shape would make someone's territory silently
        // vanish, which is worse.
        //
        // LOUD on purpose. A quiet fallback here is indistinguishable
        // from "there was nothing to clip", so a broken clipper would
        // just look like the feature was never built.
        console.warn('[territory] partition failed, falling back to raw hull:', err);
      }
    }
    if (!pieces) {
      shapes.push({ kind: 'area', points: patch.hull });
      out.set(patch.ownerId, shapes);
      continue;
    }

    for (const poly of pieces) {
      const [outer, ...holes] = poly;
      if (!outer || outer.length < 4) continue;
      shapes.push({
        kind: 'area',
        points: outer.slice(0, -1).map(proj.from),
        ...(holes.length ? { holes: holes.map((h) => h.slice(0, -1).map(proj.from)) } : {}),
      });
    }
    out.set(patch.ownerId, shapes);
  }

  // Links last — they own no ground, so they take no part in the
  // partition, but they still belong to their owner's shape list.
  for (const [ownerId, ls] of lines) {
    out.set(ownerId, [...(out.get(ownerId) ?? []), ...ls]);
  }
  return out;
}

// How much ground a set of shapes actually holds. Islands are summed and
// pockets somebody else holds are subtracted; a line contributes nothing,
// which is the same thing it looks like. Because the partition makes
// shapes disjoint, this never double-counts.
function totalAreaM2(shapes: TerritoryShape[]): number {
  let total = 0;
  for (const s of shapes) {
    if (s.kind !== 'area') continue;
    total += polygonAreaM2(s.points);
    for (const h of s.holes ?? []) total -= polygonAreaM2(h);
  }
  return Math.max(0, total);
}

// Standing on your own ground — inside one of your shapes but not inside
// a pocket someone else holds, or within a short grace band of the edge.
// The band exists so the perk doesn't strobe on and off while the dog
// wanders along a border, which is exactly where a walker naturally
// spends their time.
function isHome(pos: LatLng, shapes: TerritoryShape[]): boolean {
  for (const s of shapes) {
    if (s.kind !== 'area') continue;
    if (pointInPolygon(pos, s.points)) {
      if ((s.holes ?? []).some((h) => pointInPolygon(pos, h))) continue;
      return true;
    }
    // Cheap outside-but-close test: any vertex within the grace band. A
    // long edge whose midpoint you're standing near won't match, and
    // that's fine — this is a courtesy margin, not a second geometry.
    if (s.points.some((p) => distanceMeters(pos, p) <= T.homeEdgeM)) return true;
  }
  return false;
}

// Everything the map draws, off ONE read of every mark in view.
//
// Your ground and your neighbours' come out of the same partition, which
// is the point: computing them separately is what let two people hold the
// same block.
export interface MapTerritory {
  marks: { lat: number; lng: number; closedLoop: boolean; strength: number; at: string }[];
  shapes: TerritoryShape[];
  // Is the walker standing on ground they hold? The passive perks —
  // denser paws, slower happiness drain — hang off this.
  home: boolean;
  rivals: RivalTerritory[];
}

export async function fetchMapTerritory(
  userId: string,
  pos: LatLng,
  radiusM: number,
): Promise<MapTerritory> {
  const radius = Math.min(radiusM, T.rivalViewRadiusM);
  const all = await marksNear(pos, radius, { limit: T.partitionMarkLimit });
  if (all.length === 0) return { marks: [], shapes: [], home: false, rivals: [] };

  const partitioned = partitionShapes(all);
  const shapes = partitioned.get(userId) ?? [];

  // Nearest owners first, so the cap drops the ones furthest from you.
  const rivalIds: string[] = [];
  for (const m of all) {
    if (m.userId === userId || rivalIds.includes(m.userId)) continue;
    if (!partitioned.has(m.userId)) continue;
    rivalIds.push(m.userId);
    if (rivalIds.length >= T.maxRivalsDrawn) break;
  }
  const names = await ownerNames(rivalIds);

  return {
    marks: all
      .filter((m) => m.userId === userId)
      .map((m) => ({
        lat: m.lat,
        lng: m.lng,
        closedLoop: m.closedLoop,
        strength: m.strength,
        at: m.at.toISOString(),
      })),
    shapes,
    home: isHome(pos, shapes),
    rivals: rivalIds.map((id) => ({
      ownerId: id,
      ownerName: names.get(id) ?? 'сусід',
      shapes: partitioned.get(id) ?? [],
    })),
  };
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

// Who holds the most of the city. Partitioned the same way the map is, so
// the number on the board is the ground you can actually see yourself
// holding — the alternative is a score that counts territory the map
// gives to somebody else.
//
// Recomputing every hull is real work, so this is CACHED: a standing, not
// a live scoreboard, and a few minutes of lag is invisible at the scale
// it's read.
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

  const scored = [...partitionShapes(rows)]
    .map(([userId, shapes]) => ({ userId, areaM2: Math.round(totalAreaM2(shapes)) }))
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

// Where a given user stands, and how much they hold. Recomputed from the
// same global partition rather than read out of the board, so someone
// outside the top ten still gets a real number for their own ground.
export async function territoryStanding(
  userId: string,
  board: LeaderboardEntry[],
): Promise<{ areaM2: number; rank: number | null }> {
  const idx = board.findIndex((e) => e.userId === userId);
  if (idx >= 0) return { areaM2: board[idx]!.areaM2, rank: idx + 1 };

  // Off the board — partition their own neighbourhood to get an honest
  // number. Scoped to their marks plus everyone near them, since only
  // neighbours can take ground off them.
  const own = await liveMarks(userId);
  if (own.length === 0) return { areaM2: 0, rank: null };
  const centre = own[0]!;
  const near = await marksNear(
    { lat: centre.lat, lng: centre.lng },
    T.rivalViewRadiusM,
    { limit: T.partitionMarkLimit },
  );
  const shapes = partitionShapes(near).get(userId) ?? [];
  return { areaM2: Math.round(totalAreaM2(shapes)), rank: null };
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

// Drop the cached standing so the next reader recomputes. Called on boot,
// because that's the moment territory can have changed without any
// request touching it — a migration that wipes the table, or a rule
// change in the deploy itself. Without this the board keeps quoting
// yesterday's city for another five minutes.
export async function clearLeaderboardCache(): Promise<void> {
  try {
    if (redis.status !== 'ready') return;
    await redis.del(BOARD_KEY);
  } catch {
    // Worst case the board is stale until the TTL runs out.
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
