// Territory marking — the dog claims ground as you walk.
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
// decay, unlike a per-cell strength nobody could see, and it gives
// marking inside your own ground a purpose: it doesn't expand the shape,
// it renews it.

import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, schema } from '../db/index.js';
import { balance } from '../config/balance.js';
import { distanceMeters, type LatLng } from '../utils/geo.js';
import { convexHull, clusterPoints } from '../utils/territoryShapes.js';

const T = balance.territory;
const DAY_MS = 24 * 60 * 60 * 1000;

// Marks older than this stop counting toward shapes.
function liveSince(): Date {
  return new Date(Date.now() - T.markTtlDays * DAY_MS);
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
}

export interface TerritoryShape {
  kind: 'area' | 'line';
  points: { lat: number; lng: number }[];
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

// Should the dog mark here, and if so, record it.
//
// Called from /collect/path with a position the server has already
// validated as reachable — and with the COMPANION's position, since it's
// the dog that marks, not the walker.
export async function markIfDue(userId: string, pos: LatLng): Promise<MarkResult> {
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

  // Is this the mark that first gives its cluster area? Only used for the
  // bubble and a slightly larger dot — the shape itself is always derived
  // fresh from the marks, never stored.
  const prior = await liveMarks(userId);
  const cluster =
    clusterPoints([...prior.map((m) => ({ lat: m.lat, lng: m.lng })), pos], T.shapeLinkM).find(
      (c) => c.some((p) => p.lat === pos.lat && p.lng === pos.lng),
    ) ?? [];
  const firstArea = cluster.length === T.shapeMinMarks;

  const markedAt = new Date(now);
  await db.transaction(async (tx) => {
    await tx.insert(schema.territoryMarks).values({
      id: nanoid(),
      userId,
      lat: pos.lat,
      lng: pos.lng,
      closedLoop: firstArea,
      createdAt: markedAt,
    });
    // Marking costs a little effort and pays back a little joy — the wire
    // between territory and the bones/paws economy.
    await tx
      .update(schema.companionState)
      .set({
        hunger: sql`GREATEST(${balance.hunger.min}, ${schema.companionState.hunger} - ${T.hungerCost})`,
        happiness: sql`LEAST(${balance.happiness.max}, ${schema.companionState.happiness} + ${T.happinessGain})`,
        lastMarkAt: markedAt,
        lastMarkLat: pos.lat,
        lastMarkLng: pos.lng,
      })
      .where(eq(schema.companionState.userId, userId));
  });

  return { marked: true, position: pos, ...(firstArea ? { enclosed: true } : {}) };
}

// The shapes a user's live marks make. Three or more near each other
// enclose an area; exactly two are a bare link with no ground; one is
// just a dot.
export async function fetchShapes(userId: string): Promise<TerritoryShape[]> {
  const marks = await liveMarks(userId);
  if (marks.length === 0) return [];
  const out: TerritoryShape[] = [];
  for (const cluster of clusterPoints(
    marks.map((m) => ({ lat: m.lat, lng: m.lng })),
    T.shapeLinkM,
  )) {
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

// The dots to draw. Each carries its age so the client can fade it out
// shortly after it lands and leave the shape behind.
export async function fetchMarks(
  userId: string,
): Promise<{ lat: number; lng: number; closedLoop: boolean; at: string }[]> {
  const rows = await liveMarks(userId);
  return rows.map((r) => ({
    lat: r.lat,
    lng: r.lng,
    closedLoop: r.closedLoop,
    at: r.at.toISOString(),
  }));
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
