// Territory marking — the dog claims ground as you walk, and loses it when
// someone else walks over it.
//
// The whole mechanic hangs off one hook: /collect/path already gives the
// server a movement-verified position every ~15s (it owns the previous
// anchor in Redis and rejects teleports), so that's where we ask "should
// the dog mark here?". No new client trust surface — a tampered client
// can't claim ground it didn't walk to any more than it can farm paws.
//
// GROUND IS STORED; MARKS GROW IT
// -------------------------------
// A territory used to BE the hull of your live marks, recomputed on every
// read with rival overlaps subtracted at draw time. That model could not
// express the one thing territory has to do: lose a piece and keep the
// rest. With nowhere to remember a bite, an overrun dot could only
// survive (and hand the ground back when the rival faded), die (and
// collapse the whole shape — to NOTHING at three dots, the minimum that
// encloses anything), or move (and redraw the shape into something that
// was never the cut).
//
// So ground lives in territory_ground, and a mark does two things to it:
//
//   GROW — the hull of the mark and its NEARBY marks (within claimNeighbourM
//          of it) is unioned into what the owner holds
//   CUT  — the same hull is subtracted from every rival piece it covers
//
// Both happen ONCE, at the moment of marking. Two owners can therefore
// never overlap, a loss is permanent without anything having to remember
// it later, and a sync is a box query instead of a city-wide partition —
// which is where all the CPU used to go.
//
// A claim is LOCAL. It was the hull of the whole transitive cluster,
// which under stored ground meant every mark re-claiming everywhere the
// dog had ever walked — districts of paint, and captures on the far side
// of the city from a mark made here. The union is what accumulates a
// territory now, so a claim only has to cover the ground around the mark
// that made it.
//
// DECAY
// -----
// Marks expire (markTtlDays); ground does not. Expiry only limits the
// hull the NEXT mark draws — it never takes back ground already held.
// Ground changes hands one way: somebody walks in and marks over it.
//
// WHAT YOU SEE IS WHAT YOU HOLD. A mark only ever sits on ground its
// owner holds or on nobody's, because a capture takes the marks inside it
// along with the ground. No dot is quietly waiting under someone else's
// colour to spring the border back.
//
// CONTEST
// -------
// Marking is the same gesture for attack and defence, which is the whole
// point: you don't press a "raid" button, you walk somewhere and the dog
// does what dogs do.
//
//   • near YOUR OWN live marks  → they renew, and the hull they draw
//     extends whatever you already hold.
//   • over a RIVAL's ground     → they lose exactly the piece your new
//     shape covers, and the marks inside it go with it. Everything
//     outside stands: their other ground, their other dots. To take it
//     back they walk it and mark it out again, which is what it cost to
//     take in the first place.
//
// TERRITORY IS THE POLYGON BETWEEN YOUR DOTS. Nothing is grown outward and
// nothing is inflated to meet a neighbour. Two owners share a border when
// one of them has actually walked into the other's ground, and open
// country between two dogs that never meet stays open country.
//
// NO MARKING ON GROUND YOU ALREADY HOLD. A mark inside your own territory
// moves no border, so the dog only marks at the frontier or on somebody
// else's ground, and every mark either extends a territory or takes one.
// This is now a direct question — is this point inside a piece I own —
// rather than the two proxies it went through while ground was derived.
//
// EVERY MARK IS EQUAL. There was a strength tier once — marks hardened to
// 3 on repeat visits and took as many rival marks to remove — and it made
// the state of a border impossible to read or count: two zones touching
// told you nothing about who was actually winning without knowing the
// hidden number under each dot. One mark, one claim.
//
// HOME GROUND
// -----------
// Holding ground pays, and all of it is passive: on your own streets the
// paws are denser and the dog's happiness drains at half rate. Nothing to
// activate and nothing to remember — the reward still lands on a player
// who never learns the mechanic has a name. Plus the standing, which is
// the part that makes people care: total area held, ranked, summed
// straight off the ground each owner is standing on.

