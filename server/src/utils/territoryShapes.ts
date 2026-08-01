// Territory geometry — the shape a cluster of marks encloses.
//
// A territory is the convex hull of a group of nearby marks. There is no
// grid and no per-cell ownership: an earlier design resolved ownership on
// ~110m cells alongside these shapes, and the two diverged the moment
// they existed together (cells were claimed by a blob around each mark
// and by a trail along everywhere the user walked, none of it drawn).
// Marks are the only truth now, and these two functions are the whole of
// the geometry.

// Convex hull of a set of points (Andrew's monotone chain), returned
// counter-clockwise and closed-open (no repeated first point).
//
// This is the shape a cluster of marks encloses. The alternative —
// joining each new mark to its two nearest — is what a person naturally
// describes, but it folds over itself once marks get dense, producing
// self-intersecting polygons that fill wrongly. For any real walking
// pattern the hull is the same shape without those failure modes.
//
// Degenerate input (fewer than 3 points, or all collinear) returns the
// input's extremes, which encloses no area — correct: two marks are a
// line, and a line owns nothing.
// How willing the boundary is to cut inward. 2 is concaveman's own
// default and reads as "follow the shape but don't chase every stray dot";
// 1 hugs so tightly that a normal street of marks turns into a zigzag.
import concaveman from 'concaveman';

const CONCAVITY = 2;

export function convexHull<T extends { lat: number; lng: number }>(
  points: T[],
): { lat: number; lng: number }[] {
  if (points.length < 3) return points.map((p) => ({ lat: p.lat, lng: p.lng }));
  const pts = points
    .map((p) => ({ lat: p.lat, lng: p.lng }))
    .sort((a, b) => (a.lng === b.lng ? a.lat - b.lat : a.lng - b.lng));
  // Cross product of OA × OB. >0 = counter-clockwise turn.
  const cross = (
    o: { lat: number; lng: number },
    a: { lat: number; lng: number },
    b: { lat: number; lng: number },
  ): number =>
    (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
  const build = (src: typeof pts): typeof pts => {
    const out: typeof pts = [];
    for (const p of src) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, p) <= 0) {
        out.pop();
      }
      out.push(p);
    }
    out.pop(); // last point is the first of the other half
    return out;
  };
  const lower = build(pts);
  const upper = build([...pts].reverse());
  return [...lower, ...upper];
}

