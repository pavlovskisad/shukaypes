// GROUND — the territory itself, as a thing that exists.
//
// Territory used to be derived: the hull of your live marks, rebuilt from
// scratch on every read, with rival overlaps subtracted at draw time.
// That model could not express the one thing territory has to do — lose a
// piece and keep the rest. A shape recomputed from dots has nowhere to
// remember a bite taken out of it, so an overrun dot could only:
//
//   survive → the ground came back when the rival's marks faded
//   die     → the whole shape collapsed, to NOTHING at three dots
//   move    → the shape changed into something that was never the cut
//
// None of those is "you keep what they didn't take". So the ground is
// stored, and two operations change it:
//
//   GROW  — a dog marks; the hull of that mark's cluster is unioned into
//           whatever the owner already holds nearby.
//   CUT   — the same hull is subtracted from every rival piece it covers.
//           Applied ONCE, at the moment it happens. That's what makes a
//           loss permanent without anything having to remember it later.
//
// Two owners therefore never overlap, and a read is a read: no
// clustering, no hulls, no polygon subtraction on the sync path, which is
// where all of it used to happen and where all the CPU went.
//
// Everything here works in [lng, lat] pairs — the order polygon-clipping
// and GeoJSON both use, so rings go in and out of the clipper untouched.

import { and, desc, eq, gte, lte, ne, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, schema } from '../db/index.js';
import { balance } from '../config/balance.js';
import type { LatLng } from '../utils/geo.js';
// Default import, NOT `import * as`: the package's .d.ts advertises named
// exports but the build is CJS with everything hanging off `default`, so a
// namespace import typechecks fine and hands back `undefined` at runtime.
import polygonClipping from 'polygon-clipping';
import { polygonAreaM2, pointInPolygon, type Pt } from '../utils/territoryShapes.js';

const T = balance.territory;

// One piece of held ground: an outer ring and any pockets inside it.
export interface GroundPiece {
  id: string;
  userId: string;
  ring: Pt[];
  holes: Pt[][];
  areaM2: number;
}

type Poly = Pt[][]; // [outer, ...holes]

const toPoly = (p: { ring: Pt[]; holes: Pt[][] | null }): Poly => [p.ring, ...(p.holes ?? [])];
const asLatLng = (ring: Pt[]) => ring.map(([lng, lat]) => ({ lat: lat!, lng: lng! }));

// ---------------------------------------------------------------------------
// Keeping rings honest.
//
// Union and difference both ADD vertices — every crossing becomes a point,
// and none of them ever leave. Left alone a piece that has been fought over
// for a week is a thousand-point ring describing the same field. Two guards,
// applied on every write:

// 1. Collapse points closer together than the eye can tell apart. A metre
//    of border precision is meaningless on a shape drawn around dots a
//    hundred metres apart.
const MERGE_M = 3;

// 2. A hard ceiling, in case a shape finds a way to be genuinely intricate.
//    Dropping the shallowest corners keeps the outline; dropping the newest
//    would keep the noise.
const MAX_RING_POINTS = 120;

// Below this a piece is confetti, not ground.
//
// 200 -> 2000 (a 45m square), and the reason is a measurement. On prod,
// 64 of 133 pieces in view were under 2000m²: HALF the pieces on the map,
// holding 5.5ha of 208 — 2.6% of the ground and 18% of the corners. The
// smallest were 196-264m², sitting right on the old threshold. A dog
// cutting across a neighbour at a mark every 40m shatters them, and with
// nothing decaying the shards stay forever.
//
// None of it is visible: 200m² at city zoom is a few pixels. What it does
// instead is make the payload — 111KB, 57% of it polygons — and the piece
// count that the view ceiling is measured against.
//
// This is a real cost, stated plainly: an owner loses any fragment smaller
// than this rather than keeping it, and nobody gains it. A gap on the map
// is fine. Two owners on one block is not, which is why holes are held to
// a different rule below.
const MIN_PIECE_M2 = 2000;

