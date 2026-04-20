import type { FoodItem, LatLng, Token } from '@shukajpes/shared';
import { env } from '../constants/env';
import { getDeviceId } from './deviceId';

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

  getFoodNearby: (pos: LatLng) =>
    req<{ food: FoodItem[] }>(`/food/nearby?lat=${pos.lat}&lng=${pos.lng}`),

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
};
