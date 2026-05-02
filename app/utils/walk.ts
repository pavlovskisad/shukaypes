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

// Perpendicular nudge for the roundtrip return leg. The via-point is
// pushed offsetM perpendicular to the origin→dest midpoint; Google
// Directions then has to route via different streets to reach it. The
// previous 0.3 / 400m bounds were too gentle — on a 500m leg the
// nudge was only 150m, well within one Kyiv block, so Google often
// picked the same streets back. Bumped to 0.5 / 800m so the loop is
// visibly distinct: a 500m leg now nudges 250m (most of a block over),
// and a 1500m leg nudges the full 750m. Adds ~25-30% to total walk
// distance vs straight out-and-back, but the user gets a real loop.
const RETURN_NUDGE_FRACTION = 0.5;
const RETURN_NUDGE_MAX_M = 800;

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

// Variety knobs — combat "tap walk → same destination every time".
//   - We track the last RECENT_LIMIT destinations in localStorage and
//     add a score penalty so they sink in the rank. After RECENT_LIMIT
//     different walks the oldest cycles back in.
//   - "Quality band" sampling: any candidate within QUALITY_BAND
//     score of the best is treated as comparable and picked
//     uniformly. "Best" is subjective when there are several decent
//     parks / cafés in range, so a fixed top-1 weighting always
//     pinned the same destination; uniform-within-band lets the user
//     discover the city instead of relived loop.
const RECENT_LIMIT = 3;
const RECENT_PENALTY_PER_RANK = 2.0;
const TOP_K = 6;
const QUALITY_BAND = 1.5;
const RECENT_STORAGE_KEY = 'shukajpes.walks.recent.v1';

function loadRecentIds(): string[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

// Drop the existing entry for this id (so re-picking it pushes it to
// the top instead of accumulating duplicates), prepend, truncate.
export function recordRecentDestination(id: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const prev = loadRecentIds().filter((x) => x !== id);
    const next = [id, ...prev].slice(0, RECENT_LIMIT);
    window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // storage full / disabled — variety still works for this session
    // via the in-process pickFromTopK; just no cross-tap memory.
  }
}

// Same recent-penalty mechanism applied to the radial visit submenu —
// "Companion → visit → cafe → 3 closest" used to surface the same 3
// names every time. With this, the picker scores spots by distance +
// recent-visit penalty and random-samples 3 from the top of the
// score-sorted list, so consecutive visits to the same category cycle
// through different names.
const RECENT_VISIT_LIMIT = 4;
const RECENT_VISIT_PENALTY_PER_RANK_M = 400;
const VISIT_TOP_K = 8;
const RECENT_VISIT_STORAGE_KEY = 'shukajpes.visits.recent.v1';

function loadRecentVisitIds(): string[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(RECENT_VISIT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, RECENT_VISIT_LIMIT) : [];
  } catch {
    return [];
  }
}

export function recordRecentVisit(id: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const prev = loadRecentVisitIds().filter((x) => x !== id);
    const next = [id, ...prev].slice(0, RECENT_VISIT_LIMIT);
    window.localStorage.setItem(RECENT_VISIT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // storage off — in-session variety via the random sample still works.
  }
}

interface VisitCandidate {
  id: string;
  position: LatLng;
}

// Distance (meters) + per-rank recent penalty. Closer = better; recent
// picks get pushed by RECENT_VISIT_PENALTY_PER_RANK_M per rank so a
// 200m-away spot you visited yesterday sinks below a 500m-away one
// you've never been to.
function visitScore<T extends VisitCandidate>(
  c: T,
  origin: LatLng,
  recentIds: string[],
): number {
  const distM = distanceMeters(origin, c.position);
  const recentIdx = recentIds.indexOf(c.id);
  const penalty =
    recentIdx >= 0
      ? (RECENT_VISIT_LIMIT - recentIdx) * RECENT_VISIT_PENALTY_PER_RANK_M
      : 0;
  return distM + penalty;
}

// Score the candidate pool, take the top VISIT_TOP_K, randomly sample
// `count` of them without replacement. Stable per call — caller should
// memoise with appropriate deps so the sample doesn't re-roll on every
// parent render.
export function pickVisitCandidates<T extends VisitCandidate>(
  candidates: T[],
  origin: LatLng,
  count: number,
): T[] {
  if (candidates.length === 0) return [];
  const recentIds = loadRecentVisitIds();
  const scored = candidates
    .map((c) => ({ c, s: visitScore(c, origin, recentIds) }))
    .sort((a, b) => a.s - b.s)
    .slice(0, VISIT_TOP_K);
  // Fisher-Yates shuffle of the top-K then slice — uniform random
  // sample without replacement, no recency bias inside the sample.
  for (let i = scored.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = scored[i]!;
    scored[i] = scored[j]!;
    scored[j] = tmp;
  }
  return scored.slice(0, count).map((x) => x.c);
}

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

function score(
  candidate: WalkCandidate,
  distM: number,
  targetM: number,
  recentIds: string[],
): number {
  const distErr = Math.abs(distM - targetM) / targetM; // 0 perfect, 1 100% off
  const distScore = distErr * distErr * 10;
  const ratingScore = -(candidate.rating ?? 3) * 0.4;
  const catBias = WALK_CATEGORY_BIAS[candidate.category] ?? 1;
  // Recent picks sink. recentIdx 0 = most recent (heaviest penalty);
  // entries past RECENT_LIMIT are absent. The penalty is large enough
  // to push a recent #1 out of TOP_K when other candidates are within
  // ~RECENT_PENALTY_PER_RANK score of it.
  const recentIdx = recentIds.indexOf(candidate.id);
  const recentPenalty =
    recentIdx >= 0 ? (RECENT_LIMIT - recentIdx) * RECENT_PENALTY_PER_RANK : 0;
  return distScore + ratingScore + catBias + recentPenalty;
}

function pickFromQualityBand(
  scored: { c: WalkCandidate; s: number }[],
): WalkCandidate | null {
  if (scored.length === 0) return null;
  // "Best" is subjective when several parks/cafés are roughly
  // comparable. Take everyone within QUALITY_BAND of the leader,
  // capped at TOP_K so a flat city block doesn't put every nearby
  // spot on the ballot. Then pick uniformly — democratic, no
  // ranked-bias toward whichever scored a hair higher.
  const best = scored[0]!.s;
  const band = scored
    .filter((x) => x.s - best <= QUALITY_BAND)
    .slice(0, TOP_K);
  if (band.length === 1) return band[0]!.c;
  const idx = Math.floor(Math.random() * band.length);
  return band[idx]!.c;
}

function pickBest(
  candidates: WalkCandidate[],
  origin: LatLng,
  targetM: number,
): WalkCandidate | null {
  if (candidates.length === 0) return null;
  const recentIds = loadRecentIds();
  const scored = candidates
    .map((c) => ({ c, d: distanceMeters(origin, c.position) }))
    .map((x) => ({ ...x, s: score(x.c, x.d, targetM, recentIds) }));
  // Prefer the band; widen if empty.
  const band = scored.filter(({ d }) => Math.abs(d - targetM) <= SPOT_BUCKET_M);
  const pool = band.length ? band : scored;
  pool.sort((a, b) => a.s - b.s);
  return pickFromQualityBand(pool);
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

