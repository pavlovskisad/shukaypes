import type { LatLng } from '@shukajpes/shared';
import { env } from '../constants/env';

// Nearby places — all queries now go through our backend's
// /places/* endpoints, which proxy + cache Google Places (see
// server/src/services/placesCache.ts). Direct browser calls were
// burning quota per device per pan; the server cache shares results
// across users + sessions with a 14-day TTL.
//
// Public shape unchanged so call sites don't move.

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

const DEFAULT_RADIUS_M = 1100;
const PARK_RADIUS_M = 1500;

interface CachedPlace {
  id: string;
  name: string;
  category: string;
  position: LatLng;
  rating?: number;
  address?: string;
  icon?: string;
}

async function getJSON<T>(path: string): Promise<T | null> {
  try {
    const resp = await fetch(`${env.apiUrl}${path}`);
    if (!resp.ok) return null;
    return (await resp.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchNearbySpots(
  center: LatLng,
  radiusM: number = DEFAULT_RADIUS_M,
): Promise<Spot[]> {
  const params = new URLSearchParams({
    lat: String(center.lat),
    lng: String(center.lng),
    radius: String(radiusM),
  });
  const data = await getJSON<{ spots: CachedPlace[] }>(
    `/places/spots?${params.toString()}`,
  );
  if (!data) return [];
  // Server already filters out unknown categories, but narrow the
  // type defensively here so callers see SpotCategory.
  return data.spots
    .filter((s): s is CachedPlace & { category: SpotCategory } =>
      ['cafe', 'restaurant', 'bar', 'pet_store', 'veterinary_care'].includes(s.category),
    )
    .map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      position: s.position,
      rating: s.rating,
      address: s.address,
      icon: s.icon ?? emojiFor(s.category),
    }));
}

export interface Park {
  id: string;
  name: string;
  position: LatLng;
}

export async function fetchNearbyParks(center: LatLng): Promise<Park[]> {
  const params = new URLSearchParams({
    lat: String(center.lat),
    lng: String(center.lng),
    radius: String(PARK_RADIUS_M),
  });
  const data = await getJSON<{ parks: Park[] }>(
    `/places/parks?${params.toString()}`,
  );
  return data?.parks ?? [];
}
