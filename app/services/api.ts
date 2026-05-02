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

// Mirror of server/src/services/actionParser.ts CompanionAction.
// Kept narrow here — the chat dispatcher only acts on names it knows;
// any new server-side action lands as a TypeScript error here first
// to remind us to wire the client handler.
export type CompanionAction =
  | { name: 'start_quest'; args: { dogId: string } }
  | { name: 'highlight_spot'; args: { spotId: string } };

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

  // Profile aggregates — fetched once per Profile tab focus, not on
  // every game-loop poll. Separate endpoint so the count queries
  // don't run inside /state's hot path.
  getProfile: () =>
    req<{
      user: {
        id: string;
        username: string;
        createdAt: string;
        points: number;
        totalTokens: number;
        totalDistanceMeters: number;
      };
      companion: {
        name: string;
        level: number;
        xp: number;
        xpInLevel: number;
        xpForNextLevel: number;
        maxLevel: number;
        hunger: number;
        happiness: number;
      };
      stats: {
        daysPlayed: number;
        pawsCollected: number;
        bonesEaten: number;
        petsSearched: number;
        questsCompleted: number;
        questsAbandoned: number;
        sightingsReported: number;
      };
    }>('/profile/me'),

  getTokensNearby: (pos: LatLng, parks?: LatLng[]) => {
    const params = new URLSearchParams({
      lat: String(pos.lat),
      lng: String(pos.lng),
    });
    // Same pipe-delimited shape as /food/nearby. When the client has
    // already loaded nearby parks (after the first food sync), pass
    // them along so the server can seed paw trails around each.
    if (parks && parks.length) {
      params.set('parks', parks.map((p) => `${p.lat},${p.lng}`).join('|'));
    }
    return req<{ tokens: Token[] }>(`/tokens/nearby?${params.toString()}`);
  },

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

  // Bulk variant of the four /tokens/nearby + /food/nearby +
  // /dogs/nearby + /state calls. One round-trip instead of four; the
  // client store can also collapse the resulting state into a single
  // set() so subscribers re-render once instead of four times.
  syncMap: (pos: LatLng, opts?: { parks?: LatLng[]; radiusM?: number }) => {
    const params = new URLSearchParams({
      lat: String(pos.lat),
      lng: String(pos.lng),
    });
    if (opts?.parks && opts.parks.length) {
      params.set('parks', opts.parks.map((p) => `${p.lat},${p.lng}`).join('|'));
    }
    if (opts?.radiusM != null) params.set('radius', String(opts.radiusM));
    return req<{
      tokens: Token[];
      food: FoodItem[];
      dogs: NearbyLostDog[];
      state: StateResponse;
    }>(`/sync/map?${params.toString()}`);
  },

  collectToken: (tokenId: string, pos: LatLng, force = false) =>
    req<{ ok: true; value: number }>('/collect/token', {
      method: 'POST',
      body: JSON.stringify({ tokenId, lat: pos.lat, lng: pos.lng, force }),
    }),

  feed: (foodId: string, pos: LatLng, force = false) =>
    req<{ ok: true }>('/feed', {
      method: 'POST',
      body: JSON.stringify({ foodId, lat: pos.lat, lng: pos.lng, force }),
    }),

  // Path-collection sweep — server compares the segment from the
  // user's last recorded position (kept in Redis) to the position
  // sent here, and credits any token / bone within auto-collect
  // radius of that segment. Lets the foreground app catch up after
  // a backgrounded walk where the JS timers were paused by Safari.
  collectPath: (pos: LatLng) =>
    req<{
      tokensCollected: number;
      foodConsumed: number;
      reason?: string;
    }>('/collect/path', {
      method: 'POST',
      body: JSON.stringify({ lat: pos.lat, lng: pos.lng }),
    }),

  getChatHistory: () => req<{ messages: ChatMessage[] }>('/chat/history'),

  sendChat: (text: string, pos: LatLng | null, greet = false) =>
    req<{
      id: string;
      text: string;
      // Server-parsed structured action the companion attached to the
      // reply. Currently only `start_quest` is wired end-to-end; new
      // names land as the parser + client dispatch grow.
      action: CompanionAction | null;
    }>('/chat', {
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

  // Detective quest endpoints. Response shape matches shared Quest
  // (currentWaypoint, waypoints as Waypoint[]) plus a `status` field
  // the client branches on. Start and advance also include `narration`
  // — a Claude-Haiku-authored one-liner in the companion's voice to
  // use as the bubble. Null when the narration call failed, so the
  // client should always have a hardcoded fallback.
  startQuest: (dogId: string, pos: LatLng) =>
    req<{ quest: Quest & { status: string }; narration: string | null }>(
      '/quests/start',
      {
        method: 'POST',
        body: JSON.stringify({ dogId, lat: pos.lat, lng: pos.lng }),
      },
    ),

  getActiveQuest: () =>
    req<{ quest: (Quest & { status: string }) | null }>('/quests/active'),

  // Recent completed/abandoned quests for the tasks tab history card.
  getQuestHistory: () =>
    req<{
      quests: Array<{
        id: string;
        dogId: string | null;
        dogName: string | null;
        dogEmoji: string | null;
        status: 'completed' | 'abandoned';
        startedAt: string;
        endedAt: string;
        rewardPoints: number;
      }>;
    }>('/quests/history'),

  // Set `force: true` to skip the server's distance check — used for
  // the tap-to-complete affordance on active waypoint pins during
  // testing. Without force, server rejects with 403 outside 60m.
  advanceQuest: (questId: string, pos: LatLng, force?: boolean) =>
    req<{
      quest: Quest & { status: string };
      completed: boolean;
      narration: string | null;
    }>('/quests/advance', {
      method: 'POST',
      body: JSON.stringify({ questId, lat: pos.lat, lng: pos.lng, force }),
    }),

  abandonQuest: (questId: string) =>
    req<{ ok: true }>('/quests/abandon', {
      method: 'POST',
      body: JSON.stringify({ questId }),
    }),

  // Daily-task progress — server-backed since PR #161.
  getDailyTasks: (date: string) =>
    req<{
      tasks: {
        date: string;
        tokens: number;
        bones: number;
        lostPetChecks: number;
        spotVisits: number;
        sightings: number;
      };
    }>(`/tasks/today?date=${encodeURIComponent(date)}`),

  tickDailyTask: (
    date: string,
    key: 'tokens' | 'bones' | 'lostPetChecks' | 'spotVisits' | 'sightings',
    amount = 1,
  ) =>
    req<{ ok: true }>('/tasks/tick', {
      method: 'POST',
      body: JSON.stringify({ date, key, amount }),
    }),
};
