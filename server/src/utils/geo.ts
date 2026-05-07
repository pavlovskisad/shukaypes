export interface LatLng {
  lat: number;
  lng: number;
}

const R = 6371000;

// Hand-traced polygon of the Dnipro through the Kyiv pilot area.
// Mirrors the client's RIVER_POLYGON in app/utils/cluster.ts — needs
// to stay in sync. Lat-banded rects (the previous approach) couldn't
// follow the river's bend without leaving wedge-shaped gaps where the
// bands stepped, so the client's pet markers kept rendering in water
// at the seams. Polygon traces both banks; islands (Trukhaniv,
// Hidropark) are intentionally inside the snappable zone.
//
// Tuple is [lat, lng].
const RIVER_POLYGON: ReadonlyArray<readonly [number, number]> = [
  // West bank pulled west — earlier pass left a strip between this
  // edge and the actual Podil/Petrivka bank where jitter offsets
  // were landing in real water without getting snapped.
  [50.620, 30.510],
  [50.580, 30.500],
  [50.555, 30.500],
  [50.530, 30.505],
  [50.510, 30.508],
  [50.495, 30.510],
  [50.480, 30.515],
  [50.470, 30.518],
  [50.460, 30.522],
  [50.450, 30.535],
  [50.440, 30.550],
  [50.430, 30.570],
  [50.420, 30.580],
  [50.405, 30.595],
  [50.385, 30.610],
  [50.360, 30.625],
  [50.290, 30.645],
  [50.290, 30.700],
  [50.360, 30.690],
  [50.385, 30.665],
  [50.405, 30.660],
  [50.420, 30.640],
  [50.435, 30.630],
  [50.450, 30.625],
  [50.465, 30.620],
  [50.480, 30.605],
  [50.495, 30.590],
  [50.510, 30.585],
  [50.530, 30.585],
  [50.555, 30.575],
  [50.580, 30.555],
  [50.620, 30.540],
];

const SNAP_OFFSET_DEG = 0.0008;

function pointInRiverPolygon(lat: number, lng: number): boolean {
  let inside = false;
  const n = RIVER_POLYGON.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [yi, xi] = RIVER_POLYGON[i] as readonly [number, number];
    const [yj, xj] = RIVER_POLYGON[j] as readonly [number, number];
    const intersects =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function projectOntoSegment(
  pLat: number,
  pLng: number,
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): readonly [number, number] {
  const dLat = bLat - aLat;
  const dLng = bLng - aLng;
  const lenSq = dLat * dLat + dLng * dLng;
  if (lenSq === 0) return [aLat, aLng];
  let t = ((pLat - aLat) * dLat + (pLng - aLng) * dLng) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return [aLat + t * dLat, aLng + t * dLng];
}

function nearestEdgeProjection(lat: number, lng: number): readonly [number, number] {
  const first = RIVER_POLYGON[0] as readonly [number, number];
  let bestLat = first[0];
  let bestLng = first[1];
  let bestDistSq = Infinity;
  const n = RIVER_POLYGON.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [yi, xi] = RIVER_POLYGON[i] as readonly [number, number];
    const [yj, xj] = RIVER_POLYGON[j] as readonly [number, number];
    const [pLat, pLng] = projectOntoSegment(lat, lng, yj, xj, yi, xi);
    const dLat = pLat - lat;
    const dLng = pLng - lng;
    const d = dLat * dLat + dLng * dLng;
    if (d < bestDistSq) {
      bestDistSq = d;
      bestLat = pLat;
      bestLng = pLng;
    }
  }
  return [bestLat, bestLng];
}

// If pos is inside the river polygon, project it to the nearest bank
// and push slightly farther into land. Exported so the listing
// pipeline can clean LLM-emitted river coords before they're stored.
export function snapToLandIfInRiver(pos: LatLng): LatLng {
  if (!pointInRiverPolygon(pos.lat, pos.lng)) return pos;
  const [edgeLat, edgeLng] = nearestEdgeProjection(pos.lat, pos.lng);
  const dLat = edgeLat - pos.lat;
  const dLng = edgeLng - pos.lng;
  const len = Math.hypot(dLat, dLng);
  if (len === 0) return { lat: edgeLat, lng: edgeLng };
  return {
    lat: edgeLat + (dLat / len) * SNAP_OFFSET_DEG,
    lng: edgeLng + (dLng / len) * SNAP_OFFSET_DEG,
  };
}

function avoidWater(_center: LatLng, sampled: LatLng): LatLng {
  return snapToLandIfInRiver(sampled);
}