import { and, desc, eq, gte, lte, ne, sql, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, schema } from '../db/index.js';
import { balance } from '../config/balance.js';
import { distanceMeters, type LatLng } from '../utils/geo.js';
import { concaveHull, pointInPolygon } from '../utils/territoryShapes.js';
// Ground is stored, and everything that changes or reads it lives there.
// The polygon clipping this file used to do on every sync went with it.
import {
  claimGround,
  groundIn,
  groundOf,
  groundStanding,
  groundTotals,
  ownerAt,
  pieceCovers,
  clearGround,
  type GroundPiece,
} from './ground.js';
import { isOnWater } from '../data/kyivWater.js';

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
  reason?:
    | 'cooldown'
    | 'too-close'
    | 'hungry'
    | 'grumpy'
    | 'no-state'
    | 'own-ground'
    | 'water';
  position?: LatLng;
  // Set when this mark is the one that gave its cluster area for the
  // first time — the third of a group. The client makes a moment of it.
  enclosed?: boolean;
  // True when this mark landed on ground we already hold, renewing it
  // rather than claiming anything new — worth its own line from the dog.
  renewed?: boolean;
  // How many neighbours this mark took ground off, and whether it took
  // any. The difference between "we're sniffing around their edge" and
  // "that corner is ours now".
  stolen?: number;
  captured?: boolean;
}

export interface TerritoryShape {
  kind: 'area' | 'line';
  // 'area' — the outer boundary. 'line' — the two marks it joins.
  points: { lat: number; lng: number }[];
  // Pockets inside this shape that somebody else cut out of it. Only on
  // 'area'.
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
      id: schema.territoryMarks.id,
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

  // Landing on ground you already hold renews it rather than hardening
  // it — every mark is worth exactly one, whoever made it and however
  // often they come back.
  const renewed = own.length > 0;

  // THE SHAPE THIS MARK DRAWS — and how far it can reach.
  //
  // This used to be the hull of the whole CLUSTER: every mark chained to
  // every other through neighbours within claimNeighbourM, transitively. That
  // was right while ground was recomputed on every read, because the
  // cluster hull WAS the territory and had to be redrawn whole each time.
  //
  // Carried into stored ground it is badly wrong. A chain of marks 200m
  // apart spans as far as the dog has ever walked, so every single mark
  // re-claimed that entire span — painting ground nowhere near the dog
  // and cutting neighbours on the far side of the city, from a mark it
  // made here. Which is exactly what it looked like: zones covering
  // whole districts, and captures where no dog had been.
  //
  // Stored ground does not need the whole territory redrawn, because the
  // union remembers. So a mark claims LOCALLY: the hull of itself and the
  // marks within claimNeighbourM OF IT. A walk paints piece by piece and the
  // territory is what those pieces add up to.
  //
  // It also ends the bridging problem for free. No single claim can span
  // a walk, so a V-shaped route no longer gets its mouth sealed by a hull
  // stretched across two arms the dog never walked between.
  const prior = await liveMarks(userId);
  const cluster = [
    ...prior
      .filter((m) => distanceMeters(pos, { lat: m.lat, lng: m.lng }) <= T.claimNeighbourM)
      .map((m) => ({ lat: m.lat, lng: m.lng })),
    pos,
  ];
  const enclosed = cluster.length === T.shapeMinMarks;
  const hull = cluster.length >= T.shapeMinMarks ? concaveHull(cluster, T.shapeEdgeMaxM) : [];

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
    // Marking costs a little effort and pays back a little joy — the wire
    // between territory and the bones/paws economy — and stamps the
    // cooldown/spacing anchor the next call gates on. In the same
    // transaction as the mark, so a failure here can't leave a mark down
    // with no cooldown recorded and the dog marking every tick. A no-op
    // for bots, which have no companion row.
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

  // THE GROUND ITSELF: grown by this hull, and cut out of whoever it
  // covers. They keep every piece outside the cut, however many marks
  // they have left — that is the whole reason ground is stored.
  //
  // Its own transaction, deliberately after the mark is safely down: a
  // clipper failure must not roll back the dog's mark. Ground can be
  // rebuilt by the next mark; a mark that never landed is gone.
  const claimed =
    hull.length >= 3
      ? await claimGround(userId, hull)
      : { gainedM2: 0, victims: new Map<string, number>(), changed: false };

