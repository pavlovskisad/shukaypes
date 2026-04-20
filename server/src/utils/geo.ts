export interface LatLng {
  lat: number;
  lng: number;
}

const R = 6371000;

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

export function scatter(
  center: LatLng,
  count: number,
  latSpread: number,
  lngSpread: number,
): LatLng[] {
  const out: LatLng[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      lat: center.lat + (Math.random() - 0.5) * 2 * latSpread,
      lng: center.lng + (Math.random() - 0.5) * 2 * lngSpread,
    });
  }
  return out;
}
