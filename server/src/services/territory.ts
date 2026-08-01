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
//   • near YOUR OWN live marks  → they renew: their clocks restart, so
//     walking the same streets keeps that ground alive against decay.
//     Only at the EDGE, though — see below.
//   • inside a RIVAL's range     → nothing of theirs is touched. Your dots
//     and theirs both stand, and the ground the two shapes both cover goes
//     to whoever marked there most recently — so your new shape takes
//     exactly the piece it covers and theirs is redrawn around it. A raid
//     row is written so they hear you were there.
//
// TERRITORY IS THE POLYGON BETWEEN YOUR DOTS. Nothing is grown outward and
// nothing is inflated to meet a neighbour. Two owners share a border when
// one of them has actually walked into the other's ground, and open
// country between two dogs that never meet stays open country.
//
// NO MARKING ON GROUND YOU ALREADY HOLD. A mark inside your own hull
// moves no border and changes nothing anyone can see — it just spends the
// cooldown while the dog announces it has refreshed a scent. So the dog
// only marks at the frontier or on somebody else's ground, and every mark
// either extends a territory or takes one. The cost is that territory is
// no longer topped up from the inside: it lives on whoever keeps walking
// its edge, and decays away under an owner who stops going out.
//
// EVERY MARK IS EQUAL. There was a strength tier once — marks hardened to
// 3 on repeat visits and took as many rival marks to remove — and it made
// the state of a border impossible to read or count: two zones touching
// told you nothing about who was actually winning without knowing the
// hidden number under each dot. One mark, one claim, one mark to take it.
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
  concaveHull,
  clusterPoints,
  polygonAreaM2,
  pointInPolygon,
  localProjection,
  bufferConvex,
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