// Holes are NOT subject to that, and the difference matters.
//
// A hole is ground somebody else took out of the middle of this piece. If
// a hole is dropped for being small, its owner keeps their piece AND the
// original owner's ring closes back over it — both holding the same
// ground, which is the one thing the model cannot allow. A piece dropped
// for being small leaves a gap; a hole dropped for being small leaves an
// overlap. So this is effectively "only discard a hole with no area at
// all".
const MIN_HOLE_M2 = 1;

// The largest empty pocket inside your own ground that gets closed up.
//
// Deliberately tiny, and the same number as the piece floor. Pockets are
// not a defect — the hull digging inward is what shows where a dog
// actually walked, and a block with a hole in the middle is telling you
// nobody went through the middle. Filling those would be erasing the
// truth of the walk to tidy up the picture.
//
// What closes is only what is beneath noticing: if a fragment under
// MIN_PIECE_M2 is too small to be ground, a hole that size is too small
// to be a hole. Call it a rounding error in the walker's favour.
const MAX_POCKET_M2 = MIN_PIECE_M2;

function simplifyRing(ring: Pt[]): Pt[] {
  if (ring.length < 4) return ring;
  const meanLat = ring.reduce((s, p) => s + p[1]!, 0) / ring.length;
  const mPerLng = 111_320 * Math.cos((meanLat * Math.PI) / 180);
  const near = (a: Pt, b: Pt) =>
    Math.hypot((a[0]! - b[0]!) * mPerLng, (a[1]! - b[1]!) * 110_540) < MERGE_M;

  const out: Pt[] = [];
  for (const p of ring) {
    if (out.length && near(out[out.length - 1]!, p)) continue;
    out.push(p);
  }
  while (out.length > 3 && near(out[0]!, out[out.length - 1]!)) out.pop();
  if (out.length < 3) return ring;

  if (out.length <= MAX_RING_POINTS) return out;
  // Shallowest corners first: the area of the triangle a vertex makes with
  // its neighbours is how much shape is lost by dropping it.
  const keep = out.map((_, i) => i);
  while (keep.length > MAX_RING_POINTS) {
    let worst = 0;
    let worstArea = Infinity;
    for (let k = 0; k < keep.length; k++) {
      const a = out[keep[(k - 1 + keep.length) % keep.length]!]!;
      const b = out[keep[k]!]!;
      const c = out[keep[(k + 1) % keep.length]!]!;
      const area = Math.abs(
        ((b[0]! - a[0]!) * (c[1]! - a[1]!) - (c[0]! - a[0]!) * (b[1]! - a[1]!)) / 2,
      );
      if (area < worstArea) {
        worstArea = area;
        worst = k;
      }
    }
    keep.splice(worst, 1);
  }
  return keep.map((i) => out[i]!);
}

interface Piece {
  ring: Pt[];
  holes: Pt[][];
  areaM2: number;
}

// A clipper result (MultiPolygon) back into storable pieces.
//
// Returns the slivers as well as the keepers, because a sliver is ground
// and has to end up SOMEWHERE. Dropping it on the floor is what put the
// white shards on the map.
function toPieces(result: Pt[][][]): { kept: Piece[]; slivers: Piece[] } {
  const kept: Piece[] = [];
  const slivers: Piece[] = [];
  for (const poly of result) {
    const [outer, ...holes] = poly;
    if (!outer || outer.length < 3) continue;
    const ring = simplifyRing(outer);
    if (ring.length < 3) continue;
    const keptHoles = holes
      .map(simplifyRing)
      .filter((h) => h.length >= 3 && polygonAreaM2(asLatLng(h)) >= MIN_HOLE_M2);
    const areaM2 =
      polygonAreaM2(asLatLng(ring)) -
      keptHoles.reduce((s, h) => s + polygonAreaM2(asLatLng(h)), 0);
    (areaM2 < MIN_PIECE_M2 ? slivers : kept).push({ ring, holes: keptHoles, areaM2 });
  }
  return { kept, slivers };
}

