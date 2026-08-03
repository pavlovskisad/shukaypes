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

import { and, eq, gte, lte, ne, inArray, sql } from 'drizzle-orm';
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

// Below this a piece is a sliver from the clipper, not ground: the width of
// a doorway, the seam where two shapes touched. Nobody can see it and
// nobody can walk it.
const MIN_PIECE_M2 = 200;

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

// A clipper result (MultiPolygon) back into storable pieces, slivers gone.
function toPieces(result: Pt[][][]): { ring: Pt[]; holes: Pt[][]; areaM2: number }[] {
  const out: { ring: Pt[]; holes: Pt[][]; areaM2: number }[] = [];
  for (const poly of result) {
    const [outer, ...holes] = poly;
    if (!outer || outer.length < 3) continue;
    const ring = simplifyRing(outer);
    if (ring.length < 3) continue;
    const keptHoles = holes
      .map(simplifyRing)
      .filter((h) => h.length >= 3 && polygonAreaM2(asLatLng(h)) >= MIN_PIECE_M2);
    const areaM2 =
      polygonAreaM2(asLatLng(ring)) -
      keptHoles.reduce((s, h) => s + polygonAreaM2(asLatLng(h)), 0);
    if (areaM2 < MIN_PIECE_M2) continue;
    out.push({ ring, holes: keptHoles, areaM2 });
  }
  return out;
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

// Claim the ground under a hull.
//
// Runs in ONE transaction: two dogs marking the same block at the same
// moment would otherwise both read the old rings and the second write would
// silently restore what the first one cut.
export async function claimGround(userId: string, hull: LatLng[]): Promise<ClaimResult> {
  const empty: ClaimResult = { gainedM2: 0, victims: new Map(), changed: false };
  if (hull.length < 3) return empty;

  const claim: Pt[] = hull.map((p) => [p.lng, p.lat]);
  const box = bboxOf(claim);
  const claimPoly: Poly[] = [[claim]];

  return db.transaction(async (tx) => {
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
      .for('update')
      .limit(T.groundPiecesPerClaim);

    const mine = rows.filter((r) => r.userId === userId);
    const theirs = rows.filter((r) => r.userId !== userId);

    // CUT FIRST, so what we measure as gained is what actually changed
    // hands rather than ground we already held.
    const victims = new Map<string, number>();
    for (const row of theirs) {
      let cut: Pt[][][];
      try {
        cut = polygonClipping.difference([toPoly(row)] as never, claimPoly as never) as Pt[][][];
      } catch {
        // A ring the clipper won't accept keeps its ground. Losing a piece
        // to a numerical hiccup is worse than a border that stays put.
        continue;
      }
      const left = toPieces(cut);
      const lost = row.areaM2 - left.reduce((s, p) => s + p.areaM2, 0);
      if (lost <= MIN_PIECE_M2) continue;
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

    // GROW: fold the claim into everything of ours it touches, so a walk
    // that joins two of your own patches leaves one piece, not two
    // overlapping ones.
    const heldBefore = mine.reduce((s, r) => s + r.areaM2, 0);
    let merged: Pt[][][];
    try {
      merged = polygonClipping.union(
        claimPoly as never,
        ...(mine.map((r) => [toPoly(r)]) as never[]),
      ) as Pt[][][];
    } catch {
      return { gainedM2: 0, victims, changed: victims.size > 0 };
    }
    const pieces = toPieces(merged);
    const heldAfter = pieces.reduce((s, p) => s + p.areaM2, 0);

    // Nothing moved: the hull was already inside ground we hold, and no
    // rival lost anything either. Leave the rows alone rather than
    // rewriting identical geometry.
    if (victims.size === 0 && heldAfter - heldBefore < MIN_PIECE_M2) {
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
