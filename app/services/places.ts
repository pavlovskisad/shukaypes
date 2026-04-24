import type { LatLng } from '@shukajpes/shared';

// Thin wrapper around google.maps.places.PlacesService. Web-only (native
// gets the stub below). We use the "nearbySearch" path which requires an
// HTMLElement for attribution — we create a detached <div> per call and
// throw it away. Can't use PlacesService before the maps script has
// loaded; MapView's useJsApiLoader signals readiness so callers should
// gate on that.

export type SpotCategory =
  | 'cafe'
  | 'restaurant'
  | 'bar'
  | 'pet_store'
  | 'veterinary_care';

export interface Spot {
  id: string;
  name: string;
  category: SpotCategory;
  position: LatLng;
  rating?: number;
  address?: string;
  icon?: string;
}

const CATEGORY_EMOJI: Record<SpotCategory, string> = {
  cafe: '☕',
  restaurant: '🍜',
  bar: '🍹',
  pet_store: '🐶',
  veterinary_care: '⛑️',
};

export function emojiFor(category: SpotCategory): string {
  return CATEGORY_EMOJI[category];
}

const DEFAULT_RADIUS_M = 800;

function runSearch(
  svc: google.maps.places.PlacesService,
  request: google.maps.places.PlaceSearchRequest,
): Promise<google.maps.places.PlaceResult[]> {
  return new Promise((resolve) => {
    svc.nearbySearch(request, (results, status) => {
      if (status === google.maps.places.PlacesServiceStatus.OK && results) {
        resolve(results);
      } else {
        // Zero results + quota errors both resolve to [] — the UI just
        // shows an empty list rather than throwing, which matches the
        // prototype's behaviour.
        resolve([]);
      }
    });
  });
}

// Google's "type" filter takes one value per request. We fan out across
// categories and merge by place_id so the same venue (e.g. a bar that's
// also tagged restaurant) doesn't render twice.
// PlacesService accepts either a Map or a detached HTMLDivElement for
// attribution; we use a detached div so the Spots tab doesn't have to
// thread the map ref through.
export async function fetchNearbySpots(
  center: LatLng,
  radiusM: number = DEFAULT_RADIUS_M,
): Promise<Spot[]> {
  if (typeof google === 'undefined' || !google.maps?.places) return [];

  const attrContainer = document.createElement('div');
  const svc = new google.maps.places.PlacesService(attrContainer);
  const categories: SpotCategory[] = ['cafe', 'restaurant', 'bar', 'pet_store', 'veterinary_care'];

  const byPlaceId = new Map<string, Spot>();
  await Promise.all(
    categories.map(async (category) => {
      const results = await runSearch(svc, {
        location: center as unknown as google.maps.LatLngLiteral,
        radius: radiusM,
        type: category,
      });
      for (const r of results) {
        if (!r.place_id || !r.geometry?.location || byPlaceId.has(r.place_id)) continue;
        byPlaceId.set(r.place_id, {
          id: r.place_id,
          name: r.name ?? '(unnamed)',
          category,
          position: {
            lat: r.geometry.location.lat(),
            lng: r.geometry.location.lng(),
          },
          rating: r.rating,
          address: r.vicinity,
          icon: emojiFor(category),
        });
      }
    }),
  );

  // Nearest first.
  const sorted = Array.from(byPlaceId.values()).sort((a, b) => {
    const da = haversineM(center, a.position);
    const db = haversineM(center, b.position);
    return da - db;
  });
  return sorted;
}

// Nearby parks for the bones pool. Separate from fetchNearbySpots because
// bones live purely on park coords — we don't care about names or icons,
// just positions the server can seed food at. 1200m covers the ~15min
// walking neighborhood; parks farther than that are next-door's problem.
const PARK_RADIUS_M = 1200;

export async function fetchNearbyParks(center: LatLng): Promise<LatLng[]> {
  if (typeof google === 'undefined' || !google.maps?.places) return [];
  const attrContainer = document.createElement('div');
  const svc = new google.maps.places.PlacesService(attrContainer);
  const results = await runSearch(svc, {
    location: center as unknown as google.maps.LatLngLiteral,
    radius: PARK_RADIUS_M,
    type: 'park',
  });
  // Dedupe overlapping Places entries for the same physical park. Google
  // often returns 4-6 rows for one big park (sub-sections, different
  // entrances). With 1 bone per park that still became a pile of 4-6
  // bones within 100m. Collapse anything within 120m of an already-
  // accepted park.
  const DEDUPE_RADIUS_M = 120;
  const out: LatLng[] = [];
  for (const r of results) {
    if (!r.geometry?.location) continue;
    const pos = { lat: r.geometry.location.lat(), lng: r.geometry.location.lng() };
    const dup = out.some((p) => haversineM(p, pos) < DEDUPE_RADIUS_M);
    if (!dup) out.push(pos);
  }
  return out;
}

function haversineM(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