// Group points into clusters, where a point joins a cluster if it's
// within `linkM` of ANY point already in it (single-linkage). This is what
// keeps a mark left across town from being pulled into the shape you're
// building here — it starts its own island instead.
export function clusterPoints<T extends { lat: number; lng: number }>(
  points: T[],
  linkM: number,
): T[][] {
  const unvisited = new Set(points.keys());
  const clusters: T[][] = [];
  const near = (a: T, b: T): boolean => {
    // Flat-earth metres; exact enough at these distances.
    const dy = (a.lat - b.lat) * 110540;
    const dx =
      (a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180);
    return dx * dx + dy * dy <= linkM * linkM;
  };
  for (const start of points.keys()) {
    if (!unvisited.has(start)) continue;
    unvisited.delete(start);
    const cluster: T[] = [points[start]!];
    const queue = [start];
    while (queue.length) {
      const cur = points[queue.pop()!]!;
      for (const idx of [...unvisited]) {
        if (near(cur, points[idx]!)) {
          unvisited.delete(idx);
          cluster.push(points[idx]!);
          queue.push(idx);
        }
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}


// Area of a closed ring, in square metres.
//
// Shoelace in a local equirectangular projection: lat/lng are converted
// to metres against the ring's own mean latitude, so the longitude
// squeeze is right for where the shape actually is rather than for the
// equator. Over a city block that's exact to well under a percent, which
// is far tighter than a number rendered as "0.4 km²" needs.
//
// Returns 0 for anything with fewer than three points — a line owns no
// ground, which is the same thing the shapes say.
export function polygonAreaM2(ring: { lat: number; lng: number }[]): number {
  if (ring.length < 3) return 0;
  const meanLat = ring.reduce((s, p) => s + p.lat, 0) / ring.length;
  const mPerLng = 111_320 * Math.cos((meanLat * Math.PI) / 180);
  let acc = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]!.lng * mPerLng;
    const yi = ring[i]!.lat * 110_540;
    const xj = ring[j]!.lng * mPerLng;
    const yj = ring[j]!.lat * 110_540;
    acc += xj * yi - xi * yj;
  }
  return Math.abs(acc) / 2;
}

// Is the point inside the ring? Standard even-odd ray cast, in raw
// degrees — the projection cancels out of an inside/outside test, so
// there's no need to convert.
//
// Boundary cases are deliberately not special-cased: a point exactly on
// an edge can land either way, and callers here are asking "is the dog
// standing on our ground", where a metre of ambiguity at the edge means
// nothing.
export function pointInPolygon(
  p: { lat: number; lng: number },
  ring: { lat: number; lng: number }[],
): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i]!.lat;
    const xi = ring[i]!.lng;
    const yj = ring[j]!.lat;
    const xj = ring[j]!.lng;
    if (yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// ---------------------------------------------------------------------------
// PARTITION — ground belongs to whoever's mark is nearest.
//
// Each owner CLAIMS the hull of their marks grown outward by a fixed reach,
// then keeps whatever part of that claim their marks are nearest to. Two
// things fall out of it. Claims overlap, so neighbouring ranges meet along
// the bisector between their marks instead of leaving a strip of nobody's
// ground between two hulls — a border reads as a line, not a gap. And an
// uncontested loop still fills completely, while a rival patch inside it
// becomes a pocket in their own colour. No point on the map is ever owned
// twice.
//
// Everything below works in local metres rather than degrees: the clipper
// assumes a flat plane, and metre-scale coordinates keep it away from the
// precision trouble that raw lat/lng (six significant digits of which are
// constant across a city) would give it.

export type Pt = [number, number];

export interface Projection {
  to: (p: { lat: number; lng: number }) => Pt;
  from: (p: Pt) => { lat: number; lng: number };
}

// Equirectangular projection anchored at a reference point. Offsets are
// relative to the anchor so coordinates stay small near the area of interest.
export function localProjection(ref: { lat: number; lng: number }): Projection {
  const mPerLat = 110_540;
  const mPerLng = 111_320 * Math.cos((ref.lat * Math.PI) / 180);
  return {
    to: (p) => [(p.lng - ref.lng) * mPerLng, (p.lat - ref.lat) * mPerLat],
    from: ([x, y]) => ({ lat: ref.lat + y / mPerLat, lng: ref.lng + x / mPerLng }),
  };
}

// Sutherland-Hodgman: keep the part of a CONVEX polygon where ax·x + ay·y <= c.
// Convexity matters — on a concave polygon this quietly joins separated pieces
// with a spurious edge. Every caller here passes a hull or something already
// cut from one, which is convex by construction.
export function clipHalfPlane(poly: Pt[], ax: number, ay: number, c: number): Pt[] {
  const n = poly.length;
  if (n === 0) return poly;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const cur = poly[i]!;
    const prev = poly[(i + n - 1) % n]!;
    const dCur = ax * cur[0] + ay * cur[1] - c;
    const dPrev = ax * prev[0] + ay * prev[1] - c;
    if (dCur <= 0 !== dPrev <= 0) {
      const t = dPrev / (dPrev - dCur);
      out.push([prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])]);
    }
    if (dCur <= 0) out.push(cur);
  }
  return out;
}

// The part of `within` where `site` is closer than every one of `others` —
// i.e. site's Voronoi cell, bounded by the polygon it's cut from.
//
// The bisector of s and o is where |p-s|² = |p-o|². Writing d = o-s and
// m = (o+s)/2, that reduces to d·(p-m) = 0, so each of `others` contributes
// one half-plane and the cell is the polygon clipped by all of them. The
// midpoint form is used rather than the algebraically identical
// 2p·(o-s) = |o|²-|s|² because the latter subtracts two large squared
// coordinates and loses precision exactly where the two marks are close —
// which is the case that matters.
//
// `tieWins` decides who gets ground that is EXACTLY equidistant, which
// happens when two owners hold a mark at the same spot. Both callers must
// pass opposite answers for the same pair, or the tied ground is taken
// from both of them and ends up belonging to nobody.
export function voronoiCellWithin(
  within: Pt[],
  site: Pt,
  others: Pt[],
  tieWins = false,
): Pt[] {
  let poly = within;
  for (const o of others) {
    const dx = o[0] - site[0];
    const dy = o[1] - site[1];
    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) {
      // Same spot: no bisector exists, so the tie-break is the whole
      // answer. Either this constraint says nothing, or it says no.
      if (tieWins) continue;
      return [];
    }
    poly = clipHalfPlane(
      poly,
      dx,
      dy,
      (dx * (o[0] + site[0]) + dy * (o[1] + site[1])) / 2,
    );
    if (poly.length < 3) return [];
  }
  return poly;
}