// Emergency lever. Set TERRITORY_PARTITION=off on the API and every owner
// simply keeps their whole claim — zones overlap again, which is wrong but
// cheap. Exists because the partition is pure synchronous JS on the hot
// path: when it got too expensive it didn't degrade, it blocked the event
// loop and took /health down with it. A flag beats a redeploy at 3am.
const PARTITION_ON = process.env.TERRITORY_PARTITION !== 'off';


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
  reason?: 'cooldown' | 'too-close' | 'hungry' | 'grumpy' | 'no-state' | 'own-ground';
  position?: LatLng;
  // Set when this mark is the one that gave its cluster area for the
  // first time — the third of a group. The client makes a moment of it.
  enclosed?: boolean;
  // True when this mark landed on ground we already hold, renewing it
  // rather than claiming anything new — worth its own line from the dog.
  renewed?: boolean;
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
): Promise<{ enclosed: boolean; renewed: boolean; stolen: number; captured: boolean }> {
  // Everything within the wider of the two radii, in one query.
  const scanM = Math.max(T.refreshM, T.contestM);
  const near = await marksNear(pos, scanM);
  const own = near.filter((m) => m.userId === userId && m.d <= T.refreshM);
  const rivals =
    opts.contest === false
      ? []
      : near.filter((m) => m.userId !== userId && m.d <= T.contestM);

  // Landing on ground you already hold renews it rather than hardening
  // it — every mark is worth exactly one, whoever made it and however
  // often they come back.
  const renewed = own.length > 0;

  // Does this mark give its cluster area for the first time? Only used
  // for the bubble and a slightly larger dot — the shape itself is always
  // derived fresh from the marks, never stored.
  const prior = await liveMarks(userId);
  const cluster =
    clusterPoints([...prior.map((m) => ({ lat: m.lat, lng: m.lng })), pos], T.shapeLinkM).find(
      (c) => c.some((p) => p.lat === pos.lat && p.lng === pos.lng),
    ) ?? [];
  const enclosed = cluster.length === T.shapeMinMarks;

  // NOTHING IS DELETED. A mark next to a rival's used to remove it, which
  // meant the only way to take ground was to erase the evidence somebody
  // else had ever been there — and it made a border impossible to read,
  // because what you saw was the wreckage of past visits rather than who
  // currently holds what.
  //
  // Ground changes hands by GEOMETRY instead: your dots and theirs both
  // stand, both hulls are drawn, and wherever the two overlap it goes to
  // whoever marked there most recently (see the partition). So walking
  // into someone's range and dropping a couple of dots takes exactly the
  // piece your new shape covers and redraws theirs around it — and they
  // take it back by walking in themselves, not by out-deleting you.
  const hits = rivals.slice(0, T.contestMaxHits);
  // Still worth telling them somebody was here. One raid per rival, not
  // per mark: a neighbour walking through is a single event to the person
  // it happens to.
  const victims = new Set(hits.map((m) => m.userId));

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(schema.territoryMarks).values({
      id: nanoid(),
      userId,
      lat: pos.lat,
      lng: pos.lng,
      closedLoop: enclosed,
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
    for (const victimId of victims) {
      // Bots don't read their mail.
      if (isBot(victimId)) continue;
      await tx.insert(schema.territoryRaids).values({
        id: nanoid(),
        victimId,
        raiderId: userId,
        raiderName,
        lat: pos.lat,
        lng: pos.lng,
        // Nothing of theirs was destroyed — this says "somebody was on
        // your ground", which is now what a raid actually is.
        killed: false,
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

  // Ground here just changed, so any partition cached for this cell is
  // stale. Dropping it costs nothing and means the border moves on the
  // very next sync instead of waiting out the bucket.
  invalidatePartitionCell(pos);

  return {
    enclosed,
    renewed,
    // How many of their dots we stood among. Not a kill count any more —
    // a measure of how deep into someone else's range this landed, which
    // is what decides how much of it the new shape takes.
    stolen: hits.length,
    captured: hits.length > 0,
  };
}

// Should the dog mark here, and if so, record it.
//
// Called from /collect/path with a position the server has already
// validated as reachable — and with the COMPANION's position, since it's
// the dog that marks, not the walker.
// Is this spot ground the owner still holds?
//
// The rule it serves — don't spend a mark where it changes nothing — used
// to ask whether the spot was inside the hull of the owner's OWN MARKS.
// That was an adequate proxy while marking DELETED a rival's marks,
// because losing ground meant losing the marks that drew it. It stopped
// being one the moment nothing gets deleted, and it stranded a real player:
//
//   they held a patch, logged off, a neighbour walked in and took it. Every
//   mark of theirs still stood, so the hull still enclosed the spot, so the
//   answer stayed "yours" forever. The dog wandered its own former
//   territory declining to reclaim it, while the map plainly showed the
//   ground as somebody else's. Reproduced: hull says mine, ground actually
//   held 0.00 ha.
//
// So it now also asks whether anyone NEWER is nearby, because that is what
// decides the overlap. Deliberately a cheap, conservative approximation of
// the partition rather than the partition itself: asking the real thing
// means a 5km mark scan plus a fresh partition per attempt, in a different
// cell each time, which at thirty bots is fifteen a minute that all miss
// the cache and evict the cell a player is actually looking at. That is how
// the CPU problem this file spent a day escaping would come straight back.
//
// The approximation errs toward ALLOWING marks, which is the safe
// direction: a mark that turns out to be redundant costs one cooldown, and
// a mark wrongly refused is a dog that looks broken.
async function standsOnHeldGround(userId: string, pos: LatLng): Promise<boolean> {
  const own = await liveMarks(userId);
  if (own.length < T.shapeMinMarks) return false;

  const freshestAt = new Map<string, number>();
  for (const m of own) {
    const k = `${m.lat.toFixed(5)},${m.lng.toFixed(5)}`;
    freshestAt.set(k, Math.max(freshestAt.get(k) ?? 0, m.at.getTime()));
  }

  // Which of our own territories covers this spot, and how fresh it is.
  let ourNewest = 0;
  for (const cluster of clusterPoints(
    own.map((m) => ({ lat: m.lat, lng: m.lng })),
    T.shapeLinkM,
  )) {
    if (cluster.length < T.shapeMinMarks) continue;
    // Same shape the map draws, or the dog's rule and the player's eyes
    // disagree again — the exact failure that stranded one.
    const hull = concaveHull(cluster, T.shapeEdgeMaxM);
    if (hull.length < 3 || !pointInPolygon(pos, hull)) continue;
    ourNewest = cluster.reduce(
      (t, p) => Math.max(t, freshestAt.get(`${p.lat.toFixed(5)},${p.lng.toFixed(5)}`) ?? 0),
      0,
    );
    break;
  }
  if (ourNewest === 0) return false;

  // Anyone who marked here more recently has the overlap, so this ground is
  // theirs and marking it takes it back. Scoped to shapeLinkM: that is how
  // far marks reach to form one territory, so it is the range within which
  // a neighbour's shape could plausibly cover this spot.
  const rivals = await marksNear(pos, T.shapeLinkM, { exceptUserId: userId });
  for (const r of rivals) {
    if (r.at.getTime() > ourNewest) return false;
  }
  return true;
}

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
  // Last, because it costs a query — and by here the cooldown has already
  // elapsed, so this runs at most once per cooldown rather than per sync.
  if (T.markOnlyOutsideOwnGround && (await standsOnHeldGround(userId, pos))) {
    return { marked: false, reason: 'own-ground' };
  }

  const outcome = await placeMark(userId, raiderName, pos);

  return {
    marked: true,
    position: pos,
    ...(outcome.renewed ? { renewed: true } : {}),
    ...(outcome.enclosed ? { enclosed: true } : {}),
    ...(outcome.stolen ? { stolen: outcome.stolen, captured: outcome.captured } : {}),
  };
}

// Bots mark too, so a new city isn't empty ground. Same placement and
// contest rules; the mood gates don't apply (a bot has no companion
// state) and the pacing plus the spacing rule live with the caller, which
// is the only place a bot's "last mark" is remembered.
//
// What's enforced here is a CEILING on how much ground one bot holds.
// Without it a bot pacing its patch for days would stack hundreds of
// marks on the same few streets; at the cap it renews its oldest mark
// instead, so the patch hardens rather than sprawling.
//
// An earlier cut put the spacing rule here instead, refusing to mark
// anywhere within minDistanceM of ANY of the bot's own marks. Combined
// with bots roaming their own patch — where those marks already are —
// that meant every visit renewed and none ever added, so bot territory
// froze at its five seed marks and never grew no matter how far they
// walked.
export async function markAsBot(botId: string, botName: string, pos: LatLng): Promise<void> {
  const live = await liveMarks(botId);
  // Same rule the player's dog follows: no marking on ground you already
  // hold. A bot's stroll radius is wider than its patch, so this turns
  // most of its walking into either expansion at the edge or a raid on a
  // neighbour, instead of it circling its own park topping up a scent
  // nobody can see. Checked before the ceiling logic below, so the
  // at-cap renewal can't smuggle a home-ground mark back in.
  if (T.markOnlyOutsideOwnGround && (await standsOnHeldGround(botId, pos))) return;
  if (live.length >= T.botMaxMarks) {
    // At the ceiling. What happens next depends on WHERE it's standing.
    const rivals = await marksNear(pos, T.contestM, { exceptUserId: botId });
    if (rivals.length === 0) {
      // Home ground, nothing to fight: refresh the oldest mark so the
      // patch stays alive without creeping across the city.
      const oldest = live[0]!;
      await db
        .update(schema.territoryMarks)
        .set({ createdAt: new Date() })
        .where(
          and(
            eq(schema.territoryMarks.userId, botId),
            eq(schema.territoryMarks.lat, oldest.lat),
            eq(schema.territoryMarks.lng, oldest.lng),
          ),
        );
      return;
    }
    // Standing on somebody else's ground: TAKE IT, and give up the oldest
    // corner of home to pay for it. The mark count is unchanged, so a bot
    // that keeps raiding doesn't sprawl — its range MIGRATES toward
    // whoever it's fighting, which is what an aggressive neighbour should
    // look like on the map.
    //
    // Without this the cap quietly made bots pacifists: at the ceiling
    // every visit renewed, so a bot could stand in the middle of a rival's
    // range and never once contest it.
    const oldest = live[0]!;
    await db
      .delete(schema.territoryMarks)
      .where(
        and(
          eq(schema.territoryMarks.userId, botId),
          eq(schema.territoryMarks.lat, oldest.lat),
          eq(schema.territoryMarks.lng, oldest.lng),
        ),
      );
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
  // Seeding off entirely — bots earn their ground by walking. Checked
  // before the query, because this runs on every bot's marking tick and a
  // round trip to learn "nothing to do" thirty times a minute is a
  // round trip wasted.
  if (T.botSeedMarks <= 0) return;

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
  // When it was made. The partition needs this: where two territories
  // overlap, the ground goes to whoever marked there most recently.
  at: Date;
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

// …and a resulting PIECE smaller than this is dropped too. 200m2 is a
// square about 14m on a side — smaller than the buildings it would sit
// between, and well under a pixel of real estate at the zoom anyone looks
// at a district from. A territory is somewhere a dog walked, not a seam
// left over from clipping two of them together.
const MIN_PIECE_M2 = 200;

// Hand the event loop back for one tick. setImmediate rather than
// setTimeout(0) or await-a-resolved-promise: a resolved promise only
// drains the microtask queue and never lets a pending socket be read, so
// it would look like a yield and starve the server just the same.
function breathe(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

// Turn every owner's marks into the shapes they actually hold.
//
// Two passes. The first builds every owner's hulls; the second cuts each
// hull back wherever a neighbour's hull overlaps it AND that neighbour
// marked there more recently. What one side loses is exactly what the
// other side's own shape covers, so the two always sum to the union of the
// hulls — nothing is double-claimed and nothing is orphaned.
//
// An earlier version split the shared ground by a Voronoi cell per rival
// mark, which put a border halfway between two dogs' dots rather than
// along the shape either of them had walked. It was also what made this
// expensive: a patch ringed by neighbours was handed ~145 clip polygons,
// against at most one per neighbour now.
//
// Async, and it yields to the event loop between patches. Not because any
// of this is IO — it's pure CPU — but because pure CPU on the hot path is
// exactly what took the API down: one long synchronous run starves
// everything else in the process, so /health, which touches nothing, timed
// out alongside /sync/map. Yielding turns "the server is gone" into "this
// one response is slow", which is a survivable failure.
async function partitionShapes(
  marks: OwnedMark[],
  opts: { maxPatches?: number; maxBites?: number } = {},
): Promise<Map<string, TerritoryShape[]>> {
  const out = new Map<string, TerritoryShape[]>();
  if (marks.length === 0) return out;
  const startedAt = Date.now();

  const proj = localProjection(marks[0]!);
  const byOwner = new Map<string, OwnedMark[]>();
  for (const m of marks) {
    const list = byOwner.get(m.userId);
    if (list) list.push(m);
    else byOwner.set(m.userId, [m]);
  }
  // Newest mark at a given spot, so a cluster can be dated. Keyed loosely
  // (5 decimal places, about a metre) because the hull's vertices are
  // copies of mark positions, not the mark objects themselves.
  const markedAt = new Map<string, number>();
  for (const m of marks) {
    const k = `${m.lat.toFixed(5)},${m.lng.toFixed(5)}`;
    markedAt.set(k, Math.max(markedAt.get(k) ?? 0, m.at.getTime()));
  }

  // Pass 1 — raw shapes, before anyone's claim is cut back.
  interface Patch {
    ownerId: string;
    // What this owner holds: the polygon between their own dots, grown by
    // claimReachM — which is now 0, so in practice exactly the hull.
    claim: LatLng[];
    claimXY: Pt[];
    marksXY: Pt[];
    centre: LatLng;
    reachM: number;
    // The freshest mark in this cluster. Decides who keeps ground two
    // territories both cover.
    newestAt: number;
  }
  const patches: Patch[] = [];
  const lines = new Map<string, TerritoryShape[]>();

  const addLine = (ownerId: string, points: LatLng[]) => {
    const list = lines.get(ownerId);
    if (list) list.push({ kind: 'line', points });
    else lines.set(ownerId, [{ kind: 'line', points }]);
  };

  for (const [ownerId, ownMarks] of byOwner) {
    const own = ownMarks.map((m) => ({ lat: m.lat, lng: m.lng }));
    for (const cluster of clusterPoints(own, T.shapeLinkM)) {
      if (cluster.length === 2) {
        addLine(ownerId, cluster);
        continue;
      }
      if (cluster.length < T.shapeMinMarks) continue;
      const hull = concaveHull(cluster, T.shapeEdgeMaxM);
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
      const claimXY = bufferConvex(hull.map(proj.to), T.claimReachM);
      patches.push({
        ownerId,
        claim: claimXY.map(proj.from),
        claimXY,
        marksXY: cluster.map(proj.to),
        centre,
        reachM:
          hull.reduce((r, p) => Math.max(r, distanceMeters(centre, p)), 0) + T.claimReachM,
        newestAt: cluster.reduce(
          (t, p) => Math.max(t, markedAt.get(`${p.lat.toFixed(5)},${p.lng.toFixed(5)}`) ?? 0),
          0,
        ),
      });
    }
  }

  // Only the nearest handful take part. Marks arrive sorted by distance,
  // so patch order follows, and what falls off the end is what's furthest
  // from whoever asked. The pair loop below is quadratic in this number.
  const considered = patches.slice(0, opts.maxPatches ?? T.partitionMaxPatches);

  // Pass 2 — cut each patch back to the ground it is nearest to.
  for (const patch of considered) {
    await breathe();
    if (!PARTITION_ON) {
      out.set(patch.ownerId, [
        ...(out.get(patch.ownerId) ?? []),
        { kind: 'area', points: patch.claim },
      ]);
      continue;
    }
    const bites: Pt[][] = [];

    for (const other of considered) {
      if (other.ownerId === patch.ownerId) continue;
      // Territories too far apart to touch can't take anything from each
      // other.
      if (distanceMeters(patch.centre, other.centre) > patch.reachM + other.reachM) continue;

      // NEWEST DOTS WIN THE OVERLAP.
      //
      // Both hulls are real and both stay drawn; the only question is who
      // keeps the ground they both cover. Whoever marked there most
      // recently does. So walking into someone's range and dropping a
      // couple of dots extends your hull over part of theirs and takes
      // exactly that piece, and their polygon is redrawn around it — and
      // they take it back the same way, by walking in, not by deleting
      // anything of yours.
      //
      // Ties (both marked in the same millisecond) go to whichever id
      // sorts first. The comparison reads identically from both sides, so
      // the pair always agrees on the answer — without that they would
      // both concede and the ground would belong to nobody.
      const theirsIsNewer =
        other.newestAt > patch.newestAt ||
        (other.newestAt === patch.newestAt && other.ownerId < patch.ownerId);
      if (!theirsIsNewer) continue;

      // Subtract their whole shape, not the overlap.
      //
      // (patch minus (patch ∩ other)) and (patch minus other) are the same
      // set, so computing the intersection first was work for nothing —
      // and it needed both shapes to be convex, which they no longer are
      // now that hulls follow the walk. Handing the clipper the neighbour's
      // polygon directly is cheaper AND drops the convexity assumption.
      bites.push(other.claimXY);
    }

    // Largest bites first, then capped. A patch surrounded by neighbours
    // could otherwise hand the clipper one polygon per rival mark — the
    // shape of input that blocked the event loop — and the ones dropped
    // are the slivers nobody can see.
    const maxBites = opts.maxBites ?? T.partitionMaxBites;
    if (bites.length > maxBites) {
      bites.sort((a, b) => ringAreaM2(b) - ringAreaM2(a));
      bites.length = maxBites;
    }

    const shapes = out.get(patch.ownerId) ?? [];
    if (bites.length === 0) {
      shapes.push({ kind: 'area', points: patch.claim });
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
      const subject = prepareRing(patch.claimXY, gridM);
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
        console.warn('[territory] partition failed, falling back to raw claim:', err);
      }
    }
    if (!pieces) {
      shapes.push({ kind: 'area', points: patch.claim });
      out.set(patch.ownerId, shapes);
      continue;
    }

    for (const poly of pieces) {
      const [outer, ...holes] = poly;
      if (!outer || outer.length < 4) continue;
      // Drop the crumbs. Cutting one claim by a dozen neighbours leaves
      // slivers along every seam — sub-100m2 fragments a few metres across
      // that nobody can see and nobody walked to. Measured on prod, they
      // were most of the output: one owner came back as 13 pieces of which
      // 9 were under 0.05ha, another 11 of which 5 were.
      //
      // They are not free. Every one carries vertices into the payload, and
      // back into the NEXT partition as part of a claim, which is a slow
      // ratchet on the most expensive thing this service does — the rival
      // vertex count was climbing 636 -> 774 over an hour of watching.
      //
      // Bites are already filtered on the way IN at MIN_BITE_M2; this is the
      // same idea on the way out, and the threshold is deliberately larger
      // because a piece has to be big enough to be worth DRAWING, not just
      // big enough not to break the clipper.
      if (ringAreaM2(outer as Pt[]) < MIN_PIECE_M2) continue;
      shapes.push({
        kind: 'area',
        points: outer.slice(0, -1).map(proj.from),
        ...(holes.length
          ? {
              holes: holes
                .filter((h) => ringAreaM2(h as Pt[]) >= MIN_PIECE_M2)
                .map((h) => h.slice(0, -1).map(proj.from)),
            }
          : {}),
      });
    }
    out.set(patch.ownerId, shapes);
  }

  // Links last — they own no ground, so they take no part in the
  // partition, but they still belong to their owner's shape list.
  for (const [ownerId, ls] of lines) {
    out.set(ownerId, [...(out.get(ownerId) ?? []), ...ls]);
  }

  const took = Date.now() - startedAt;
  if (took >= T.partitionSlowMs) {
    console.warn(
      `[territory] partition took ${took}ms for ${marks.length} marks, ` +
        `${considered.length}/${patches.length} patches`,
    );
  }
  return out;
}

// One partition, shared by everyone looking at the same neighbourhood.
//
// The work is identical for two clients standing on the same street, and
// it is BY FAR the most expensive thing the sync path does — measured on
// prod, 2.47s of a 3.57s sync, 69%. So it is computed once and handed out.
//
// Keyed on a coarse grid cell and a time bucket, with one explicit
// invalidation: a mark landing inside a cell drops that cell immediately.
// That combination is the point. A pure time bucket is cheap but lets a
// border sit still for a minute after someone visibly marked; invalidating
// on ANY mark anywhere in view is correct and useless, because the view is
// 5km across and thirty bots between them mark every eight seconds, so
// nothing would ever survive to be reused. Narrow invalidation gives
// freshness exactly where something happened and cheapness everywhere
// else.
interface PartitionCacheEntry {
  at: number;
  // Stored as the promise, not the result, so concurrent callers that miss
  // together still only compute once — the second one awaits the first
  // rather than starting its own.
  work: Promise<Map<string, TerritoryShape[]>>;
  // The last SUCCESSFULLY resolved partition for this cell, kept so a
  // caller arriving mid-rebuild can be handed something immediately.
  value: Map<string, TerritoryShape[]> | null;
  // A mark landed here, so `value` is behind the world. Still worth
  // serving — see below.
  stale: boolean;
  rebuilding: boolean;
}
// Keyed by CELL alone, not cell+bucket: an entry has to outlive its own
// freshness window so its last good value is still there to serve while
// the replacement is being built.
const partitionCache = new Map<string, PartitionCacheEntry>();

// Which grid cell a position falls in. Shared by the reader and the
// invalidator so the two can never disagree about what a cell is.
function cellOf(pos: LatLng): string {
  const cell = T.partitionCacheCellDeg;
  return `${Math.round(pos.lat / cell)}:${Math.round(pos.lng / cell)}`;
}

// A mark just landed here, so what is cached for this cell is now behind.
// Deliberately ONE cell — see the note above about why invalidating the
// whole visible radius would empty the cache permanently.
//
// Marks the entry stale rather than deleting it. Deleting was measurably
// wrong: at Maidan, where several bots work the same block, back-to-back
// syncs came back 5.22s / 1.05s / 3.89s / 1.24s — the cache was doing its
// job (4x) and then being thrown away every other request by a bot marking
// nearby. Both numbers are real, and which one a player gets was down to
// luck.
function invalidatePartitionCell(pos: LatLng): void {
  const hit = partitionCache.get(cellOf(pos));
  if (hit) hit.stale = true;
}

// STALE-WHILE-REVALIDATE.
//
// Fresh → serve it. Stale but we have a previous answer → serve THAT and
// rebuild behind the caller. Nothing at all → wait, because there is
// nothing else to give.
//
// The alternative, throttling how often a cell may be invalidated, trades
// the same latency for staleness on a fixed timer and still makes somebody
// wait for the rebuild. This way nobody waits: the cost of a mark landing
// next to you is that your borders are a couple of seconds behind, not
// that your sync takes five seconds.
async function partitionCached(
  pos: LatLng,
  marks: OwnedMark[],
): Promise<Map<string, TerritoryShape[]>> {
  const now = Date.now();
  const key = cellOf(pos);
  const hit = partitionCache.get(key);

  const rebuild = (): Promise<Map<string, TerritoryShape[]>> => {
    const work = partitionShapes(marks);
    const entry: PartitionCacheEntry = {
      at: now,
      work,
      value: hit?.value ?? null,
      stale: false,
      rebuilding: true,
    };
    partitionCache.set(key, entry);
    // Oldest-first eviction. Map preserves insertion order and an entry is
    // re-inserted on every rebuild, so the head is genuinely the cell
    // nobody has looked at for longest.
    while (partitionCache.size > T.partitionCacheMax) {
      const oldest = partitionCache.keys().next().value;
      if (oldest === undefined || oldest === key) break;
      partitionCache.delete(oldest);
    }
    work
      .then((v) => {
        entry.value = v;
        entry.rebuilding = false;
      })
      .catch(() => {
        // Keep whatever we had — a failed rebuild must not erase a good
        // answer — but drop the freshness claim so the next call retries.
        entry.rebuilding = false;
        entry.stale = true;
      });
    return work;
  };

  // A REBUILD IN FLIGHT IS NOT SOMETHING TO WAIT FOR. This has to come
  // first. Starting a rebuild stamps the entry fresh, so checking
  // freshness before this would send the next caller down the fresh path
  // to await `work` — the very partition being rebuilt — and they would
  // sit through the whole thing. Measured on prod, that was 3 syncs in 10
  // still stalling, one of them for 12.87s, every one of them landing
  // exactly when the territory had just changed. Which is to say: the
  // requests that hurt were precisely the ones this was built to protect.
  if (hit?.value && hit.rebuilding) return hit.value;

  if (hit && !hit.stale && now - hit.at < T.partitionCacheMs) return hit.work;

  // Stale or expired, but there IS a previous answer: hand it over and
  // refresh behind. One rebuild at a time per cell — a burst of syncs
  // during a rebuild all get the old value rather than each starting
  // their own partition, which is what would put the machine back where
  // it started.
  if (hit?.value) {
    if (!hit.rebuilding) void rebuild();
    return hit.value;
  }

  return rebuild();
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
  marks: { lat: number; lng: number; closedLoop: boolean; at: string }[];
  shapes: TerritoryShape[];
  // Marks OTHER dogs have just made, so a neighbour's border moving has a
  // visible cause. Without them a rival zone simply changed shape between
  // one sync and the next and you never saw why — the dogs were walking
  // around apparently doing nothing. Only the very recent ones: this is a
  // "that just happened" signal, not their history.
  rivalMarks: { lat: number; lng: number; ownerId: string; at: string }[];
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
  if (all.length === 0)
    return { marks: [], shapes: [], rivalMarks: [], home: false, rivals: [] };

  const partitioned = await partitionCached(pos, all);
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

  // The last few places each neighbour marked, newest first.
  //
  // This was every rival mark under rivalMarkFlashMs (45s), which in
  // practice showed nothing — a bot marks every few minutes, so the odds of
  // catching one were about one in five per neighbour per look. Then it was
  // exactly ONE per neighbour, which showed too little in a different way:
  // a patch needs at least three marks to exist at all, so a single dot
  // beside a zone reads as though one mark conjured it, and a zone with its
  // dot somewhere else reads as though it came from nowhere.
  //
  // A few each is what makes the shape legible: you can see the cluster the
  // hull was drawn around. Capped per owner AND faded by age on the client,
  // so this cannot grow into a scatter of everyone's history.
  const byOwner = new Map<string, typeof all>();
  for (const m of all) {
    if (m.userId === userId) continue;
    const list = byOwner.get(m.userId);
    if (list) list.push(m);
    else byOwner.set(m.userId, [m]);
  }
  return {
    rivalMarks: rivalIds.flatMap((id) =>
      (byOwner.get(id) ?? [])
        .slice()
        .sort((a, b) => b.at.getTime() - a.at.getTime())
        .slice(0, T.rivalMarksPerOwner)
        .map((m) => ({
          lat: m.lat,
          lng: m.lng,
          ownerId: m.userId,
          at: m.at.toISOString(),
        })),
    ),
    marks: all
      .filter((m) => m.userId === userId)
      .map((m) => ({
        lat: m.lat,
        lng: m.lng,
        closedLoop: m.closedLoop,
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
// NEVER computed on the request path. A reader gets whatever is cached,
// and a miss returns an empty board while the work happens behind them.
//
// This is not belt-and-braces, it is the whole point. Partitioning the
// city is by far the most expensive thing this service does, and awaiting
// it inside a request meant one HTTP call could hold a shared vCPU for a
// minute: /territory/leaderboard timed out at 60s and /health — which
// touches nothing at all — answered 503 after 38s right behind it. The
// board is a standing, nobody is watching it tick, and an empty first
// response that fills in seconds later is a far better failure than an
// API that stops answering.
//
// Cold start returns nothing, deliberately: clearLeaderboardCache() runs
// on boot, so the alternative is that the first reader after every single
// deploy pays for the whole city.
export async function territoryLeaderboard(): Promise<LeaderboardEntry[]> {
  const cached = await readCachedBoard();
  if (cached) return cached;
  // Single-flight — on a miss every waiting reader misses at once, and ten
  // simultaneous city-wide partitions is how a five-minute cache still
  // manages to take the process down.
  boardInFlight ??= computeLeaderboard()
    .catch((err) => {
      console.warn('[territory] leaderboard compute failed:', err);
      return [] as LeaderboardEntry[];
    })
    .finally(() => {
      boardInFlight = null;
    });
  // Started, not awaited.
  void boardInFlight;
  return [];
}

let boardInFlight: Promise<LeaderboardEntry[]> | null = null;

async function computeLeaderboard(): Promise<LeaderboardEntry[]> {
  const rows = await db
    .select({
      userId: schema.territoryMarks.userId,
      lat: schema.territoryMarks.lat,
      lng: schema.territoryMarks.lng,
      at: schema.territoryMarks.createdAt,
    })
    .from(schema.territoryMarks)
    .where(gte(schema.territoryMarks.createdAt, liveSince()));

  // Wider than the map view — a board cut to a screenful would score
  // eighteen owners and call it a leaderboard — but bitten far more
  // coarsely. The map needs exact borders because you are looking straight
  // at them; a ranking needs the ORDER to be right, and dropping the small
  // bites moves an area by a few percent without moving anyone up or down.
  // That trade is what makes this affordable on one shared vCPU, where the
  // uncapped version ran for over a minute.
  const scored = [...(await partitionShapes(rows, {
    maxPatches: T.leaderboardMaxPatches,
    maxBites: T.leaderboardMaxBites,
  }))]
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
  const shapes = (await partitionCached({ lat: centre.lat, lng: centre.lng }, near)).get(
    userId,
  ) ?? [];
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
