// Territory grid — the cell math behind scent marking.
//
// WHY A GRID
// ----------
// A mark is a soft blob of scent, but ownership has to be unambiguous:
// two dogs can't half-own the same patch of pavement. So the visual and
// the logic are deliberately separated — the client renders marks as a
// soft heat glow, while the server resolves ownership on a fixed grid of
// ~110 m cells. Every mark claims the handful of cells whose centre falls
// inside its radius, and a cell has exactly one owner.
//
// The grid is a plain lat/lng quantisation rather than H3 so the server
// carries no extra dependency and a cell id decodes to a centre with
// arithmetic alone (no lookup tables, no client-side library to render
// with).
//
// Cells stay roughly square anywhere on earth: the latitude step is
// constant, and the longitude step widens with the cosine of the cell's
// own latitude BAND (derived from latIdx, so it's deterministic — the
// same point always lands in the same cell, and cells tile without gaps).

// Cell edge in metres. ~110 m pairs with MARK_RADIUS_M below so one mark
// claims a chunky blob of 1-5 cells — big enough to read as a claim when
// zoomed out to district level, small enough that a walk carves a
// recognisable ribbon rather than swallowing a neighbourhood.
export const CELL_M = 110;

const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LNG_EQ = 111320;

export const LAT_STEP = CELL_M / M_PER_DEG_LAT;

// Longitude step for a latitude band. Clamped near the poles so the step
// can't blow up to infinity (irrelevant for Kyiv, but keeps the maths
// total).
function lngStepForBand(latIdx: number): number {
  const bandLat = (latIdx + 0.5) * LAT_STEP;
  const cos = Math.max(0.05, Math.cos((bandLat * Math.PI) / 180));
  return CELL_M / (M_PER_DEG_LNG_EQ * cos);
}

export interface Cell {
  id: string;
  lat: number; // centre
  lng: number; // centre
}

// "latIdx.lngIdx" — compact, sortable, and decodable without a lookup.
export function cellIdAt(lat: number, lng: number): string {
  const latIdx = Math.floor(lat / LAT_STEP);
  const lngIdx = Math.floor(lng / lngStepForBand(latIdx));
  return `${latIdx}.${lngIdx}`;
}

export function cellCentre(id: string): { lat: number; lng: number } | null {
  const dot = id.indexOf('.');
  if (dot < 0) return null;
  const latIdx = Number(id.slice(0, dot));
  const lngIdx = Number(id.slice(dot + 1));
  if (!Number.isFinite(latIdx) || !Number.isFinite(lngIdx)) return null;
  return {
    lat: (latIdx + 0.5) * LAT_STEP,
    lng: (lngIdx + 0.5) * lngStepForBand(latIdx),
  };
}

// Every cell whose CENTRE lies within `radiusM` of the point. Centre-based
// (rather than any-overlap) so a mark on a cell boundary doesn't quietly
// claim twice the area it looks like it should.
export function cellsWithinRadius(
  lat: number,
  lng: number,
  radiusM: number,
): Cell[] {
  const latIdx0 = Math.floor(lat / LAT_STEP);
  const span = Math.ceil(radiusM / CELL_M) + 1;
  const out: Cell[] = [];
  for (let dLat = -span; dLat <= span; dLat++) {
    const latIdx = latIdx0 + dLat;
    const lngStep = lngStepForBand(latIdx);
    const lngIdx0 = Math.floor(lng / lngStep);
    const cLat = (latIdx + 0.5) * LAT_STEP;
    for (let dLng = -span; dLng <= span; dLng++) {
      const lngIdx = lngIdx0 + dLng;
      const cLng = (lngIdx + 0.5) * lngStep;
      // Flat-earth metres are plenty accurate at this scale.
      const dy = (cLat - lat) * M_PER_DEG_LAT;
      const dx =
        (cLng - lng) *
        M_PER_DEG_LNG_EQ *
        Math.cos((lat * Math.PI) / 180);
      if (dx * dx + dy * dy <= radiusM * radiusM) {
        out.push({ id: `${latIdx}.${lngIdx}`, lat: cLat, lng: cLng });
      }
    }
  }
  return out;
}

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

// Every cell whose centre falls INSIDE a closed ring of lat/lng points.
// Used by the enclosure claim: walk a loop and the ground it encircles
// becomes yours, not just the path you trod.
//
// Ray casting on the raw lat/lng plane — at city scale the projection
// distortion is far below one cell, so there's nothing to gain from
// projecting first. Bounded by `maxCells` because the caller can't know
// in advance how big a loop someone walked.
export function cellsInsideRing(
  ring: { lat: number; lng: number }[],
  maxCells: number,
): Cell[] {
  if (ring.length < 3) return [];
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of ring) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  const out: Cell[] = [];
  const latIdxMin = Math.floor(minLat / LAT_STEP);
  const latIdxMax = Math.floor(maxLat / LAT_STEP);
  for (let latIdx = latIdxMin; latIdx <= latIdxMax; latIdx++) {
    const lngStep = lngStepForBand(latIdx);
    const cLat = (latIdx + 0.5) * LAT_STEP;
    const lngIdxMin = Math.floor(minLng / lngStep);
    const lngIdxMax = Math.floor(maxLng / lngStep);
    for (let lngIdx = lngIdxMin; lngIdx <= lngIdxMax; lngIdx++) {
      const cLng = (lngIdx + 0.5) * lngStep;
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i]!;
        const b = ring[j]!;
        if (
          a.lat > cLat !== b.lat > cLat &&
          cLng < ((b.lng - a.lng) * (cLat - a.lat)) / (b.lat - a.lat) + a.lng
        ) {
          inside = !inside;
        }
      }
      if (inside) {
        out.push({ id: `${latIdx}.${lngIdx}`, lat: cLat, lng: cLng });
        if (out.length >= maxCells) return out;
      }
    }
  }
  return out;
}

// Are these two cells edge- or corner-adjacent? Used by the connected-range
// walk (slice 3's bonuses scale with the largest connected region, and an
// island is worth less than the mainland).
export function areNeighbours(a: string, b: string): boolean {
  const da = a.indexOf('.');
  const db = b.indexOf('.');
  if (da < 0 || db < 0) return false;
  const dLat = Math.abs(Number(a.slice(0, da)) - Number(b.slice(0, db)));
  const dLng = Math.abs(Number(a.slice(da + 1)) - Number(b.slice(db + 1)));
  return dLat <= 1 && dLng <= 1 && dLat + dLng > 0;
}