  // TAKING THE GROUND TAKES THE SCENT WITH IT.
  //
  // Every rival mark inside the claimed shape is removed. This is the
  // exact rule an earlier cut rejected, and it is worth being clear about
  // why it is right NOW and was wrong THEN: a territory used to BE the
  // hull of its marks, so deleting one collapsed the shape — at three
  // marks it deleted the entire zone, and losing a corner cost a
  // neighbour everything. Ground is stored now. Deleting a mark removes
  // no ground whatsoever; it only removes that dot as an input to some
  // future claim.
  //
  // What it buys is a rule with no hidden state. Before this, a dot under
  // somebody else's paint still counted, so one mark beside it re-drew
  // the old hull and took the whole piece back at a stroke — a comeback
  // with nothing on screen to explain it, off dots that looked like they
  // belonged to ground their owner plainly did not hold. Now: what you
  // see is what you hold, and taking a zone back costs what taking it
  // cost in the first place — walking it and marking it out again.
  //
  // Scoped to the claimed shape, not the neighbourhood: marks outside it
  // are on ground nobody just took, and they stand.
  if (claimed.changed && hull.length >= 3) {
    const reachM = hull.reduce((r, p) => Math.max(r, distanceMeters(pos, p)), 0);
    const doomed = (await marksNear(pos, reachM + 1, { exceptUserId: userId })).filter((m) =>
      pointInPolygon({ lat: m.lat, lng: m.lng }, hull),
    );
    if (doomed.length) {
      await db.delete(schema.territoryMarks).where(
        inArray(
          schema.territoryMarks.id,
          doomed.map((m) => m.id),
        ),
      );
    }
  }

  // One raid per victim, not per mark — a neighbour walking through is a
  // single event to the person it happens to. Driven by ground actually
  // lost rather than by dots stood near, so the message and the map agree
  // about whether anything happened.
  const victims = [...claimed.victims.keys()].filter((id) => !isBot(id));
  if (victims.length) {
    await db.insert(schema.territoryRaids).values(
      victims.map((victimId) => ({
        id: nanoid(),
        victimId,
        raiderId: userId,
        raiderName,
        lat: pos.lat,
        lng: pos.lng,
        // Their marks in the taken piece went with it, so this is a real
        // loss rather than a visit.
        killed: true,
        createdAt: now,
      })),
    );
  }

  return {
    enclosed,
    renewed,
    // How many neighbours this took ground off, and whether it took any.
    stolen: claimed.victims.size,
    captured: claimed.victims.size > 0,
  };
}