function bboxOf(ring: Pt[]) {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const [lng, lat] of ring) {
    if (lat! < minLat) minLat = lat!;
    if (lat! > maxLat) maxLat = lat!;
    if (lng! < minLng) minLng = lng!;
    if (lng! > maxLng) maxLng = lng!;
  }
  return { minLat, maxLat, minLng, maxLng };
}

// ---------------------------------------------------------------------------
// READS — the sync path, and nothing more expensive than a range scan.

const rowToPiece = (r: {
  id: string;
  userId: string;
  ring: Pt[];
  holes: Pt[][] | null;
  areaM2: number;
}): GroundPiece => ({
  id: r.id,
  userId: r.userId,
  ring: r.ring,
  holes: r.holes ?? [],
  areaM2: r.areaM2,
});

// Every piece whose box overlaps the view. Boxes rather than true geometry:
// a piece just outside the circle costs one polygon in the payload, and the
// alternative is a geometry library on the request path.
export async function groundIn(box: {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}): Promise<GroundPiece[]> {
  const rows = await db
    .select({
      id: schema.territoryGround.id,
      userId: schema.territoryGround.userId,
      ring: schema.territoryGround.ring,
      holes: schema.territoryGround.holes,
      areaM2: schema.territoryGround.areaM2,
    })
    .from(schema.territoryGround)
    .where(
      and(
        gte(schema.territoryGround.maxLat, box.minLat),
        lte(schema.territoryGround.minLat, box.maxLat),
        gte(schema.territoryGround.maxLng, box.minLng),
        lte(schema.territoryGround.minLng, box.maxLng),
      ),
    )
    .limit(T.groundPiecesInView);
  return rows.map(rowToPiece);
}

export async function groundOf(userId: string): Promise<GroundPiece[]> {
  const rows = await db
    .select({
      id: schema.territoryGround.id,
      userId: schema.territoryGround.userId,
      ring: schema.territoryGround.ring,
      holes: schema.territoryGround.holes,
      areaM2: schema.territoryGround.areaM2,
    })
    .from(schema.territoryGround)
    .where(eq(schema.territoryGround.userId, userId));
  return rows.map(rowToPiece);
}

// Is this spot inside the piece — outer ring yes, pocket no?
export function pieceCovers(piece: GroundPiece, pos: LatLng): boolean {
  if (!pointInPolygon(pos, asLatLng(piece.ring))) return false;
  return !piece.holes.some((h) => pointInPolygon(pos, asLatLng(h)));
}

// Who holds this spot? One tiny box query — the question the dog asks
// before marking, and the map asks about the walker's own feet.
export async function ownerAt(pos: LatLng): Promise<string | null> {
  const rows = await db
    .select({
      id: schema.territoryGround.id,
      userId: schema.territoryGround.userId,
      ring: schema.territoryGround.ring,
      holes: schema.territoryGround.holes,
      areaM2: schema.territoryGround.areaM2,
    })
    .from(schema.territoryGround)
    .where(
      and(
        gte(schema.territoryGround.maxLat, pos.lat),
        lte(schema.territoryGround.minLat, pos.lat),
        gte(schema.territoryGround.maxLng, pos.lng),
        lte(schema.territoryGround.minLng, pos.lng),
      ),
    )
    .limit(16);
  for (const r of rows) {
    const piece = rowToPiece(r);
    if (pieceCovers(piece, pos)) return piece.userId;
  }
  return null;
}

// ---------------------------------------------------------------------------
// THE WRITE — one hull in, ground changed hands.

export interface ClaimResult {
  // Ground the claimant did not hold a moment ago, in m².
  gainedM2: number;
  // Who lost some, and roughly how much each. Drives the raid rows.
  victims: Map<string, number>;
  // Did anything change at all? A mark entirely inside your own ground
  // moves no border.
  changed: boolean;
}