// How many fresh samples to try before falling back to the snap. The
// snap collapses many in-water samples onto the same edge point + 80m
// offset, which produces tight clusters of stacked tokens at the bank
// (the visible "stamped pile of paws" bug). Resampling preserves the
// scatter spread for points that legitimately had a water roll.
const RESAMPLE_LIMIT = 8;

function isInRiver(p: LatLng): boolean {
  return pointInRiverPolygon(p.lat, p.lng);
}

export function distanceMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Closest point on the line segment AB to P, in the planar
// (lat, lng treated as Cartesian) approximation. Then we measure the
// haversine distance from P to that closest point so the returned
// number is in real-world meters. Good enough for short urban
// segments (Kyiv) — the planar projection error over a few km is
// well below the auto-collect tolerance (90m).
export function pointToSegmentDistanceM(
  p: LatLng,
  a: LatLng,
  b: LatLng,
): number {
  const dx = b.lat - a.lat;
  const dy = b.lng - a.lng;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return distanceMeters(p, a);
  let t = ((p.lat - a.lat) * dx + (p.lng - a.lng) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const closest: LatLng = { lat: a.lat + t * dx, lng: a.lng + t * dy };
  return distanceMeters(p, closest);
}

// centerBias shapes the radial distribution when > 0:
//   0   — uniform box (lat/lng each independently uniform in ±spread).
//   0.5 — polar disk, r = u (linear). Areal density ∝ 1/r → visibly
//         denser near the center, still reaches the edge.
//   1   — polar disk, r = u^1.5. Strong center nest, sparse outskirts.
// The box form is preserved for centerBias=0 so existing uses (food,
// anything that wants flat scatter) behave identically.
export function scatter(
  center: LatLng,
  count: number,
  latSpread: number,
  lngSpread: number,
  centerBias = 0,
): LatLng[] {
  const sampleOne = (): LatLng => {
    if (centerBias > 0) {
      const u = Math.random();
      const theta = Math.random() * 2 * Math.PI;
      const r = Math.pow(u, 0.5 + centerBias);
      return {
        lat: center.lat + Math.sin(theta) * r * latSpread,
        lng: center.lng + Math.cos(theta) * r * lngSpread,
      };
    }
    return {
      lat: center.lat + (Math.random() - 0.5) * 2 * latSpread,
      lng: center.lng + (Math.random() - 0.5) * 2 * lngSpread,
    };
  };
  const out: LatLng[] = [];
  for (let i = 0; i < count; i++) {
    let sampled = sampleOne();
    let tries = 0;
    while (isInRiver(sampled) && tries < RESAMPLE_LIMIT) {
      sampled = sampleOne();
      tries++;
    }
    out.push(avoidWater(center, sampled));
  }
  return out;
}

// Meter-native disk scatter. Converts meter offsets to lat/lng at the
// given center latitude so the sampled points form a roughly circular
// disk on the ground rather than an ellipse stretched by degrees-of-
// longitude distortion. Shares centerBias semantics with scatter().
//
// Optional `minRadiusM` carves out an inner exclusion zone so the
// scatter samples land in an annulus instead of a full disk. Used by
// the user-area token pool to keep paws from spawning *inside* the
// auto-collect radius (otherwise they get vacuumed instantly and the
// counter ticks up while the user is standing still).
export function scatterInRadius(
  center: LatLng,
  count: number,
  radiusM: number,
  centerBias = 0,
  minRadiusM = 0,
): LatLng[] {
  const latMetersPerDeg = 111_000;
  const lngMetersPerDeg = 111_000 * Math.cos((center.lat * Math.PI) / 180);
  const out: LatLng[] = [];
  const minSq = minRadiusM * minRadiusM;
  const maxSq = radiusM * radiusM;
  const span = maxSq - minSq;
  const biasExp = 1 + 2 * Math.max(0, centerBias);
  const sampleOne = (): LatLng => {
    const u = Math.random();
    const theta = Math.random() * 2 * Math.PI;
    const uBiased = Math.pow(u, biasExp);
    const rM = Math.sqrt(minSq + uBiased * span);
    return {
      lat: center.lat + (Math.sin(theta) * rM) / latMetersPerDeg,
      lng: center.lng + (Math.cos(theta) * rM) / lngMetersPerDeg,
    };
  };
  for (let i = 0; i < count; i++) {
    let sampled = sampleOne();
    let tries = 0;
    while (isInRiver(sampled) && tries < RESAMPLE_LIMIT) {
      sampled = sampleOne();
      tries++;
    }
    out.push(avoidWater(center, sampled));
  }
  return out;
}
