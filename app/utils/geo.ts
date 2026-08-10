import type { LatLng } from '@shukajpes/shared';

// Haversine distance in meters (ported from demo gD() at line 325).
export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// "X m" for sub-1km, "X.X km" beyond. Snapped to 50m below 1km so a
// label doesn't jitter on small GPS drift — which matters more now
// that one of these sits in the nav HUD and is read while walking.
export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m / 50) * 50} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

// How much of `route` is still ahead of `from`: the distance to the
// nearest point on the polyline, plus every segment after it.
//
// Straight-line-to-destination would be the easy answer and it is the
// wrong one for a nav readout — it barely moves while you walk the long
// way around a block, so the number reads as broken. Returns null when
// there's no usable route, and the caller falls back to the crow line.
export function remainingRouteMeters(route: LatLng[] | null, from: LatLng): number | null {
  if (!route || route.length < 2) return null;
  let bestSeg = 0;
  let bestT = 0;
  let bestD = Infinity;
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i]!;
    const b = route[i + 1]!;
    // Project onto the segment in degree space. Fine at city scale:
    // we only need to pick the right segment and roughly where on it.
    const dLat = b.lat - a.lat;
    const dLng = b.lng - a.lng;
    const len2 = dLat * dLat + dLng * dLng;
    const t =
      len2 === 0
        ? 0
        : Math.max(
            0,
            Math.min(1, ((from.lat - a.lat) * dLat + (from.lng - a.lng) * dLng) / len2),
          );
    const d = distanceMeters(from, lerpLL(a, b, t));
    if (d < bestD) {
      bestD = d;
      bestSeg = i;
      bestT = t;
    }
  }
  const foot = lerpLL(route[bestSeg]!, route[bestSeg + 1]!, bestT);
  let total = distanceMeters(foot, route[bestSeg + 1]!);
  for (let i = bestSeg + 1; i < route.length - 1; i++) {
    total += distanceMeters(route[i]!, route[i + 1]!);
  }
  return total;
}

function lerpLL(a: LatLng, b: LatLng, t: number): LatLng {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

// Project `from` onto the polyline `route` and return the point that sits
// `aheadM` further ALONG the route toward its end (clamped to the end). Used to
// make the companion LEAD the user: it targets a point a set distance ahead of
// where the user currently is on the path — so it stays in front and paces the
// user instead of sprinting to the destination.
export function pointAheadOnRoute(
  route: LatLng[],
  from: LatLng,
  aheadM: number,
): LatLng {
  if (route.length === 0) return from;
  if (route.length === 1) return route[0]!;
  // Planar projection in metres (fine over the short urban spans we lead on).
  const mLat = 110540;
  const mLng = 111320 * Math.cos((from.lat * Math.PI) / 180) || 111320;
  const px = (p: LatLng) => ({ x: p.lng * mLng, y: p.lat * mLat });
  const f = px(from);
  // Closest segment + cumulative distance to the projection of `from`.
  let bestD2 = Infinity;
  let bestCum = 0;
  let cum = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const a = px(route[i]!);
    const b = px(route[i + 1]!);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1e-9;
    let t = ((f.x - a.x) * dx + (f.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + t * dx;
    const cy = a.y + t * dy;
    const d2 = (f.x - cx) ** 2 + (f.y - cy) ** 2;
    const segLen = distanceMeters(route[i]!, route[i + 1]!);
    if (d2 < bestD2) {
      bestD2 = d2;
      bestCum = cum + t * segLen;
    }
    cum += segLen;
  }
  // Walk `aheadM` forward from the projection along the route.
  const target = bestCum + aheadM;
  let acc = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const segLen = distanceMeters(route[i]!, route[i + 1]!);
    if (acc + segLen >= target) {
      const t = segLen > 0 ? (target - acc) / segLen : 0;
      return lerpLL(route[i]!, route[i + 1]!, t);
    }
    acc += segLen;
  }
  return route[route.length - 1]!; // past the end → the destination
}

// Scatter n points within a lat/lng offset box around `center`.
export function scatter(center: LatLng, n: number, latSpread: number, lngSpread: number): LatLng[] {
  const out: LatLng[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push({
      lat: center.lat + (Math.random() - 0.5) * 2 * latSpread,
      lng: center.lng + (Math.random() - 0.5) * 2 * lngSpread,
    });
  }
  return out;
}
