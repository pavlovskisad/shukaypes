// Turning a walk into a small exploration.
//
// A planned walk used to be a line from where you stand to one nice
// place — a park, a café — and nothing in between. The kyiv_lore table
// already holds ~a thousand geo-indexed landmarks with a sentence of
// story each, but only the long-press "sniff this place" gesture ever
// read them, so a walk passed a dozen of them in silence.
//
// This module picks the ones a given walk actually goes past and turns
// them into STOPS: points the route is re-plotted through, in the order
// you meet them, each carrying the story the dog tells when you get
// there.
//
// The geometry is deliberately done against the STRAIGHT-LINE plan, not
// the final street polyline, because the stops have to be chosen BEFORE
// the route is fetched — they are inputs to it. A landmark 100 m off the
// straight line is at most a couple of hundred metres of real walking
// off the street route, which the detour cap below measures exactly
// rather than assuming.
//
// Everything here is pure: no db, no clock, no randomness. routes/lore.ts
// supplies the pool, loreWalk.check.ts pins the behaviour.

import { distanceMeters, type LatLng } from '../utils/geo.js';

// One row of kyiv_lore, as the route handler selects it.
export interface LorePoint {
  id: string;
  name: string;
  category: string;
  story: string;
  wikipediaTitle: string | null;
  sourceLang: string | null;
  lat: number;
  lng: number;
}

// A landmark the walk will pass through, with where along the walk it
// falls so the client can order commentary and label the markers.
export interface LoreStop {
  id: string;
  name: string;
  category: string;
  story: string;
  wikipediaTitle: string | null;
  sourceLang: string | null;
  position: LatLng;
  // Distance from the start of the walk, along the planned line, to the
  // point where this stop is nearest. Monotonically increasing across
  // the returned array — that IS the visiting order.
  alongM: number;
  // How far the landmark sits off the planned line. Small by
  // construction (<= corridorM); surfaced because the client shows the
  // detour honestly rather than pretending the stop was on the way.
  offRouteM: number;
}

export interface StopPlanOptions {
  // The planned walk as straight segments, starting at the walker.
  // One-way is [origin, destination]; a roundtrip is
  // [origin, destination, via, origin].
  path: LatLng[];
  pool: LorePoint[];
  // How far off the line a landmark may sit and still count as "on the
  // way".
  corridorM: number;
  maxStops: number;
  // Minimum gap along the walk between two stops, so three plaques on
  // one square don't eat the whole allowance.
  minSpacingM: number;
  // Total extra walking the stops may add, measured against the same
  // straight-line plan. The walk was asked for at a distance; stops are
  // not allowed to quietly double it.
  maxDetourM: number;
  // Don't put a stop right under the walker's feet at the start, or
  // stacked on the destination pin at the end.
  headroomStartM?: number;
  headroomEndM?: number;
  // How close a landmark may come to a CORNER of the walk — the
  // destination, or a roundtrip's via-point — before it stops counting
  // as somewhere you pass on the way.
  vertexClearanceM?: number;
}

const DEFAULT_HEADROOM_START_M = 120;
const DEFAULT_HEADROOM_END_M = 120;

// A landmark this close to a corner of the walk IS that corner.
//
// The end headroom only catches the last stretch of the path, which on a
// ONE-WAY walk is the destination — but a roundtrip's destination sits
// in the MIDDLE of its path (origin → dest → via → origin), so the
// headroom sails straight past it. Result, seen on a real Troieshchyna
// walk: the destination came back as its own first stop, and the walker
// was told to go and see the place they were already going to.
//
// 100 m rather than something tighter because these two points are
// picked independently — the planner's destination comes from
// kyiv_gazetteer or Places, the stop from kyiv_lore — so the same church
// is two rows with two coordinates tens of metres apart.
const DEFAULT_VERTEX_CLEARANCE_M = 100;

// A landmark with a Wikipedia handle can be expanded in-app for the
// walker who wants more than the dog's one sentence. Worth this much
// off its off-route cost when two candidates compete for the same slot
// — i.e. we'll walk up to 80 m further for the one with a "read more".
const WIKI_BONUS_M = 80;

