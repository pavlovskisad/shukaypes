import type { LatLng } from '@shukajpes/shared';
import { env } from '../constants/env';

// Nearby places via the Google PLACES API (NEW) — places.googleapis.com.
// Direct browser calls; the new endpoints expose CORS so no proxy or
// Google Maps JS SDK is needed.
//
// Requires "Places API (New)" enabled on the Cloud project behind
// EXPO_PUBLIC_GOOGLE_MAPS_API_KEY (separate from the legacy Places API).

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
const SEARCH_ENDPOINT = 'https://places.googleapis.com/v1/places:searchNearby';

// Places API (New) uses the same primary-type strings as legacy for our
// categories, except `veterinary_care` is now `veterinary_care` still.
const TYPE_FOR_CATEGORY: Record<SpotCategory, string> = {
  cafe: 'cafe',
  restaurant: 'restaurant',
  bar: 'bar',
  pet_store: 'pet_store',
  veterinary_care: 'veterinary_care',
};

interface NewPlace {
  id?: string;
  displayName?: { text?: string };
  location?: { latitude: number; longitude: number };
  rating?: number;
  formattedAddress?: string;
  primaryType?: string;
}

async function searchNearby(
  center: LatLng,
  radiusM: number,
  includedTypes: string[],
  maxResults: number,
  fieldMask: string,
): Promise<NewPlace[]> {
  if (!env.googleMapsApiKey) return [];
  try {
    const resp = await fetch(SEARCH_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': env.googleMapsApiKey,
        'X-Goog-FieldMask': fieldMask,
      },
      body: JSON.stringify({
        includedTypes,
        maxResultCount: maxResults,
        locationRestriction: {
          circle: {
            center: { latitude: center.lat, longitude: center.lng },
            radius: radiusM,
          },
        },
      }),
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as { places?: NewPlace[] };
    return data.places ?? [];
  } catch {
    return [];
  }
}

// Spots — cafes/restaurants/bars/pet stores/vets. One API call across
// all five categories (Places API New supports up to 50 types per
// request), then mapped back via primaryType.
export async function fetchNearbySpots(
  center: LatLng,
  radiusM: number = DEFAULT_RADIUS_M,
): Promise<Spot[]> {
  const types = (Object.keys(TYPE_FOR_CATEGORY) as SpotCategory[]).map(
    (c) => TYPE_FOR_CATEGORY[c],
  );
  const results = await searchNearby(
    center,
    radiusM,
    types,
    20,
    'places.id,places.displayName,places.location,places.rating,places.formattedAddress,places.primaryType',
  );
  const byId = new Map<string, Spot>();
  for (const r of results) {
    if (!r.id || !r.location) continue;
    const category = (Object.keys(TYPE_FOR_CATEGORY) as SpotCategory[]).find(
      (c) => TYPE_FOR_CATEGORY[c] === r.primaryType,
    );
    if (!category) continue;
    if (byId.has(r.id)) continue;
    byId.set(r.id, {
      id: r.id,
      name: r.displayName?.text ?? '(unnamed)',
      category,
      position: { lat: r.location.latitude, lng: r.location.longitude },
      rating: r.rating,
      address: r.formattedAddress,
      icon: emojiFor(category),
    });
  }
  return Array.from(byId.values()).sort((a, b) => {
    const da = haversineM(center, a.position);
    const db = haversineM(center, b.position);
    return da - db;
  });
}

// Parks — for the bones pool + walk candidates. 1200m covers a
// ~15-min walking neighborhood. Google often returns 4-6 rows for one
// physical park (sub-sections, entrances) so we dedupe within 120m.
const PARK_RADIUS_M = 1200;

export interface Park {
  id: string;
  name: string;
  position: LatLng;
}

export async function fetchNearbyParks(center: LatLng): Promise<Park[]> {
  const results = await searchNearby(
    center,
    PARK_RADIUS_M,
    ['park'],
    20,
    'places.id,places.displayName,places.location',
  );
  const DEDUPE_RADIUS_M = 120;
  const out: Park[] = [];
  for (const r of results) {
    if (!r.id || !r.location) continue;
    const pos = { lat: r.location.latitude, lng: r.location.longitude };
    const dup = out.some((p) => haversineM(p.position, pos) < DEDUPE_RADIUS_M);
    if (!dup) {
      out.push({
        id: r.id,
        name: r.displayName?.text ?? 'park',
        position: pos,
      });
    }
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
