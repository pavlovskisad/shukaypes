import type { LatLng } from '@shukajpes/shared';
import { env } from '../constants/env';

// Walking directions via the Google ROUTES API (the modern successor
// to the legacy Directions API). Called directly from the browser —
// Routes API endpoints expose CORS, so we don't need the Google Maps
// JS SDK loaded just to make this call. Same function signature as
// before; callers don't change.
//
// Requires the "Routes API" enabled on the Google Cloud project
// behind EXPO_PUBLIC_GOOGLE_MAPS_API_KEY (separate from the legacy
// Directions API). The HTTP-referrer restriction on that key
// already covers our origins.

const ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes';

interface RoutesResponse {
  routes?: Array<{ polyline?: { encodedPolyline?: string } }>;
}

// Decode Google's encoded-polyline format (the same format the
// legacy DirectionsResult exposes). Standard reference algorithm.
function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

function asWaypoint(p: LatLng) {
  return { location: { latLng: { latitude: p.lat, longitude: p.lng } } };
}

export async function fetchWalkingRoute(
  origin: LatLng,
  waypoints: LatLng[],
): Promise<LatLng[] | null> {
  if (!env.googleMapsApiKey) return null;
  if (waypoints.length === 0) return null;
  const destination = waypoints[waypoints.length - 1]!;
  const intermediates = waypoints.slice(0, -1).map(asWaypoint);

  try {
    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': env.googleMapsApiKey,
        // Routes API requires a field mask — we only need the overall
        // polyline. Smaller response = less bandwidth + latency.
        'X-Goog-FieldMask': 'routes.polyline.encodedPolyline',
      },
      body: JSON.stringify({
        origin: asWaypoint(origin),
        destination: asWaypoint(destination),
        intermediates,
        travelMode: 'WALK',
        polylineEncoding: 'ENCODED_POLYLINE',
      }),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as RoutesResponse;
    const encoded = data.routes?.[0]?.polyline?.encodedPolyline;
    if (!encoded) return null;
    const path = decodePolyline(encoded);
    return path.length > 1 ? path : null;
  } catch {
    return null;
  }
}
