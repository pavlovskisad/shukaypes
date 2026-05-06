export interface LatLng {
  lat: number;
  lng: number;
}

const R = 6371000;

// Approximate Dnipro main channel as a stack of lat-banded lng rects.
// Mirrors the client's avoidWater() in app/utils/cluster.ts; needs to
// stay in sync — both bones (around parks like Hidropark on
// Trukhaniv island) and paws (scattered around the user) were
// landing in water with the previous single narrow rect that didn't
// follow the river's bend + width changes.
//
// Each band: [latMin, latMax, lngWestEdge, lngEastEdge].
const RIVER_BANDS: ReadonlyArray<readonly [number, number, number, number]> = [
  [50.55, 51.0, 30.4, 30.55],     // Vyshhorod / Kyiv Sea exit
  [50.5, 50.55, 30.5, 30.57],     // Obolon waterfront
  [50.45, 50.5, 30.545, 30.62],   // Central Kyiv (Podil / Hidropark / Trukhaniv)
  [50.4, 50.45, 30.575, 30.645],  // Pechersk → Vydubychi
  [49.9, 50.4, 30.6, 30.7],       // Osokorky / Bortnychi bay
];

function bandsFor(lat: number): readonly [number, number] | null {
  for (const [latMin, latMax, west, east] of RIVER_BANDS) {
    if (lat >= latMin && lat < latMax) return [west, east];
  }
  return null;
}

function avoidWater(_center: LatLng, sampled: LatLng): LatLng {
  const band = bandsFor(sampled.lat);
  if (!band) return sampled;
  const [west, east] = band;
  if (sampled.lng <= west || sampled.lng >= east) return sampled;
  const mid = (west + east) / 2;
  // Snap to closer bank using the SAMPLED point's own lng — same fix
  // as the client (center-based snap collapsed all river-coord pets
  // onto one bank when the originating center was itself in water).
  return { ...sampled, lng: sampled.lng < mid ? west : east };
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
  const out: LatLng[] = [];
  for (let i = 0; i < count; i++) {
    let sampled: LatLng;
    if (centerBias > 0) {
      const u = Math.random();
      const theta = Math.random() * 2 * Math.PI;
      const r = Math.pow(u, 0.5 + centerBias);
      sampled = {
        lat: center.lat + Math.sin(theta) * r * latSpread,
        lng: center.lng + Math.cos(theta) * r * lngSpread,
      };
    } else {
      sampled = {
        lat: center.lat + (Math.random() - 0.5) * 2 * latSpread,
        lng: center.lng + (Math.random() - 0.5) * 2 * lngSpread,
      };
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
  for (let i = 0; i < count; i++) {
    const u = Math.random();
    const theta = Math.random() * 2 * Math.PI;
    // Biased uniform-area sampling on the annulus [minR, maxR].
    // Reduces to the disk case when minRadiusM = 0.
    const uBiased = Math.pow(u, biasExp);
    const rM = Math.sqrt(minSq + uBiased * span);
    const sampled: LatLng = {
      lat: center.lat + (Math.sin(theta) * rM) / latMetersPerDeg,
      lng: center.lng + (Math.cos(theta) * rM) / lngMetersPerDeg,
    };
    out.push(avoidWater(center, sampled));
  }
  return out;
}
