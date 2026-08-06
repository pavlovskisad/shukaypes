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
import { pointInPolygon, type Pt } from '../utils/territoryShapes.js';
// The geometry itself lives next door so a worker thread can import it
// without dragging the database in. See groundGeometry.ts for why.
import { asLatLng, bboxOf, toPieces } from './groundGeometry.js';
import { planClaimInWorker } from './groundWorker.js';

const T = balance.territory;

// One piece of held ground: an outer ring and any pockets inside it.
export interface GroundPiece {
  id: string;
  userId: string;
  ring: Pt[];
  holes: Pt[][];
  areaM2: number;
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

    // THE GEOMETRY RUNS SOMEWHERE ELSE.
    //
    // Everything between here and the writes below used to happen inline
    // on this thread, and on 2026-08-05 it stopped coming back: a claim
    // ran away inside polygon-clipping and the server spent eleven hours
    // pinned against its CPU throttle, unable to answer a health check or
    // write a log line, because the loop that would have done either was
    // queued behind the one that never ended.
    //
    // A worker can be terminated mid-instruction. That is the whole
    // reason for the hop. See groundWorker.ts.
    //
    // The locks and the transaction are still held across it, which is
    // deliberate: the rows were read FOR UPDATE and the plan is only
    // valid against exactly those rows. The worker's own timeout bounds
    // how long that can last.
    const plan = await planClaimInWorker({
      claim,
      mine: mine.map((r) => ({ id: r.id, ring: r.ring, holes: r.holes, areaM2: r.areaM2 })),
      theirs,
    });

    // No plan means the geometry never finished — timed out, crashed, or
    // the worker would not start. Treat it exactly like a claim that
    // decided to do nothing: no cut, no growth, no half-applied map. The
    // dog marked and the ground did not move.
    if (!plan || plan.kind === 'noop') return empty;

    // APPLY. Ordinary writes from here down — every decision was made in
    // the worker, and this is the transcription.
    const victims = new Map<string, number>();
    for (const v of plan.victims) {
      victims.set(v.userId, (victims.get(v.userId) ?? 0) + v.lostM2);
      await tx.delete(schema.territoryGround).where(eq(schema.territoryGround.id, v.id));
      for (const piece of v.left) {
        await tx.insert(schema.territoryGround).values({
          id: nanoid(),
          userId: v.userId,
          ring: piece.ring,
          holes: piece.holes.length ? piece.holes : null,
          areaM2: piece.areaM2,
          ...bboxOf(piece.ring),
        });
      }
    }

    // Rivals were cut, but the claimant takes nothing — the uncut rule, or
    // a clipper that refused the merge. Their loss stands; our gain does
    // not.
    if (plan.kind === 'cut-only') {
      return { gainedM2: 0, victims, changed: victims.size > 0 };
    }

    if (mine.length) {
      await tx.delete(schema.territoryGround).where(
        inArray(
          schema.territoryGround.id,
          mine.map((r) => r.id),
        ),
      );
    }
    for (const piece of plan.pieces) {
      await tx.insert(schema.territoryGround).values({
        id: nanoid(),
        userId,
        ring: piece.ring,
        holes: piece.holes.length ? piece.holes : null,
        areaM2: piece.areaM2,
        ...bboxOf(piece.ring),
      });
    }

    return { gainedM2: plan.gainedM2, victims, changed: true };
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

// How many owners hold strictly more ground than this one, and how much
// this one holds. rank = that count + 1.
//
// Counted rather than looked up in the top ten, because a player outside
// it still wants a number: "you are 47th" is a position in a city, while
// a dash is being told you do not register. One GROUP BY over a stored
// column, which is the same shape as the board itself.
export async function groundStanding(
  userId: string,
): Promise<{ areaM2: number; rank: number }> {
  const rows = await db
    .select({
      userId: schema.territoryGround.userId,
      areaM2: sql<number>`sum(${schema.territoryGround.areaM2})`,
    })
    .from(schema.territoryGround)
    .groupBy(schema.territoryGround.userId);

  let mine = 0;
  for (const r of rows) if (r.userId === userId) mine = Number(r.areaM2);
  // Ties share the better rank, the way a scoreboard reads: two owners on
  // the same area are both "5th", and the next one down is 7th.
  const ahead = rows.filter((r) => Number(r.areaM2) > mine).length;
  return { areaM2: mine, rank: ahead + 1 };
}

export async function clearGround(userId: string): Promise<void> {
  await db.delete(schema.territoryGround).where(eq(schema.territoryGround.userId, userId));
}
