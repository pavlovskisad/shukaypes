import type {
  ChatMessage,
  FoodItem,
  LatLng,
  NearbyPlayer,
  Poke,
  Quest,
  Token,
  UrgencyLevel,
} from '@shukajpes/shared';
import { env } from '../constants/env';
import { MULTIPLAYER } from '../constants/experiments';
import { getDeviceId } from './deviceId';
import { getTelegramInitData } from './telegram';

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
  | { name: 'highlight_spot'; args: { spotId: string } }
  | {
      name: 'walk';
      args: { shape: 'roundtrip' | 'oneway'; distance: 'close' | 'far' };
    }
  | {
      name: 'walk_to_spot';
      args: { spotId: string; shape: 'roundtrip' | 'oneway' };
    };

// Minimum spot info the chat call needs to send so the companion can
// reference real nearby spots in its CONTEXT block. Mirrors the
// server's NearbySpot. Closest-first, capped at ~8 by the caller.
export interface ChatNearbySpot {
  id: string;
  name: string;
  category: string;
  distM: number;
}

// A drawable piece of territory: the hull of a cluster of marks. 'area'
// for three or more (a filled shape), 'line' for exactly two (a link with
// no ground yet).
export interface TerritoryShape {
  kind: 'area' | 'line';
  points: { lat: number; lng: number }[];
}

export interface TerritoryMark {
  lat: number;
  lng: number;
  closedLoop: boolean;
  // 1-3. How many visits have hardened this spot — and therefore how many
  // rival marks it takes to knock it out.
  strength: number;
  // ISO timestamp. The dot only shows while the mark is fresh — it fades
  // out and leaves the territory behind — so the map needs its age.
  at: string;
}

// Someone else's ground. Only sent while you're near it, so this is
// normally empty and the map is yours alone.
export interface RivalTerritory {
  ownerId: string;
  ownerName: string;
  shapes: TerritoryShape[];
}

// A place on the territory board. `bot` marks the simulated walkers, so
// the UI can label them rather than pass them off as neighbours.
export interface TerritoryRanking {
  userId: string;
  name: string;
  areaM2: number;
  bot: boolean;
}

