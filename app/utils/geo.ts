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