// Should the dog mark here, and if so, record it.
//
// Called from /collect/path with a position the server has already
// validated as reachable — and with the COMPANION's position, since it's
// the dog that marks, not the walker.
// Is this spot ground the owner still holds?
//
// The rule it serves — don't spend a mark where it changes nothing — has
// been through three answers, and the first two were guesses at a
// question nothing in the database could answer.
//
// It first asked whether the spot was inside the hull of the owner's own
// MARKS. Adequate while marking deleted a rival's marks, because losing
// ground meant losing the dots that drew it. It stopped being adequate
// the moment nothing gets deleted, and it stranded a real player: they
// held a patch, logged off, a neighbour took it, and every mark of theirs
// still stood — so the hull still enclosed the spot and the answer stayed
// "yours" forever, while the map plainly showed the ground as someone
// else's. Reproduced: hull says mine, ground actually held 0.00 ha.
//
// It then asked the same question plus "has anyone marked here more
// recently", a deliberately conservative stand-in for the partition,
// because running the real partition per mark attempt was the CPU problem
// this file spent a day escaping.
//
// Now the ground is stored, so it just asks. One indexed box query
// against the pieces covering this point — cheaper than either guess, and
// it cannot disagree with the map, because it IS the map.
async function standsOnHeldGround(userId: string, pos: LatLng): Promise<boolean> {
  return (await ownerAt(pos)) === userId;
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
  // Nobody claims the river. The dog's position is clamped to within
  // MAX_DOG_OFFSET_M of a movement-verified walker, so this is not an
  // anti-cheat measure — it stops a walk along the embankment from putting
  // a mark out in open water, and with it a territory nobody could ever
  // walk to in order to take back.
  if (isOnWater(pos)) return { marked: false, reason: 'water' };
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
// Returns how many over-ceiling marks it had to clear, so the caller can
// say so out loud. Normally 0.
export async function markAsBot(botId: string, botName: string, pos: LatLng): Promise<number> {
  // Same rule the player's dog follows — no claiming open water.
  if (isOnWater(pos)) return 0;
  let live = await liveMarks(botId);

  // THE CEILING IS AN INVARIANT, NOT A GATE.
  //
  // Everything below only refuses to GROW past botMaxMarks: at the cap it
  // renews a mark, or trades one for another, both net zero. That holds a
  // bot at twelve only if it never got above twelve — and prod says they
  // all did. Twenty-four hours after a full wipe, every one of the thirty
  // bots was serving the full 24-mark payload cap, meaning each held at
  // least twice the ceiling, on distinct positions.
  //
  // I could not reproduce it. The same code, config and database, running
  // the real cron with thirty bots in the same city, holds every bot at
  // exactly 12 through hundreds of marks and raids — checked with slow
  // walking and with movement compressed 30x. Nor is it two machines
  // racing: presence shows one simulator per bot (every bot moves 8-10m
  // between 3s reads, never a jump), and it isn't a stale image either
  // (0 of 751 live marks sit in water, so the marking code is current).
  //
  // So stop trying to prevent the leak and correct for it instead:
  // whatever a bot is carrying when it goes to mark, the oldest above the
  // ceiling go. Self-healing, which a guard is not — the city repairs
  // itself over the next round of marking rather than needing a wipe, and
  // if the leak is still there it can only ever be one mark deep.
  let pruned = 0;
  if (live.length > T.botMaxMarks) {
    const excess = live.slice(0, live.length - T.botMaxMarks);
    await db.delete(schema.territoryMarks).where(
      inArray(
        schema.territoryMarks.id,
        excess.map((m) => m.id),
      ),
    );
    live = live.slice(excess.length);
    pruned = excess.length;
  }
  // Same rule the player's dog follows: no marking on ground you already
  // hold. A bot's stroll radius is wider than its patch, so this turns
  // most of its walking into either expansion at the edge or a raid on a
  // neighbour, instead of it circling its own park topping up a scent
  // nobody can see. Checked before the ceiling logic below, so the
  // at-cap renewal can't smuggle a home-ground mark back in.
  if (T.markOnlyOutsideOwnGround && (await standsOnHeldGround(botId, pos))) return pruned;
  if (live.length >= T.botMaxMarks) {
    // At the ceiling. What happens next depends on WHERE it's standing.
    const rivals = await marksNear(pos, T.contestM, { exceptUserId: botId });
    if (rivals.length === 0) {
      // Home ground, nothing to fight: refresh the oldest mark so the
      // patch stays alive without creeping across the city.
      //
      // By id, not by position: two marks a metre apart round to the same
      // place often enough, and "renew the oldest" meant to move one row.
      const oldest = live[0]!;
      await db
        .update(schema.territoryMarks)
        .set({ createdAt: new Date() })
        .where(eq(schema.territoryMarks.id, oldest.id));
      return pruned;
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
    await db.delete(schema.territoryMarks).where(eq(schema.territoryMarks.id, oldest.id));
  }
  await placeMark(botId, botName, pos);
  return pruned;
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

// Trim a coordinate on the way out of the door.
//
// A float64 latitude serialises as ~17 digits, and almost all of them are
// describing something smaller than a centimetre — of a border drawn
// around dots a hundred metres apart. Over a whole map payload that noise
// is 12% of the bytes, which is most of what sending every rival mark
// costs.
//
// Sixth decimal, not the fifth, and the reason is the hairline threads
// between touching pieces. Trimming snaps every vertex onto a grid. A
// vertex the two pieces SHARE lands in the same place for both — same
// input, same output — but a vertex that sat partway along the
// neighbour's straight edge gets nudged off that line by up to half a
// cell, and the sliver it opens either shows the map through it or gets
// painted twice and goes dark. On a 1e5 grid that is up to 0.55m, which
// is a visible thread once you are zoomed in past a metre per pixel; on
// 1e6 it is 0.055m, under a tenth of a pixel at any zoom the app allows.
//
// Measured after the switch, on a live payload: near-contact vertices
// that were spread over 0.1-0.6m now sit almost entirely under 0.05m
// (144 of ~190, against 15 before), and the handful left past a metre
// are pieces that genuinely do not touch. The cost is 2.9KB on 92KB —
// about 3%, which buys the artefact away and is the honest figure. An
// earlier note here claimed 0.2KB; that came from re-rounding an
// already-5dp payload UP to six decimals, which is a no-op and measured
// nothing.
//
// Emit-time only, and copied rather than edited in place: the next reader
// of these shapes wants them whole.
const COORD_DP = 1e6; // ~0.11m north/south, ~0.07m east/west in Kyiv
const trim = (v: number): number => Math.round(v * COORD_DP) / COORD_DP;
const trimPoints = (points: { lat: number; lng: number }[]) =>
  points.map((p) => ({ lat: trim(p.lat), lng: trim(p.lng) }));
const trimShapes = (shapes: TerritoryShape[]): TerritoryShape[] =>
  shapes.map((s) => ({
    kind: s.kind,
    points: trimPoints(s.points),
    ...(s.holes ? { holes: s.holes.map(trimPoints) } : {}),
  }));

export async function fetchMapTerritory(
  userId: string,
  pos: LatLng,
  radiusM: number,
): Promise<MapTerritory> {
  const radius = Math.min(radiusM, T.rivalViewRadiusM);
  const box = bbox(pos, radius);

  // THE WHOLE READ. Two indexed queries and no geometry: the pieces whose
  // box is in view, and the dots to draw on them.
  //
  // This used to cluster every mark in a 5km radius, build a hull per
  // cluster, and run polygon subtraction between every pair of neighbours
  // — per sync, per player, on a shared vCPU, behind a stale-while-
  // revalidate cache that existed only to stop it running every time. All
  // of that now happens once, when a dog marks, because the answer is
  // stored instead of derived.
  const [pieces, all] = await Promise.all([
    groundIn(box),
    marksNear(pos, radius, { limit: T.partitionMarkLimit }),
  ]);
  if (pieces.length === 0 && all.length === 0)
    return { marks: [], shapes: [], rivalMarks: [], home: false, rivals: [] };

  const asShape = (piece: GroundPiece): TerritoryShape => ({
    kind: 'area',
    points: trimPoints(piece.ring.map(([lng, lat]) => ({ lat: lat!, lng: lng! }))),
    ...(piece.holes.length
      ? { holes: piece.holes.map((h) => trimPoints(h.map(([lng, lat]) => ({ lat: lat!, lng: lng! })))) }
      : {}),
  });

  const shapes: TerritoryShape[] = [];
  const byOwnerGround = new Map<string, TerritoryShape[]>();
  const nearestOf = new Map<string, number>();
  for (const piece of pieces) {
    if (piece.userId === userId) {
      shapes.push(asShape(piece));
      continue;
    }
    const list = byOwnerGround.get(piece.userId);
    if (list) list.push(asShape(piece));
    else byOwnerGround.set(piece.userId, [asShape(piece)]);
    // Nearest corner, for deciding which neighbours survive the cap.
    const d = piece.ring.reduce(
      (best, [lng, lat]) => Math.min(best, distanceMeters(pos, { lat: lat!, lng: lng! })),
      Infinity,
    );
    nearestOf.set(piece.userId, Math.min(nearestOf.get(piece.userId) ?? Infinity, d));
  }

  // Nearest owners first, so the cap drops the ones furthest from you.
  const rivalIds = [...byOwnerGround.keys()]
    .sort((a, b) => (nearestOf.get(a) ?? Infinity) - (nearestOf.get(b) ?? Infinity))
    .slice(0, T.maxRivalsDrawn);
  const names = await ownerNames(rivalIds);

  // Every mark each drawn neighbour holds, newest first.
  //
  // This was every rival mark under rivalMarkFlashMs (45s), which in
  // practice showed nothing — a bot marks every few minutes, so the odds of
  // catching one were about one in five per neighbour per look. Then it was
  // exactly ONE per neighbour, which showed too little in a different way:
  // a patch needs at least three marks to exist at all, so a single dot
  // beside a zone reads as though one mark conjured it.
  //
  // Then it was the newest four each, which sounded like "enough to see the
  // cluster" and was the wrong four: a hull is held up by the OUTERMOST
  // marks and the newest ones usually sit inside the range already held.
  // Measured on live shapes, 199 of 200 zone corners were on a mark the
  // client had never received — so a territory could shift with nothing on
  // screen accounting for it.
  //
  // Sending all of them means the corners of a zone have dots on them. The
  // client fades by age, so the recent ones still read as "that just
  // happened" while the rest quietly show what the shape was drawn around.
  const byOwnerMarks = new Map<string, typeof all>();
  for (const m of all) {
    if (m.userId === userId) continue;
    const list = byOwnerMarks.get(m.userId);
    if (list) list.push(m);
    else byOwnerMarks.set(m.userId, [m]);
  }

  return {
    rivalMarks: rivalIds.flatMap((id) =>
      (byOwnerMarks.get(id) ?? [])
        .slice()
        .sort((a, b) => b.at.getTime() - a.at.getTime())
        .slice(0, T.rivalMarksPerOwner)
        .map((m) => ({
          lat: trim(m.lat),
          lng: trim(m.lng),
          ownerId: m.userId,
          at: m.at.toISOString(),
        })),
    ),
    marks: all
      .filter((m) => m.userId === userId)
      .map((m) => ({
        lat: trim(m.lat),
        lng: trim(m.lng),
        closedLoop: m.closedLoop,
        at: m.at.toISOString(),
      })),
    shapes,
    // Off the stored pieces rather than the trimmed shapes: standing a
    // metre inside your own border is still standing inside it, and this
    // decides a perk, not a picture.
    home: pieces.some((p) => p.userId === userId && pieceCovers(p, pos)),
    rivals: rivalIds.map((id) => ({
      ownerId: id,
      ownerName: names.get(id) ?? 'сусід',
      shapes: byOwnerGround.get(id) ?? [],
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

// Who holds the most of the city.
//
// A GROUP BY over a stored column. It is worth spelling out what this
// replaced, because the shape of the old version is why the whole model
// changed: it read every live mark in the city, clustered them, built a
// hull per cluster and ran polygon subtraction between neighbours, then
// summed the areas. On one shared vCPU that took over a minute uncapped —
// /territory/leaderboard timed out at 60s and /health, which touches
// nothing, answered 503 right behind it. It needed a cache, a
// single-flight guard, a coarser bite limit than the map's, and a rule
// never to compute it on the request path.
//
// None of that is needed now. Area is stored when the ground changes
// hands, which is the only moment it can change, so the board is a sum
// and reads live.
export async function territoryLeaderboard(): Promise<LeaderboardEntry[]> {
  const totals = (await groundTotals())
    .map((t) => ({ userId: t.userId, areaM2: Math.round(t.areaM2) }))
    .filter((e) => e.areaM2 > 0)
    .sort((a, b) => b.areaM2 - a.areaM2)
    .slice(0, T.leaderboardSize);

  const names = await ownerNames(totals.map((e) => e.userId));
  return totals.map((e) => ({
    ...e,
    name: names.get(e.userId) ?? 'сусід',
    bot: isBot(e.userId),
  }));
}

// Where a given user stands, and how much they hold.
//
// ALWAYS A REAL POSITION. This used to return the index in the top ten and
// null for anybody outside it, and null rendered as a dash — which tells a
// player they do not register rather than where they are. Counting the
// owners ahead of them costs one GROUP BY over a stored column, the same
// shape the board itself is, so there was never a reason to withhold it.
//
// Holding nothing still gets a rank: last, alongside everyone else who
// holds nothing. That is a truthful thing to be told and a much better
// starting point than a dash.
export async function territoryStanding(
  userId: string,
  board: LeaderboardEntry[],
): Promise<{ areaM2: number; rank: number | null }> {
  const idx = board.findIndex((e) => e.userId === userId);
  if (idx >= 0) return { areaM2: board[idx]!.areaM2, rank: idx + 1 };
  const standing = await groundStanding(userId);
  return { areaM2: Math.round(standing.areaM2), rank: standing.rank };
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
  // Ground as well as marks: dropping the dots no longer drops the
  // territory, which is the entire point of storing it.
  await clearGround(userId);
  await db.transaction(async (tx) => {
    await tx.delete(schema.territoryMarks).where(eq(schema.territoryMarks.userId, userId));
    await tx
      .update(schema.companionState)
      .set({ lastMarkAt: null, lastMarkLat: null, lastMarkLng: null })
      .where(eq(schema.companionState.userId, userId));
  });
}