// Planar working frame. Kyiv walks are a few km across, so a local
// equirectangular projection in metres is exact enough for corridor
// geometry (sub-metre over this scale) and far cheaper than haversining
// every pool point against every segment. Real distances that get
// REPORTED to the caller still go through distanceMeters.
interface Frame {
  lat0: number;
  mPerLat: number;
  mPerLng: number;
}

interface XY {
  x: number;
  y: number;
}

function frameFor(path: LatLng[]): Frame {
  const lat0 = path[0]!.lat;
  return {
    lat0,
    mPerLat: 111_320,
    mPerLng: 111_320 * Math.cos((lat0 * Math.PI) / 180),
  };
}

function toXY(p: LatLng, f: Frame): XY {
  return { x: p.lng * f.mPerLng, y: p.lat * f.mPerLat };
}

// Where a point falls on the path: which segment it is nearest, how far
// along the whole path that lands, and how far off to the side it sits.
interface Projection {
  alongM: number;
  offM: number;
  segIndex: number;
}

function projectOntoPath(p: LatLng, path: LatLng[], f: Frame): Projection | null {
  if (path.length < 2) return null;
  const q = toXY(p, f);
  const verts = path.map((v) => toXY(v, f));
  let cum = 0;
  let best: Projection | null = null;
  for (let i = 0; i < verts.length - 1; i++) {
    const a = verts[i]!;
    const b = verts[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    const segLen = Math.sqrt(lenSq);
    // Degenerate segment (a repeated waypoint) — nothing projects onto
    // it that the neighbouring segments don't already cover.
    if (lenSq === 0) continue;
    let t = ((q.x - a.x) * dx + (q.y - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + t * dx;
    const cy = a.y + t * dy;
    const offM = Math.hypot(q.x - cx, q.y - cy);
    if (!best || offM < best.offM) {
      best = { alongM: cum + t * segLen, offM, segIndex: i };
    }
    cum += segLen;
  }
  return best;
}

export function pathLengthM(path: LatLng[]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    total += distanceMeters(path[i]!, path[i + 1]!);
  }
  return total;
}

// Rebuild the walk so it goes THROUGH the stops: the original corners
// (destination, roundtrip via-point, the way home) stay put, and each
// stop is spliced in at the position its alongM gives it. The result is
// what gets handed to the directions API — origin excluded, because
// that call takes it separately.
export function waypointsThrough(path: LatLng[], stops: LoreStop[]): LatLng[] {
  const f = frameFor(path);
  const verts = path.map((v) => toXY(v, f));
  // alongM of each original vertex, so stops can be merged into the
  // same ordering the vertices already sit in.
  const vertAlong: number[] = [0];
  for (let i = 0; i < verts.length - 1; i++) {
    const a = verts[i]!;
    const b = verts[i + 1]!;
    vertAlong.push(vertAlong[i]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const merged: Array<{ alongM: number; point: LatLng; isVertex: boolean }> = [];
  for (let i = 0; i < path.length; i++) {
    merged.push({ alongM: vertAlong[i]!, point: path[i]!, isVertex: true });
  }
  for (const s of stops) {
    merged.push({ alongM: s.alongM, point: s.position, isVertex: false });
  }
  // Stable by alongM, and on a tie the original vertex wins the earlier
  // slot — a stop that projects exactly onto the destination belongs
  // after it, not before.
  merged.sort((a, b) => a.alongM - b.alongM || Number(b.isVertex) - Number(a.isVertex));
  // Drop the origin: fetchWalkingRoute(origin, waypoints) takes it as a
  // separate argument.
  return merged.slice(1).map((m) => m.point);
}

interface Scored {
  point: LorePoint;
  proj: Projection;
  cost: number;
}

function toStop(s: Scored): LoreStop {
  return {
    id: s.point.id,
    name: s.point.name,
    category: s.point.category,
    story: s.point.story,
    wikipediaTitle: s.point.wikipediaTitle,
    sourceLang: s.point.sourceLang,
    position: { lat: s.point.lat, lng: s.point.lng },
    alongM: Math.round(s.proj.alongM),
    offRouteM: Math.round(s.proj.offM),
  };
}

// Pick the landmarks a walk should be re-plotted through.
//
// Shape of the choice, in order:
//   1. Keep only what sits inside the corridor, and clear of the two
//      ends (a "stop" you are already standing on is not a stop).
//   2. Cut the walk into maxStops equal stretches and take the best
//      candidate in each. Spreading by POSITION rather than taking the
//      maxStops closest-to-the-line is the whole difference between a
//      walk that unfolds and a walk with three plaques in its first
//      block — the dense old centre would win every slot otherwise.
//   3. Enforce spacing, then trim until the added walking fits the
//      detour budget.
export function planStops(opts: StopPlanOptions): LoreStop[] {
  const {
    path,
    pool,
    corridorM,
    maxStops,
    minSpacingM,
    maxDetourM,
    headroomStartM = DEFAULT_HEADROOM_START_M,
    headroomEndM = DEFAULT_HEADROOM_END_M,
    vertexClearanceM = DEFAULT_VERTEX_CLEARANCE_M,
  } = opts;
  if (path.length < 2 || pool.length === 0 || maxStops <= 0) return [];

  const f = frameFor(path);
  const totalM = pathLengthM(path);
  const from = headroomStartM;
  const to = totalM - headroomEndM;
  // A walk shorter than its own headroom has no middle to put stops in.
  if (to <= from) return [];

  const scored: Scored[] = [];
  for (const point of pool) {
    const here = { lat: point.lat, lng: point.lng };
    const proj = projectOntoPath(here, path, f);
    if (!proj) continue;
    if (proj.offM > corridorM) continue;
    if (proj.alongM < from || proj.alongM > to) continue;
    // Sitting on a corner of the walk — that's the destination (or the
    // turn), not somewhere passed on the way to it.
    if (path.some((v) => distanceMeters(v, here) < vertexClearanceM)) continue;
    scored.push({
      point,
      proj,
      cost: proj.offM - (point.wikipediaTitle ? WIKI_BONUS_M : 0),
    });
  }
  if (scored.length === 0) return [];

  // One slot per equal stretch of the walk, best candidate in each.
  const span = to - from;
  const bucketM = span / maxStops;
  const chosen: Scored[] = [];
  for (let b = 0; b < maxStops; b++) {
    const lo = from + b * bucketM;
    const hi = b === maxStops - 1 ? to : lo + bucketM;
    let best: Scored | null = null;
    for (const s of scored) {
      if (s.proj.alongM < lo || s.proj.alongM >= hi) continue;
      if (!best || s.cost < best.cost) best = s;
    }
    if (best) chosen.push(best);
  }
  chosen.sort((a, b) => a.proj.alongM - b.proj.alongM);

  // Spacing. Buckets already spread the picks, but a stop at the very
  // end of one bucket and one at the very start of the next can still
  // land on the same corner.
  const spaced: Scored[] = [];
  for (const s of chosen) {
    const prev = spaced[spaced.length - 1];
    if (!prev) {
      spaced.push(s);
      continue;
    }
    if (s.proj.alongM - prev.proj.alongM >= minSpacingM) {
      spaced.push(s);
      continue;
    }
    // Too close to the one before — keep whichever is the better stop
    // rather than whichever happened to come first.
    if (s.cost < prev.cost) spaced[spaced.length - 1] = s;
  }

  // Detour budget. Splicing stops into the line lengthens it; measure
  // by how much and drop the most expensive stop until it fits. The
  // straight-line delta understates the street-network delta somewhat,
  // which is why the budget is a fraction of the walk rather than a
  // hard promise.
  let kept = spaced;
  while (kept.length > 0) {
    const withStops = [path[0]!, ...waypointsThrough(path, kept.map(toStop))];
    const added = pathLengthM(withStops) - totalM;
    if (added <= maxDetourM) break;
    // Drop the one buying the least: highest off-route cost.
    let worstIdx = 0;
    for (let i = 1; i < kept.length; i++) {
      if (kept[i]!.proj.offM > kept[worstIdx]!.proj.offM) worstIdx = i;
    }
    kept = kept.filter((_, i) => i !== worstIdx);
  }

  return kept.map(toStop);
}
