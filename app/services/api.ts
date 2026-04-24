import type { ChatMessage, FoodItem, LatLng, Quest, Token, UrgencyLevel } from '@shukajpes/shared';
import { env } from '../constants/env';
import { getDeviceId } from './deviceId';

// Projection returned by /dogs/nearby — narrower than the full LostDog type
// (no description, source, status, reportedBy). Radius is named with the
// trailing M to match the DB column; other types in @shukajpes/shared predate
// the backend and use a different name, which we'd reconcile in a later slice.
// The type name keeps "Dog" because renaming cascades into store, components,
// and modal — tracked as a v2 cleanup.
export type PetSpecies = 'dog' | 'cat';

export interface NearbyLostDog {
  id: string;
  name: string;
  species: PetSpecies;
  breed: string;
  emoji: string;
  photoUrl: string | null;
  urgency: UrgencyLevel;
  rewardPoints: number;
  searchZoneRadiusM: number;
  lastSeen: { position: LatLng; at: string };
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${env.apiUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-device-id': getDeviceId(),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${path}: ${text}`);
  }
  return (await res.json()) as T;
}

export interface StateResponse {
  user: {
    id: string;
    username: string;
    points: number;
    totalTokens: number;
    totalDistanceMeters: number;
  };
  companion: {
    name: string;
    level: number;
    xp: number;
    skinId: string;
    hunger: number;
    happiness: number;
    lastFedAt: string | null;
  };
}

export const api = {
  getState: () => req<StateResponse>('/state'),

  getTokensNearby: (pos: LatLng) =>
    req<{ tokens: Token[] }>(`/tokens/nearby?lat=${pos.lat}&lng=${pos.lng}`),

  getFoodNearby: (pos: LatLng, parks?: LatLng[]) => {
    const params = new URLSearchParams({
      lat: String(pos.lat),
      lng: String(pos.lng),
    });
    if (parks && parks.length) {
      // Compact pipe-delimited format — keeps the URL short even with
      // a dozen parks. Server splits on '|', then on ','.
      params.set('parks', parks.map((p) => `${p.lat},${p.lng}`).join('|'));
    }
    return req<{ food: FoodItem[] }>(`/food/nearby?${params.toString()}`);
  },

  getLostDogsNearby: (pos: LatLng, radiusM = 5000) =>
    req<{ dogs: NearbyLostDog[] }>(
      `/dogs/nearby?lat=${pos.lat}&lng=${pos.lng}&radius=${radiusM}`,
    ),

  collectToken: (tokenId: string, pos: LatLng) =>
    req<{ ok: true; value: number }>('/collect/token', {
      method: 'POST',
      body: JSON.stringify({ tokenId, lat: pos.lat, lng: pos.lng }),
    }),

  feed: (foodId: string, pos: LatLng) =>
    req<{ ok: true }>('/feed', {
      method: 'POST',
      body: JSON.stringify({ foodId, lat: pos.lat, lng: pos.lng }),
    }),

  getChatHistory: () => req<{ messages: ChatMessage[] }>('/chat/history'),

  sendChat: (text: string, pos: LatLng | null, greet = false) =>
    req<{ id: string; text: string; action: string | null }>('/chat', {
      method: 'POST',
      body: JSON.stringify({ text, greet, lat: pos?.lat, lng: pos?.lng }),
    }),

  ambientChat: (pos: LatLng | null) =>
    req<{ text: string }>('/chat/ambient', {
      method: 'POST',
      body: JSON.stringify({ lat: pos?.lat, lng: pos?.lng }),
    }),

  reportSighting: (dogId: string, pos: LatLng, note?: string) =>
    req<{ ok: true; id: string; trusted: boolean; distM: number }>('/sightings', {
      method: 'POST',
      body: JSON.stringify({ dogId, lat: pos.lat, lng: pos.lng, note }),
    }),

  // Detective quest endpoints. The response quest shape matches shared
  // Quest (currentWaypoint, waypoints as Waypoint[]). Server also
  // returns a `status` field we read to branch active/completed.
  startQuest: (dogId: string, pos: LatLng) =>
    req<{ quest: Quest & { status: string } }>('/quests/start', {
      method: 'POST',
      body: JSON.stringify({ dogId, lat: pos.lat, lng: pos.lng }),
    }),

  getActiveQuest: () =>
    req<{ quest: (Quest & { status: string }) | null }>('/quests/active'),

  advanceQuest: (questId: string, pos: LatLng) =>
    req<{ quest: Quest & { status: string }; completed: boolean }>('/quests/advance', {
      method: 'POST',
      body: JSON.stringify({ questId, lat: pos.lat, lng: pos.lng }),
    }),

  abandonQuest: (questId: string) =>
    req<{ ok: true }>('/quests/abandon', {
      method: 'POST',
      body: JSON.stringify({ questId }),
    }),
};
