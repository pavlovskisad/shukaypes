// Territory marking — the dog claims ground as you walk.
//
// The whole mechanic hangs off one hook: /collect/path already gives the
// server a movement-verified position every ~15s (it owns the previous
// anchor in Redis and rejects teleports), so that's where we ask "should
// the dog mark here?". No new client trust surface — a tampered client
// can't claim ground it didn't walk to any more than it can farm paws.
//
// The dog decides on its own. The human's levers are indirect: walk
// somewhere worth marking, and keep the dog fed and happy enough to
// bother. Refusals are deliberately silent (the dog just doesn't) except
// for the mood ones, which the caller can voice.
//
// STRENGTH + DECAY
// ----------------
// A cell's stored `strength` is its value at `lastMarkedAt`. The live
// value subtracts decayPerDay for elapsed time, so:
//   - one mark  (40) fades to neutral in ~1.5 days
//   - a core marked repeatedly (100) holds ~4 days
// Edges therefore go soft before cores do, which is where we want the
// fighting to happen once slice 2 turns stealing on. Nothing decays on a
// schedule — an untouched cell costs nothing until someone looks at it.

import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { balance } from '../config/balance.js';
import { distanceMeters, type LatLng } from '../utils/geo.js';
import { cellsWithinRadius } from '../utils/territoryGrid.js';

const T = balance.territory;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface TerritoryCell {
  cellId: string;
  lat: number;
  lng: number;
  // Live strength (decay already applied), 1-100.
  strength: number;
  mine: boolean;
}

export interface MarkResult {
  marked: boolean;
  // Why the dog passed, for the caller's bubble. 'cooldown' / 'too-close'
  // are the boring ones (stay silent); 'hungry' / 'grumpy' are worth
  // voicing occasionally.
  reason?: 'cooldown' | 'too-close' | 'hungry' | 'grumpy' | 'no-state';
  position?: LatLng;
  // Cells claimed by this mark (already live-strength).
  cells?: number;
}

// Live strength for a row, given when it was last marked.
function liveStrength(strength: number, lastMarkedAt: Date, now: number): number {
  const days = (now - lastMarkedAt.getTime()) / DAY_MS;
  return strength - days * T.decayPerDay;
}

// Add `amount` strength to a set of cells for one owner. Shared by both
// tiers of claim — a mark (strong, discrete) and a trail (weak,
// continuous) differ only in radius and amount.
//
// The upsert folds decay in rather than reading first: a cell you already
// own keeps whatever strength it has left after time has eaten at it,
// then this claim stacks on top (capped), and the clock resets. Doing it
// in SQL keeps the whole thing one round-trip per cell and race-free
// against a concurrent sync from the same user.
async function claimCells(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  cells: { id: string; lat: number; lng: number }[],
  amount: number,
  at: Date,
): Promise<void> {
  for (const cell of cells) {
    await tx
      .insert(schema.territoryCells)
      .values({
        cellId: cell.id,
        ownerId: userId,
        lat: cell.lat,
        lng: cell.lng,
        strength: amount,
        lastMarkedAt: at,
        markCount: 1,
      })
      .onConflictDoUpdate({
        target: schema.territoryCells.cellId,
        set: {
          strength: sql`LEAST(${T.maxStrength}, GREATEST(0,
            ${schema.territoryCells.strength}
              - EXTRACT(EPOCH FROM (${at.toISOString()}::timestamptz - ${schema.territoryCells.lastMarkedAt}))
                / 86400.0 * ${T.decayPerDay}
          )::int + ${amount})`,
          lastMarkedAt: at,
          markCount: sql`${schema.territoryCells.markCount} + 1`,
        },
        // Only the owner refreshes their own cell for now. Someone else's
        // ground is untouchable until stealing lands in slice 2.
        setWhere: eq(schema.territoryCells.ownerId, userId),
      });
  }
}