// Keep the part of `poly` that lies inside the CONVEX polygon `convex` —
// Sutherland-Hodgman once per edge. Used to confine one owner's claim to
// where it actually meets another's, so the partition only ever hands
// ground from one of them to the other and never to nobody.
export function clipToConvex(poly: Pt[], convex: Pt[]): Pt[] {
  if (convex.length < 3) return [];
  // Don't trust the winding — a reversed ring would clip away everything
  // instead of everything-but.
  let area = 0;
  for (let i = 0, j = convex.length - 1; i < convex.length; j = i++) {
    area += convex[j]![0] * convex[i]![1] - convex[i]![0] * convex[j]![1];
  }
  const ring = area < 0 ? [...convex].reverse() : convex;

  let out = poly;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j]!;
    const b = ring[i]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    // Interior of a counter-clockwise ring is left of each directed edge.
    out = clipHalfPlane(out, dy, -dx, dy * a[0] - dx * a[1]);
    if (out.length < 3) return [];
  }
  return out;
}

// Grow a CONVEX ring outward by `padM` metres, staying convex.
//
// This is what lets two neighbouring ranges actually meet. A claim used to
// stop dead at the hull of its own marks, so unless two owners' hulls
// happened to overlap there was a strip between them belonging to nobody —
// a no-man's-land that made a border look like a gap rather than a line.
// Grown claims overlap, the partition splits the overlap along the
// bisector, and what's left is a shared edge.
//
// Minkowski sum with a disc, approximated: replace every vertex with a
// ring of points at `padM` and re-hull. Convexity is preserved, which
// matters because every clipper here (clipHalfPlane, clipToConvex,
// clipToConvex) quietly assumes it.
export function bufferConvex(ring: Pt[], padM: number, steps = 10): Pt[] {
  if (ring.length < 3 || padM <= 0) return ring;
  const pts: Pt[] = [];
  for (const [x, y] of ring) {
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      pts.push([x + padM * Math.cos(a), y + padM * Math.sin(a)]);
    }
  }
  // convexHull works on {lat,lng}; the projected plane is just another
  // pair of axes, so map through it rather than duplicating the algorithm.
  return convexHull(pts.map(([x, y]) => ({ lat: y, lng: x }))).map(
    (p) => [p.lng, p.lat] as Pt,
  );
}

// The polygon that actually follows where the dog went.
//
// A convex hull is the wrong shape for a walk. Walk an L and it fills the
// corner; walk out and back by another street and it claims every block
// between. Measured on live territories, 9% of hull edges ran past 400m
// against a 140m minimum spacing between marks — up to 679m — and every one
// of those is the boundary jumping a gap rather than tracing a route. That
// is what makes a single new mark appear to hand over ground nowhere near
// it: the mark joins a cluster, and the hull spanning that cluster swallows
// everything in between.
//
// concaveman rather than something hand-rolled here, deliberately. Two
// attempts at the greedy dig-in algorithm both produced SELF-INTERSECTING
// rings on real input — 60 of 300 random mark sets on the first, 141 on the
// second after relaxing the crossing test to cope with marks lying exactly
// along a street. A folded ring has no meaningful area and breaks the
// clipper the partition runs on, so it would have corrupted territories
// rather than merely drawn them oddly. This is a solved problem with sharp
// edges around collinear and duplicate points, and it belongs in a library
// that has already met them.
//
// `concavity` is a ratio, not a distance: the algorithm will not cut in
// along an edge unless doing so is worth it relative to the local point
// spacing. lengthThreshold is the hard floor in metres — edges shorter than
// this are left alone regardless.
export function concaveHull<T extends { lat: number; lng: number }>(
  points: T[],
  maxEdgeM: number,
): { lat: number; lng: number }[] {
  const hull = convexHull(points);
  if (hull.length < 3) return hull;

  const proj = localProjection(points[0]!);
  // Deduplicate: repeated marks at one spot are degenerate input for any
  // hull algorithm, and the dog does revisit its own corners.
  const seen = new Set<string>();
  const xy: [number, number][] = [];
  for (const p of points) {
    const k = `${p.lat.toFixed(7)},${p.lng.toFixed(7)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const [x, y] = proj.to(p);
    xy.push([x, y]);
  }
  if (xy.length < 4) return hull;

  let ring: number[][];
  try {
    ring = concaveman(xy, CONCAVITY, maxEdgeM);
  } catch {
    // Never let a hull failure lose someone's territory — the convex
    // version is too generous, which is visible and survivable, where
    // returning nothing is a zone that silently vanishes.
    return hull;
  }
  // concaveman repeats the first point at the end; our rings are implicit.
  if (
    ring.length > 3 &&
    ring[0]![0] === ring[ring.length - 1]![0] &&
    ring[0]![1] === ring[ring.length - 1]![1]
  ) {
    ring = ring.slice(0, -1);
  }
  if (ring.length < 3) return hull;
  return ring.map((r) => proj.from([r[0]!, r[1]!]));
}
