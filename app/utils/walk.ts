// Walk planner — picks ONE destination from the spots + parks pools
// and produces the polyline waypoints + a nice human label.
//
// Design goals:
// - One-way walks should land somewhere "nice for a walk", with parks
//   strongly preferred over errand-y categories (vet, pet shop).
// - Roundtrips go to a single destination but return via a different
//   street, not retracing. We accomplish this by inserting a synthetic
//   via-point offset perpendicular to the outbound bearing midpoint —
//   Google Directions then routes the second leg via different streets
//   to hit that nudge point. User gets one tap → unique loop home.

import type { LatLng } from '@shukajpes/shared';
import { distanceMeters } from './geo';
import type { Spot, Park } from '../services/places';

export type WalkShape = 'oneway' | 'roundtrip';
export type WalkDistance = 'close' | 'far';

// Total walk distance budgets. For one-way that's the trip length;
// for roundtrip it's out + back combined, so each leg targets half.
export const WALK_CLOSE_M = 1000;
export const WALK_FAR_M = 3000;

// How tightly we filter candidates around the target distance before
// falling back to a wider search. Bigger band = more candidates,
// looser distance fit; smaller = pickier. 500m at urban density gives
// ~3-8 candidates for "close" walks and lets the score break ties.
const SPOT_BUCKET_M = 500;

// Perpendicular nudge for the roundtrip return leg. Larger offset =
// more pronounced loop (less overlap with outbound) but adds distance
// to the total walk. We use min(MAX, legDist × FRACTION) so short
// walks get a small nudge and long walks get a sensible cap.
const RETURN_NUDGE_FRACTION = 0.3;
const RETURN_NUDGE_MAX_M = 400;

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
  // one-way: [destination]. For roundtrip: [destination, via, origin]
  // where `via` is a synthetic perpendicular nudge that pushes the
  // return leg onto different streets.
  waypoints: LatLng[];
  primary: WalkCandidate;
  // True when we managed to inject a perpendicular nudge — the
  // typical case for roundtrips. False on degenerate routes (zero-
  // length outbound, etc), which fall back to plain out-and-back.
  hasReturnDetour: boolean;
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

// Compute a synthetic via-point offset perpendicular to the
// origin→dest line, at `offsetM` from the midpoint. Picking the
// "right-hand" side of the outbound bearing is arbitrary but
// deterministic — Google Directions then has to route via different
// streets to hit it, so the return leg differs from the outbound.
// Flat-earth math is fine here (walks are <5km).
function perpendicularVia(origin: LatLng, dest: LatLng, offsetM: number): LatLng {
  const midLat = (origin.lat + dest.lat) / 2;
  const midLng = (origin.lng + dest.lng) / 2;
  const latMPerDeg = 111_000;
  const lngMPerDeg = 111_000 * Math.cos((midLat * Math.PI) / 180);
  const dxM = (dest.lng - origin.lng) * lngMPerDeg;
  const dyM = (dest.lat - origin.lat) * latMPerDeg;
  const length = Math.sqrt(dxM * dxM + dyM * dyM);
  if (length === 0) return { lat: midLat, lng: midLng };
  // Unit perpendicular, rotated 90° clockwise (x, y) → (y, -x).
  const px = dyM / length;
  const py = -dxM / length;
  return {
    lat: midLat + (py * offsetM) / latMPerDeg,
    lng: midLng + (px * offsetM) / lngMPerDeg,
  };
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
    return { waypoints: [pick.position], primary: pick, hasReturnDetour: false };
  }

  // Roundtrip — pick a destination at half the total budget so out +
  // back ≈ totalTargetM, then push the return through a perpendicular
  // via-point so Google Directions takes different streets back.
  const legM = totalTargetM / 2;
  const dest = pickBest(candidates, origin, legM);
  if (!dest) return null;
  const legDist = distanceMeters(origin, dest.position);
  if (legDist === 0) {
    return { waypoints: [dest.position, origin], primary: dest, hasReturnDetour: false };
  }
  const offsetM = Math.min(RETURN_NUDGE_MAX_M, legDist * RETURN_NUDGE_FRACTION);
  const via = perpendicularVia(origin, dest.position, offsetM);
  return {
    waypoints: [dest.position, via, origin],
    primary: dest,
    hasReturnDetour: true,
  };
}

