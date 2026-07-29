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
