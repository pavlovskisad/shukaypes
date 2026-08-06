// The geometry of a claim, with no database anywhere in it.
//
// This file exists because of an eleven-hour outage. A claim ran away
// inside polygon-clipping and never came back: CPU pegged at 100%, then
// throttled to the machine's 6.2% baseline and spinning flat out against
// it for eleven hours. The process stayed alive the whole time — memory
// flat at 26%, nothing killed, nothing logged. It simply never yielded
// the event loop again, so no health check could be answered and no log
// line could be written.
//
// One dog's claim took down the game for everyone, because this work is
// synchronous and there is only one thread to do it on.
//
// So the geometry moved here: pure, importable by a worker thread, and
// therefore killable. `planClaim` decides what a claim does to the map
// and returns it as a plan. Applying that plan — the deletes and the
// inserts — stays in ground.ts on the main thread, inside the same
// transaction and the same advisory locks as before. Nothing about the
// rules changed; only where they run.
//
// Keep this file free of imports that touch the database, the config
// singleton, or anything else that assumes it is on the main thread.

import polygonClipping from 'polygon-clipping';
import { polygonAreaM2, type Pt } from '../utils/territoryShapes.js';

export type Poly = Pt[][]; // [outer, ...holes]

export const toPoly = (p: { ring: Pt[]; holes: Pt[][] | null }): Poly => [p.ring, ...(p.holes ?? [])];
export const asLatLng = (ring: Pt[]) => ring.map(([lng, lat]) => ({ lat: lat!, lng: lng! }));

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

