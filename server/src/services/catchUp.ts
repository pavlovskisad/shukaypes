// WHAT THE DOG MISSED WHILE THE PHONE WAS IN A POCKET.
//
// Pure geometry and arithmetic — no database, no Redis, no clock of its
// own. Everything here is decided from a segment (where the last fix
// was, where this one is), the time between them, and the territory
// cadence. Fixture-checked by `pnpm check:catch-up`.
//
// The two jobs:
//
//   judgeSegment  — is this displacement something a person walked?
//   planCatchUpMarks — if so, where and when would the dog have marked?
//
// See balance.walk for why the test is speed rather than distance.

import { balance } from '../config/balance.js';
import { distanceMeters, type LatLng } from '../utils/geo.js';

const T = balance.territory;
const W = balance.walk;

export type SegmentVerdict =
  // Below the jitter floor: the foreground case. Sweeps and marks
  // exactly as it always did, and never carries catch-up marks.
  | { ok: true; kind: 'short'; speedMps: number }
  // Long, and covered at a pace a person walks. The gap is real and
  // the ground between the endpoints was crossed on foot.
  | { ok: true; kind: 'walked'; speedMps: number }
  // Long and too fast to be a walk — a car, a jammed fix that slipped
  // the bbox test, a tampered client. Claims nothing.
  //
  // `stale` is the other shape of the same refusal, and the one a speed
  // test alone misses: the walker was gone longer than a walk lasts, so
  // whatever happened in between, this endpoint pair is not evidence of
  // it. A commute reads as SLOW, not fast, and would otherwise pass.
  | { ok: false; reason: 'too-fast' | 'too-long' | 'stale'; speedMps: number };

/**
 * Was this segment walked?
 *
 * `elapsedMs` is how long the walker was out of contact, and it is
 * tested twice: once as a ceiling of its own (`maxGapMs` — a gap longer
 * than a walk is not a gap IN a walk) and once as the denominator of
 * the pace. A zero or negative elapsed (clock skew, a replayed anchor)
 * reads as infinite speed, which fails the gate for anything above the
 * floor — the safe direction, since a segment we cannot time is one we
 * cannot trust.
 */
export function judgeSegment(
  segLenM: number,
  elapsedMs: number,
  maxSegmentM: number,
): SegmentVerdict {
  const speedMps = elapsedMs > 0 ? segLenM / (elapsedMs / 1000) : Infinity;

  // THE CLOCK BOUND COMES FIRST, and unlike the speed test it applies to
  // short segments too. A stale anchor is stale whatever the
  // displacement: somebody who reopens the app after nine hours fifty
  // metres from where they were has not walked fifty metres, they have
  // been somewhere else and come back. Refusing costs them one mark on
  // the first sync — the next one, fifteen seconds later, works off a
  // fresh anchor and behaves normally.
  if (elapsedMs > W.maxGapMs) return { ok: false, reason: 'stale', speedMps };

  // The floor next, so a foreground sync is never judged on speed. GPS
  // jitter of a few tens of metres between two 15s ticks reads as a
  // sprint, and refusing it would cost a standing walker their paws for
  // no gain.
  if (segLenM <= W.jitterFloorM) return { ok: true, kind: 'short', speedMps };

  // Absolute backstop, kept from the distance-gate era: whatever the
  // clock says, a segment this long inside one sync is not a walk we
  // want to reason about.
  if (segLenM > maxSegmentM) return { ok: false, reason: 'too-long', speedMps };

  if (speedMps > W.maxSpeedMps) return { ok: false, reason: 'too-fast', speedMps };

  return { ok: true, kind: 'walked', speedMps };
}

export interface PlannedMark {
  pos: LatLng;
  /** Epoch ms. Backdated to when the dog would have stopped here. */
  at: number;
}

/**
 * The marks a walked segment earns, oldest first.
 *
 * Both of the live mechanic's gates decide the count, so nothing new is
 * invented here — a catch-up walk claims exactly what the same walk
 * would have claimed with the screen on, and never more:
 *
 *   by the clock    — one mark per territory.cooldownMs of gap
 *   by the ground   — one mark per territory.minDistanceM of displacement
 *
 * Both counts drop one below their ceiling so the SPACING between the
 * marks this returns still clears each gate: n marks laid between two
 * endpoints leave n+1 gaps, and it is the gaps that markIfDue measures.
 * Capped by balance.walk.maxCatchUpMarks, which is a cost bound.
 *
 * Positions are a straight line between the endpoints. That is not the
 * street the walker took, and it is deliberately not: snapping to a
 * route would assert one specific path out of several, where the line
 * only asserts the displacement — which is the part we can prove. It
 * also errs the safe way. Walk a loop around one block and the
 * endpoints sit close together, so the plan is short and under-claims;
 * walk A to B and the line is what you walked.
 */
export function planCatchUpMarks(
  from: LatLng,
  to: LatLng,
  startedAtMs: number,
  elapsedMs: number,
): PlannedMark[] {
  const segLenM = distanceMeters(from, to);
  if (segLenM <= W.jitterFloorM || elapsedMs <= 0) return [];
  // Redundant with judgeSegment, which every caller runs first — kept so
  // this function cannot draw a line across a commute on its own if a
  // later caller forgets the gate.
  if (elapsedMs > W.maxGapMs) return [];

  const byClock = Math.floor(elapsedMs / T.cooldownMs) - 1;
  const byGround = Math.floor(segLenM / T.minDistanceM) - 1;
  const n = Math.min(byClock, byGround, W.maxCatchUpMarks);
  if (n < 1) return [];

  const out: PlannedMark[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    out.push({
      pos: {
        lat: from.lat + (to.lat - from.lat) * t,
        lng: from.lng + (to.lng - from.lng) * t,
      },
      at: Math.round(startedAtMs + elapsedMs * t),
    });
  }
  return out;
}
