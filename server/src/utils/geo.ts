export interface LatLng {
  lat: number;
  lng: number;
}

const R = 6371000;

// Rough Dnieper main channel through Kyiv. Mirrors the client's
// avoidWater() in app/utils/cluster.ts. Anything sampled inside this
// longitude band gets reflected to whichever bank the originating
// center is closer to. Coarser than a real water polygon but enough
// that paws + bones stop landing on water.
const RIVER_WEST_EDGE = 30.555;
const RIVER_EAST_EDGE = 30.598;

function avoidWater(center: LatLng, sampled: LatLng): LatLng {
  if (sampled.lng <= RIVER_WEST_EDGE || sampled.lng >= RIVER_EAST_EDGE) {
    return sampled;
  }
  const midRiver = (RIVER_WEST_EDGE + RIVER_EAST_EDGE) / 2;
  return {
    ...sampled,
    lng: center.lng < midRiver ? RIVER_WEST_EDGE : RIVER_EAST_EDGE,
  };
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
export function scatterInRadius(
  center: LatLng,
  count: number,
  radiusM: number,
  centerBias = 0,
): LatLng[] {
  const latMetersPerDeg = 111_000;
  const lngMetersPerDeg = 111_000 * Math.cos((center.lat * Math.PI) / 180);
  const out: LatLng[] = [];
  for (let i = 0; i < count; i++) {
    const u = Math.random();
    const theta = Math.random() * 2 * Math.PI;
    const rM = radiusM * Math.pow(u, 0.5 + Math.max(0, centerBias));
    const sampled: LatLng = {
      lat: center.lat + (Math.sin(theta) * rM) / latMetersPerDeg,
      lng: center.lng + (Math.cos(theta) * rM) / lngMetersPerDeg,
    };
    out.push(avoidWater(center, sampled));
  }
  return out;
}