// Somebody marked over your ground while you weren't looking.
export interface TerritoryRaid {
  raiderName: string;
  lat: number;
  lng: number;
  // True when they finished a mark off rather than just weakening it.
  killed: boolean;
  at: string;
}

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
  // Prefer Telegram Mini App auth when running inside Telegram —
  // server validates the signature with our bot token and resolves
  // (or creates) the user keyed on telegram_id. Outside Telegram
  // (regular browser / PWA) we send the existing device-id header
  // and the user stays anonymous + browser-scoped.
  const tgInitData = getTelegramInitData();
  const authHeaders: Record<string, string> = tgInitData
    ? { 'x-telegram-init-data': tgInitData }
    : { 'x-device-id': getDeviceId() };
  const res = await fetch(`${env.apiUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...authHeaders,
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

  // Single-dog lookup by id. /dogs/nearby is GPS-bounded, so when the
  // user opens a Telegram deep-link (?startapp=lost-<id>) we can't
  // assume the pet is in their current radius — this fetches it
  // directly so the map can fly to it from anywhere.
  getLostDogById: (id: string) =>
    req<{ dog: NearbyLostDog }>(`/dogs/${encodeURIComponent(id)}`),

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
    // Opt into multiplayer presence — server writes our position + returns
    // nearby players only when this flag is present.
    if (MULTIPLAYER) params.set('mp', '1');
    return req<{
      tokens: Token[];
      food: FoodItem[];
      dogs: NearbyLostDog[];
      state: StateResponse;
      // Present only when mp=1; older servers omit these (default []).
      players?: NearbyPlayer[];
      pokes?: Poke[];
      // Your claimed ground near this position. Optional so an older
      // server (or a failed territory read) just means an unmarked map.
      marks?: TerritoryMark[];
      shapes?: TerritoryShape[];
      // Rival ground within sight, and any raids on yours since the last
      // sync. Both optional for the same reason as above.
      rivals?: RivalTerritory[];
      raids?: TerritoryRaid[];
      // How much ground you hold (m²), and whether the walker is
      // standing on it right now — the passive perks hang off `home`.
      areaM2?: number;
      home?: boolean;
    }>(`/sync/map?${params.toString()}`);
  },

  // Nudge another nearby player; delivered on their next map sync.
  poke: (targetId: string) =>
    req<{ ok: boolean }>('/poke', {
      method: 'POST',
      body: JSON.stringify({ targetId }),
    }),

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
  // `dogPos` is where the companion sprite currently stands. The dog is
  // what marks territory, so the server prefers this over the walker's own
  // position (clamping it to a plausible offset first).
  collectPath: (pos: LatLng, dogPos?: LatLng | null) =>
    req<{
      tokensCollected: number;
      foodConsumed: number;
      reason?: string;
      // Set when the dog marked territory on this sync — the server
      // decides, we just announce it and refresh the map.
      marked?: {
        lat: number;
        lng: number;
        // True when this mark is the one that first gave its cluster area.
        enclosed?: boolean;
        // 1 = new ground; 2-3 = landed on ground we already held and
        // renewed it.
        strength?: number;
        // How many rival marks it knocked down, and whether any died.
        stolen?: number;
        captured?: boolean;
      } | null;
      // Why it didn't, when the reason is worth a word from the dog.
      mood?: 'hungry' | 'grumpy' | null;
    }>('/collect/path', {
      method: 'POST',
      body: JSON.stringify({
        lat: pos.lat,
        lng: pos.lng,
        ...(dogPos ? { dogLat: dogPos.lat, dogLng: dogPos.lng } : {}),
      }),
    }),

  // Wipe your own territory — marks and claimed ground. Dev affordance for
  // re-testing the mechanic from scratch (see ?terrReset=1).
  // Empty object rather than no body at all: `req` always sets a JSON
  // content-type, and Fastify rejects a POST that declares JSON and then
  // sends nothing (FST_ERR_CTP_EMPTY_JSON_BODY → 400). Without this the
  // reset silently 400s and the caller's catch swallows it.
  resetTerritory: () =>
    req<{ ok: true }>('/territory/reset', {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  // Who holds the most of the city, and where you stand. Its own trip
  // rather than a field on /sync/map — the board is read from the profile
  // tab, and recomputing a scoreboard on every 15s map poll would be work
  // nobody is looking at. `rank` is null when you're outside the top ten.
  territoryLeaderboard: () =>
    req<{ board: TerritoryRanking[]; you: { areaM2: number; rank: number | null } }>(
      '/territory/leaderboard',
    ),

  // Dev affordance (see ?terrRaid=1): send a bot onto your newest mark so
  // the raid notification can be checked without waiting for one to walk
  // there on its own. Returns ok:false when you hold no ground yet.
  raidTest: () =>
    req<{ ok: boolean }>('/territory/raid-test', {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  getChatHistory: () => req<{ messages: ChatMessage[] }>('/chat/history'),

  sendChat: (
    text: string,
    pos: LatLng | null,
    spots: ChatNearbySpot[] | null,
    greet = false,
    viewport: LatLng | null = null,
    lang: 'uk' | 'en' = 'uk',
  ) =>
    req<{
      id: string;
      text: string;
      // Server-parsed structured action the companion attached to the
      // reply.
      action: CompanionAction | null;
    }>('/chat', {
      method: 'POST',
      body: JSON.stringify({
        text,
        greet,
        lat: pos?.lat,
        lng: pos?.lng,
        spots: spots ?? undefined,
        // Where the human is LOOKING on the map (viewport centre),
        // not where they're standing. Server uses this for lore +
        // lost-pet proximity so the dog can talk about Podil when
        // you've panned to Podil from Pechersk. Falls back to GPS
        // server-side when null.
        vLat: viewport?.lat,
        vLng: viewport?.lng,
        // App-side preference from langStore. Server defaults to UK
        // (Kyiv pilot) when omitted, but we pass it explicitly so
        // an EN-toggled user gets EN replies on the first turn.
        lang,
      }),
    }),

  ambientChat: (pos: LatLng | null, lang: 'uk' | 'en' = 'uk') =>
    req<{ text: string }>('/chat/ambient', {
      method: 'POST',
      body: JSON.stringify({ lat: pos?.lat, lng: pos?.lng, lang }),
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

  // Long-press "sniff this area" — pick one nearby kyiv_lore entry the
  // dog can talk about, excluding what's already been surfaced this
  // session.
  discoverLore: (lat: number, lng: number, excludeIds: string[] = []) => {
    const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
    if (excludeIds.length) params.set('exclude', excludeIds.join(','));
    return req<{
      lore: {
        id: string;
        name: string;
        category: string;
        story: string;
        wikipediaTitle: string | null;
        sourceLang: string | null;
        position: LatLng;
        distM: number;
      } | null;
    }>(`/lore/discover?${params.toString()}`);
  },
};