// Lay the weak trail claim along a walked segment. Marks are discrete, so
// without this the map is a string of disconnected islands — this is the
// string. Sampled along the line at a fraction of the trail radius so the
// covered cells form a continuous ribbon with no gaps at walking speed;
// deduped because consecutive samples overlap heavily.
export async function claimTrail(
  userId: string,
  from: LatLng,
  to: LatLng,
): Promise<void> {
  const segLen = distanceMeters(from, to);
  if (segLen < 5) return;
  const steps = Math.min(24, Math.max(1, Math.ceil(segLen / (T.trailRadiusM * 0.8))));
  const seen = new Map<string, { id: string; lat: number; lng: number }>();
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const lat = from.lat + (to.lat - from.lat) * f;
    const lng = from.lng + (to.lng - from.lng) * f;
    for (const c of cellsWithinRadius(lat, lng, T.trailRadiusM)) {
      if (!seen.has(c.id)) seen.set(c.id, c);
    }
  }
  if (seen.size === 0) return;
  const at = new Date();
  await db.transaction(async (tx) => {
    await claimCells(tx, userId, [...seen.values()], T.trailStrength, at);
  });
}

// Should the dog mark here, and if so, claim the ground.
//
// Called from /collect/path with a position the server has already
// validated as reachable. Returns what happened so the route can tell the
// client (which turns it into a bubble + a fresh territory pull).
export async function markIfDue(
  userId: string,
  pos: LatLng,
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

  const cells = cellsWithinRadius(pos.lat, pos.lng, T.radiusM);
  if (cells.length === 0) return { marked: false, reason: 'too-close' };

  const markedAt = new Date(now);
  await db.transaction(async (tx) => {
    await claimCells(tx, userId, cells, T.strengthPerMark, markedAt);

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

  return { marked: true, position: pos, cells: cells.length };
}

// Claimed cells around a point, for the map. Slice 1 returns only the
// caller's own ground — other people's turf stays invisible until you're
// standing in it (slice 2). Cells that have decayed to nothing are
// filtered out here rather than deleted, so a walk back through old
// ground can still revive them.
export async function fetchTerritoryNear(
  userId: string,
  pos: LatLng,
  radiusM = T.fetchRadiusM,
): Promise<TerritoryCell[]> {
  const dLat = radiusM / 110540;
  const dLng =
    radiusM / (111320 * Math.max(0.05, Math.cos((pos.lat * Math.PI) / 180)));

  const rows = await db
    .select({
      cellId: schema.territoryCells.cellId,
      lat: schema.territoryCells.lat,
      lng: schema.territoryCells.lng,
      strength: schema.territoryCells.strength,
      lastMarkedAt: schema.territoryCells.lastMarkedAt,
      ownerId: schema.territoryCells.ownerId,
    })
    .from(schema.territoryCells)
    .where(
      and(
        eq(schema.territoryCells.ownerId, userId),
        gte(schema.territoryCells.lat, pos.lat - dLat),
        lte(schema.territoryCells.lat, pos.lat + dLat),
        gte(schema.territoryCells.lng, pos.lng - dLng),
        lte(schema.territoryCells.lng, pos.lng + dLng),
      ),
    )
    .limit(T.maxCellsPerFetch);

  const now = Date.now();
  const out: TerritoryCell[] = [];
  for (const r of rows) {
    const live = liveStrength(r.strength, r.lastMarkedAt, now);
    if (live <= 0) continue;
    out.push({
      cellId: r.cellId,
      lat: r.lat,
      lng: r.lng,
      strength: Math.round(Math.min(T.maxStrength, live)),
      mine: r.ownerId === userId,
    });
  }
  return out;
}

// Total live cell count for a user — the number behind "your range".
// Cheap enough to run per profile view; the decay filter is done in SQL so
// a long-lapsed player doesn't drag thousands of dead rows into node.
export async function countLiveCells(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.territoryCells)
    .where(
      and(
        eq(schema.territoryCells.ownerId, userId),
        sql`${schema.territoryCells.strength}
          - EXTRACT(EPOCH FROM (now() - ${schema.territoryCells.lastMarkedAt})) / 86400.0 * ${T.decayPerDay} > 0`,
      ),
    );
  return row?.n ?? 0;
}