export function simplifyRing(ring: Pt[]): Pt[] {
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

export interface Piece {
  ring: Pt[];
  holes: Pt[][];
  areaM2: number;
}

// A clipper result (MultiPolygon) back into storable pieces.
//
// Returns the slivers as well as the keepers, because a sliver is ground
// and has to end up SOMEWHERE. Dropping it on the floor is what put the
// white shards on the map.
export function toPieces(result: Pt[][][]): { kept: Piece[]; slivers: Piece[] } {
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

export function bboxOf(ring: Pt[]) {
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
// THE PLAN
//
// Everything below is what used to sit inline in claimGround, in the same
// order, with the same rules and the same reasons. The only change is that
// it now decides rather than writes: instead of issuing a delete and an
// insert as it goes, it records what should happen and hands that back.

/** A victim's piece after the claim cut it. */
export interface VictimRewrite {
  id: string;
  userId: string;
  /** What is left of their piece. Empty means the claim swallowed it whole. */
  left: Piece[];
  /** Area that changed hands. */
  lostM2: number;
}

export interface ClaimPlanInput {
  claim: Pt[];
  /** Ground the claimant already holds inside the claim's box. */
  mine: { id: string; ring: Pt[]; holes: Pt[][] | null; areaM2: number }[];
  /** Everyone else's, same box. */
  theirs: { id: string; userId: string; ring: Pt[]; holes: Pt[][] | null; areaM2: number }[];
}

export type ClaimPlan =
  /** The claim does nothing at all — too small to hold ground, or refused. */
  | { kind: 'noop' }
  /** Rivals were cut but the claimant takes nothing (see the uncut rule). */
  | { kind: 'cut-only'; victims: VictimRewrite[] }
  /** The full move: rivals cut, and the claimant's ground rewritten. */
  | {
      kind: 'claim';
      victims: VictimRewrite[];
      /** Replaces every row in `mine`. */
      pieces: Piece[];
      gainedM2: number;
    };

export function planClaim(input: ClaimPlanInput): ClaimPlan {
  const { claim, mine, theirs } = input;
  if (claim.length < 3) return { kind: 'noop' };
  let claimPoly: Poly[] = [[claim]];
  const heldBefore = mine.reduce((s, r) => s + r.areaM2, 0);

  // CAN THIS CLAIM HOLD GROUND AT ALL? Asked BEFORE anything is cut.
  //
  // A claim smaller than MIN_PIECE_M2 that touches none of the claimant's
  // own ground cannot be stored — toPieces drops it. Cutting first and
  // discovering that afterwards meant a claim too small to hold ground
  // could still destroy it: the victim's piece was carved, the claimant's
  // own piece was dropped for being a sliver, and the ground ended up
  // belonging to NOBODY. Reproduced end to end — a dog walked a small
  // triangle inside a rival's block and the block came back owner null.
  let dryRun: Pt[][][];
  try {
    dryRun = polygonClipping.union(
      claimPoly as never,
      ...(mine.map((r) => [toPoly(r)]) as never[]),
    ) as Pt[][][];
  } catch {
    return { kind: 'noop' };
  }
  if (toPieces(dryRun).kept.reduce((s, p) => s + p.areaM2, 0) - heldBefore < 50) {
    return { kind: 'noop' };
  }

  // CUT, now that we know the claim is real.
  const victims: VictimRewrite[] = [];
  // Ground somebody else holds that we could not cut. We must not take it
  // either — see below.
  const uncut: Poly[] = [];
  // Fragments of a victim's ground too small to stand on their own. Folded
  // into the claim below rather than dropped: they used to be discarded,
  // which showed on the map as white shards along every contested border —
  // ground that had an owner a moment ago and now had none. Handing them to
  // whoever cut them down conserves the ground and closes the seam.
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
    const lostM2 = row.areaM2 - left.reduce((s, p) => s + p.areaM2, 0);
    absorbed.push(...slivers.map((p) => [p.ring, ...p.holes] as Poly));
    // A metre, not MIN_PIECE_M2: skipping here leaves the victim's ring
    // exactly as it was, so anything skipped is ground BOTH of us hold. A
    // square metre of that is rounding; two hundred is a doorway.
    if (lostM2 <= 1) continue;
    victims.push({ id: row.id, userId: row.userId, left, lostM2 });
  }

  // NEVER TAKE WHAT WE COULD NOT CUT.
  //
  // If the clipper refused a victim's ring, their ground stands — and the
  // claim has to give up that piece too, or both of us hold it. The catch
  // above used to be the whole story, and it is how two owners ended up
  // ninety metres deep in the same block on prod: one throw deep inside
  // polygon-clipping, silently swallowed, and the claimant grew over
  // ground the victim never gave up.
  if (uncut.length) {
    try {
      claimPoly = polygonClipping.difference(
        claimPoly as never,
        ...(uncut as never[]),
      ) as unknown as Poly[];
    } catch {
      return { kind: 'cut-only', victims };
    }
    if (claimPoly.length === 0) return { kind: 'cut-only', victims };
  }

  // GROW: fold the claim, anything absorbed from a victim, and everything
  // of ours it touches into one shape — so a walk that joins two of your
  // own patches leaves one piece, not two overlapping ones.
  let merged: Pt[][][];
  try {
    merged = polygonClipping.union(
      claimPoly as never,
      ...(absorbed.map((p) => [p]) as never[]),
      ...(mine.map((r) => [toPoly(r)]) as never[]),
    ) as Pt[][][];
  } catch {
    return { kind: 'cut-only', victims };
  }

  // Close the pockets too small to mean anything. Everything bigger stays
  // open, because a hole in the middle of a block is the map telling you
  // nobody walked through the middle.
  //
  // Never a pocket a rival might hold: a hole whose box touches any
  // neighbour's piece is left exactly alone, since closing it would be
  // taking their ground without a claim. The bbox test is deliberately
  // conservative that way — a false "keep" is a small gap, a false "fill"
  // is two owners on one block.
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

  // Nothing moved: the hull was already inside ground we hold, and no rival
  // lost anything either. Leave the rows alone rather than rewriting
  // identical geometry. 50m², not MIN_PIECE_M2 — this is "did anything
  // change", not "is this a real piece", and at a mark every 40m a lot of
  // growth arrives in small increments.
  if (victims.length === 0 && heldAfter - heldBefore < 50) return { kind: 'noop' };

  return { kind: 'claim', victims, pieces, gainedM2: Math.max(0, heldAfter - heldBefore) };
}