// Which ~1km cells a box touches. Claims are serialised per cell, so two
// dogs on opposite sides of the city never wait on each other.
const LOCK_CELL_DEG = 0.01;
function lockKeys(box: { minLat: number; maxLat: number; minLng: number; maxLng: number }) {
  const keys: number[] = [];
  for (let a = Math.floor(box.minLat / LOCK_CELL_DEG); a <= Math.floor(box.maxLat / LOCK_CELL_DEG); a++) {
    for (let b = Math.floor(box.minLng / LOCK_CELL_DEG); b <= Math.floor(box.maxLng / LOCK_CELL_DEG); b++) {
      keys.push(a * 100_000 + b);
    }
  }
  // Ascending, always: two claims wanting the same pair of cells must ask
  // for them in the same order or they deadlock against each other.
  return keys.sort((x, y) => x - y);
}

// Claim the ground under a hull.
//
// Runs in ONE transaction, and takes an advisory lock on every cell the
// claim touches first. The transaction alone is not enough, and prod
// proved it: two owners were holding the same block, ninety metres deep.
// SELECT ... FOR UPDATE locks the rows it FINDS, which says nothing about
// rows that do not exist yet — so two dogs claiming the same corner at the
// same moment each saw the other holding nothing there, and both inserted.
// A lock on the ground itself is what that needs, not a lock on rows.
export async function claimGround(userId: string, hull: LatLng[]): Promise<ClaimResult> {
  const empty: ClaimResult = { gainedM2: 0, victims: new Map(), changed: false };
  if (hull.length < 3) return empty;

  const claim: Pt[] = hull.map((p) => [p.lng, p.lat]);
  const box = bboxOf(claim);
  let claimPoly: Poly[] = [[claim]];

  return db.transaction(async (tx) => {
    for (const key of lockKeys(box)) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${key})`);
    }
    const rows = await tx
      .select({
        id: schema.territoryGround.id,
        userId: schema.territoryGround.userId,
        ring: schema.territoryGround.ring,
        holes: schema.territoryGround.holes,
        areaM2: schema.territoryGround.areaM2,
      })
      .from(schema.territoryGround)
      .where(
        and(
          gte(schema.territoryGround.maxLat, box.minLat),
          lte(schema.territoryGround.minLat, box.maxLat),
          gte(schema.territoryGround.maxLng, box.minLng),
          lte(schema.territoryGround.minLng, box.maxLng),
        ),
      )
      // Biggest first, so if the ceiling below ever bites it drops the
      // slivers rather than a neighbour's whole range.
      .orderBy(desc(schema.territoryGround.areaM2))
      .for('update')
      .limit(T.groundPiecesPerClaim);

    // The ceiling is a bound on one write, not a silent truncation: every
    // piece it drops is a piece that does not get cut, which is another
    // way to end up with two owners on one block. Say so.
    if (rows.length >= T.groundPiecesPerClaim) {
      console.warn(
        `[ground] claim by ${userId} touched the ${T.groundPiecesPerClaim}-piece ceiling; some ground may not have been cut`,
      );
    }

    const mine = rows.filter((r) => r.userId === userId);
    const theirs = rows.filter((r) => r.userId !== userId);
    const heldBefore = mine.reduce((s, r) => s + r.areaM2, 0);

    // CAN THIS CLAIM HOLD GROUND AT ALL? Asked BEFORE anything is cut.
    //
    // A claim smaller than MIN_PIECE_M2 that touches none of the
    // claimant's own ground cannot be stored — toPieces drops it. Cutting
    // first and discovering that afterwards meant a claim too small to
    // hold ground could still destroy it: the victim's piece was carved,
    // the claimant's own piece was dropped for being a sliver, and the
    // ground ended up belonging to NOBODY. Reproduced end to end — a dog
    // walked a small triangle inside a rival's block and the block came
    // back owner null.
    //
    // So the size test comes first. A claim that cannot become ground
    // does nothing whatsoever.
    let dryRun: Pt[][][];
    try {
      dryRun = polygonClipping.union(
        claimPoly as never,
        ...(mine.map((r) => [toPoly(r)]) as never[]),
      ) as Pt[][][];
    } catch {
      return empty;
    }
    if (toPieces(dryRun).kept.reduce((s, p) => s + p.areaM2, 0) - heldBefore < 50) return empty;

    // CUT, now that we know the claim is real. Measured before the grow,
    // so what counts as gained is what changed hands rather than ground
    // already held.
    const victims = new Map<string, number>();
    // Ground somebody else holds that we could not cut. We must not take
    // it either — see below.
    const uncut: Poly[] = [];
    // Fragments of a victim's ground too small to stand on their own.
    // Folded into the claim below rather than dropped.
    const absorbed: Poly[] = [];
    for (const row of theirs) {
      let cut: Pt[][][];
      try {
        cut = polygonClipping.difference([toPoly(row)] as never, claimPoly as never) as Pt[][][];
      } catch {
        // A ring the clipper won't accept keeps its ground.
        uncut.push(toPoly(row));
        continue;
      }
      const { kept: left, slivers } = toPieces(cut);
      const lost = row.areaM2 - left.reduce((s, p) => s + p.areaM2, 0);
      // WHAT IS LEFT OF THEIR PIECE, IF IT IS TOO SMALL TO BE GROUND,
      // GOES TO WHOEVER CUT IT.
      //
      // These used to be dropped, on the reasoning that a gap beats an
      // overlap. That was a false choice — it is only ever a gap because
      // nothing was picking the fragment up. On the map it showed as
      // white shards along every contested border: ground that had an
      // owner a moment ago and now has none, in the middle of a block
      // two dogs are fighting over.
      //
      // Handing them to the claimant conserves the ground, closes the
      // seam, and reads correctly: they cut the piece down to nothing,
      // so they take the remainder with it.
      absorbed.push(...slivers.map((p) => [p.ring, ...p.holes] as Poly));
      // A metre, not MIN_PIECE_M2: skipping here leaves the victim's ring
      // exactly as it was, so anything skipped is ground BOTH of us hold.
      // A square metre of that is rounding; two hundred is a doorway.
      if (lost <= 1) continue;
      victims.set(row.userId, (victims.get(row.userId) ?? 0) + lost);

      await tx.delete(schema.territoryGround).where(eq(schema.territoryGround.id, row.id));
      for (const piece of left) {
        await tx.insert(schema.territoryGround).values({
          id: nanoid(),
          userId: row.userId,
          ring: piece.ring,
          holes: piece.holes.length ? piece.holes : null,
          areaM2: piece.areaM2,
          ...bboxOf(piece.ring),
        });
      }
    }

    // NEVER TAKE WHAT WE COULD NOT CUT.
    //
    // If the clipper refused a victim's ring, their ground stands — and
    // the claim has to give up that piece too, or both of us hold it. The
    // catch above used to be the whole story, and it is how two owners
    // ended up ninety metres deep in the same block on prod: one throw
    // deep inside polygon-clipping, silently swallowed, and the claimant
    // grew over ground the victim never gave up.
    //
    // The safe direction is unambiguous. A border that does not move is a
    // dog that walked somewhere for nothing; two owners on one block is a
    // map that cannot be read.
    if (uncut.length) {
      try {
        claimPoly = polygonClipping.difference(
          claimPoly as never,
          ...(uncut as never[]),
        ) as unknown as Poly[];
      } catch {
        // Could not even subtract them. Take nothing this time.
        return { gainedM2: 0, victims, changed: victims.size > 0 };
      }
      if (claimPoly.length === 0) {
        return { gainedM2: 0, victims, changed: victims.size > 0 };
      }
    }

    // GROW: fold the claim, anything absorbed from a victim, and
    // everything of ours it touches into one shape — so a walk that joins
    // two of your own patches leaves one piece, not two overlapping ones.
    let merged: Pt[][][];
    try {
      merged = polygonClipping.union(
        claimPoly as never,
        ...(absorbed.map((p) => [p]) as never[]),
        ...(mine.map((r) => [toPoly(r)]) as never[]),
      ) as Pt[][][];
    } catch {
      return { gainedM2: 0, victims, changed: victims.size > 0 };
    }
    // Close the pockets too small to mean anything. Everything bigger
    // stays open, because a hole in the middle of a block is the map
    // telling you nobody walked through the middle.
    //
    // Never a pocket a rival might hold: a hole whose box touches any
    // neighbour's piece is left exactly alone, since closing it would be
    // taking their ground without a claim. The bbox test is deliberately
    // conservative that way — a false "keep" is a small gap, a false
    // "fill" is two owners on one block.
    const theirBoxes = theirs.map((r) => bboxOf(r.ring));
    const pieces = toPieces(merged).kept.map((piece) => {
      if (!piece.holes.length) return piece;
      const holes = piece.holes.filter((h) => {
        const a = polygonAreaM2(asLatLng(h));
        if (a >= MAX_POCKET_M2) return true;
        const hb = bboxOf(h);
        return theirBoxes.some(
          (t) =>
            t.maxLat >= hb.minLat && t.minLat <= hb.maxLat &&
            t.maxLng >= hb.minLng && t.minLng <= hb.maxLng,
        );
      });
      if (holes.length === piece.holes.length) return piece;
      return {
        ring: piece.ring,
        holes,
        areaM2:
          polygonAreaM2(asLatLng(piece.ring)) -
          holes.reduce((sum, h) => sum + polygonAreaM2(asLatLng(h)), 0),
      };
    });
    const heldAfter = pieces.reduce((s, p) => s + p.areaM2, 0);

    // Nothing moved: the hull was already inside ground we hold, and no
    // rival lost anything either. Leave the rows alone rather than
    // rewriting identical geometry.
    // 50m², not MIN_PIECE_M2: this is "did anything change", not "is this
    // a real piece". Ground added onto a patch you already hold is real
    // whether or not it would stand alone, and at a mark every 40m a lot
    // of growth arrives in small increments.
    if (victims.size === 0 && heldAfter - heldBefore < 50) {
      return { gainedM2: 0, victims, changed: false };
    }

    if (mine.length) {
      await tx.delete(schema.territoryGround).where(
        inArray(
          schema.territoryGround.id,
          mine.map((r) => r.id),
        ),
      );
    }
    for (const piece of pieces) {
      await tx.insert(schema.territoryGround).values({
        id: nanoid(),
        userId,
        ring: piece.ring,
        holes: piece.holes.length ? piece.holes : null,
        areaM2: piece.areaM2,
        ...bboxOf(piece.ring),
      });
    }

    return { gainedM2: Math.max(0, heldAfter - heldBefore), victims, changed: true };
  });
}

// Total ground per owner, for the standing. A SUM over a column, which is
// the whole reason area is stored: the board used to rebuild every hull in
// the city to answer it.
export async function groundTotals(): Promise<{ userId: string; areaM2: number }[]> {
  const rows = await db
    .select({
      userId: schema.territoryGround.userId,
      areaM2: sql<number>`sum(${schema.territoryGround.areaM2})`,
    })
    .from(schema.territoryGround)
    .where(ne(schema.territoryGround.userId, ''))
    .groupBy(schema.territoryGround.userId);
  return rows.map((r) => ({ userId: r.userId, areaM2: Number(r.areaM2) }));
}

export async function clearGround(userId: string): Promise<void> {
  await db.delete(schema.territoryGround).where(eq(schema.territoryGround.userId, userId));
}
