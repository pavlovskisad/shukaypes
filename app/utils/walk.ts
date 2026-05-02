// Walk planner — picks 1 or 2 destinations from the spots + parks
// pools and produces the polyline waypoints + a nice human label.
//
// Design goals:
// - One-way walks should land somewhere "nice for a walk", with parks
//   strongly preferred over errand-y categories (vet, pet shop).
// - Roundtrips should be REAL loops (origin → A → B → origin) when
//   we have two well-spaced candidates, instead of out-and-back along
//   the same street. Falls back to out-and-back when no second leg
//   is reasonable (small candidate pool, dense category, etc).

import type { LatLng } from '@shukajpes/shared';
import { distanceMeters } from './geo';
import type { Spot, Park } from '../services/places';

export type WalkShape = 'oneway' | 'roundtrip';
export type WalkDistance = 'close' | 'far';

// Total leg-distance budgets (one-way) / total-loop budgets
// (roundtrip). For roundtrip, each leg targets half this so the total
// matches what the user picked.
export const WALK_CLOSE_M = 1000;
export const WALK_FAR_M = 3000;

// How tightly we filter candidates around the target distance before
// falling back to a wider search. Bigger band = more candidates,
// looser distance fit; smaller = pickier. 500m at urban density gives
// ~3-8 candidates for "close" walks and lets the score break ties.
const SPOT_BUCKET_M = 500;

// Two candidates are "well-spaced" for a real loop when their bearings
// from the origin differ by at least this many degrees. 80° is a soft
// triangle — anything tighter and the two waypoints are close to
// collinear with origin, so the loop visually folds in on itself.
const MIN_LOOP_BEARING_DEG = 80;

// Walk-friendliness bias per category. Lower = more preferred. Park
// is strongly preferred (negative) so it'll outrank an equidistant
// cafe; vet/pet-shop are penalties so they only win when nothing
// nicer is in range.
const WALK_CATEGORY_BIAS: Record<string, number> = {
  park: -2,
  cafe: 0,
  restaurant: 0,
  bar: 0.5,
  pet_store: 1.5,
  veterinary_care: 2.5,
};

export interface WalkCandidate {
  id: string;
  name: string;
  position: LatLng;
  category: string;
  rating?: number;
  // True when this candidate also has a corresponding marker in the
  // spots layer — lets the route renderer keep the destination pin
  // visible even when the spots toggle is off. Parks have no marker.
  isSpot: boolean;
}

export interface WalkPlan {
  // Waypoints in fetchWalkingRoute(origin, waypoints) order. For
  // one-way that's just [destination]; for roundtrip-loop it's
  // [A, B, origin]; for roundtrip-out-and-back it's [destination,
  // origin].
  waypoints: LatLng[];
  primary: WalkCandidate;
  // Set only for real loops — the via-point on the way back.
  secondary: WalkCandidate | null;
  // True when we built a real triangular loop, false for out-and-back
  // fallbacks. Consumed by the bubble label.
  isLoop: boolean;
}

export function buildCandidates(spots: Spot[], parks: Park[]): WalkCandidate[] {
  const fromSpots: WalkCandidate[] = spots.map((s) => ({
    id: s.id,
    name: s.name,
    position: s.position,
    category: s.category,
    rating: s.rating,
    isSpot: true,
  }));
  const fromParks: WalkCandidate[] = parks.map((p) => ({
    id: p.id,
    name: p.name,
    position: p.position,
    category: 'park',
    isSpot: false,
  }));
  return [...fromSpots, ...fromParks];
}

function score(candidate: WalkCandidate, distM: number, targetM: number): number {
  const distErr = Math.abs(distM - targetM) / targetM; // 0 perfect, 1 100% off
  const distScore = distErr * distErr * 10;
  const ratingScore = -(candidate.rating ?? 3) * 0.4;
  const catBias = WALK_CATEGORY_BIAS[candidate.category] ?? 1;
  return distScore + ratingScore + catBias;
}

function pickBest(
  candidates: WalkCandidate[],
  origin: LatLng,
  targetM: number,
): WalkCandidate | null {
  if (candidates.length === 0) return null;
  const scored = candidates
    .map((c) => ({ c, d: distanceMeters(origin, c.position) }))
    .map((x) => ({ ...x, s: score(x.c, x.d, targetM) }));
  // Prefer the band; widen if empty.
  const band = scored.filter(({ d }) => Math.abs(d - targetM) <= SPOT_BUCKET_M);
  const pool = band.length ? band : scored;
  pool.sort((a, b) => a.s - b.s);
  return pool[0]?.c ?? null;
}

function bearingDeg(from: LatLng, to: LatLng): number {
  const dy = to.lat - from.lat;
  const dx = to.lng - from.lng;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

function angularDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

export function planWalk(args: {
  candidates: WalkCandidate[];
  origin: LatLng;
  shape: WalkShape;
  distance: WalkDistance;
}): WalkPlan | null {
  const { candidates, origin, shape, distance } = args;
  if (candidates.length === 0) return null;
  const totalTargetM = distance === 'far' ? WALK_FAR_M : WALK_CLOSE_M;

  if (shape === 'oneway') {
    const pick = pickBest(candidates, origin, totalTargetM);
    if (!pick) return null;
    return { waypoints: [pick.position], primary: pick, secondary: null, isLoop: false };
  }

  // Roundtrip — try a real loop first.
  const legM = totalTargetM / 2;
  const A = pickBest(candidates, origin, legM);
  if (!A) return null;
  const bearA = bearingDeg(origin, A.position);
  const others = candidates.filter((c) => c.id !== A.id);
  const wellSpaced = others.filter(
    (c) => angularDiff(bearingDeg(origin, c.position), bearA) >= MIN_LOOP_BEARING_DEG,
  );
  const B = pickBest(wellSpaced, origin, legM);

  if (B) {
    return {
      waypoints: [A.position, B.position, origin],
      primary: A,
      secondary: B,
      isLoop: true,
    };
  }
  // No good second leg — out-and-back via A.
  return {
    waypoints: [A.position, origin],
    primary: A,
    secondary: null,
    isLoop: false,
  };
}
