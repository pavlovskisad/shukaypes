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
import { getInviteCode, clearInviteCode } from './invite';
import { getDevKey } from './devUnlock';
import { markInviteRequired } from '../stores/accessStore';
import { useConnectionStore } from '../stores/connectionStore';

/**
 * The server refused to create an account because no valid invite code
 * was presented. Its own class so the UI can show a door rather than an
 * error — being uninvited is a state, not a fault.
 */
export class InviteRequiredError extends Error {
  constructor() {
    super('invite required');
    this.name = 'InviteRequiredError';
  }
}

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
  // 'area' — the outer boundary. 'line' — the two marks it joins.
  points: { lat: number; lng: number }[];
  // Pockets inside this shape that a neighbour holds, because their mark
  // is nearer to that ground than any of ours. The server partitions all
  // territory by nearest mark, so these are exactly the other owner's
  // shapes seen from the other side — no ground belongs to two people.
  holes?: { lat: number; lng: number }[][];
}

export interface TerritoryMark {
  lat: number;
  lng: number;
  closedLoop: boolean;
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
  // The outer ring of this owner's largest piece — the board draws it as
  // a small silhouette in their colour. Optional: an older server (or an
  // owner whose ground vanished mid-read) simply sends none.
  mainPiece?: { lat: number; lng: number }[];
  // The owner's freshest mark — where their dog last worked. The board
  // jump lands here so a far dog is findable.
  lastMark?: { lat: number; lng: number };
  // Where the dog IS right now, from live presence — set only while the
  // owner is online and walking. Fresher than lastMark.
  pos?: { lat: number; lng: number };
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

// A cellular hang is the most common failure in this app's target
// environment, and until now nothing bounded it: a bare fetch with no
// AbortController anywhere in the codebase. A request into a dead cell on
// a metro platform simply stacked up behind the last one until the
// browser gave up on its own — about two minutes on iOS Safari, during
// which the map is frozen and the user has no idea whether to wait.
//
// Twelve seconds is chosen against the slow path, not the fast one:
// /sync/map's own comments record it answering in over a second under
// load, so the ceiling has to leave room for a bad day on 3G without
// leaving somebody staring at a stalled screen.
const DEFAULT_TIMEOUT_MS = 12_000;

// Chat waits on a language model, not a database, and Opus routinely
// takes longer than any other call here. Timing it out at twelve seconds
// would kill perfectly good answers.
const CHAT_TIMEOUT_MS = 45_000;

/** Thrown when we gave up waiting, as opposed to being refused. */
export class TimeoutError extends Error {
  constructor(path: string) {
    super(`timeout ${path}`);
    this.name = 'TimeoutError';
  }
}

const noteSuccess = () => useConnectionStore.getState().noteSuccess();
const noteFailure = (timedOut: boolean) => useConnectionStore.getState().noteFailure(timedOut);

async function req<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  // Prefer Telegram Mini App auth when running inside Telegram —
  // server validates the signature with our bot token and resolves
  // (or creates) the user keyed on telegram_id. Outside Telegram
  // (regular browser / PWA) we send the existing device-id header
  // and the user stays anonymous + browser-scoped.
  const tgInitData = getTelegramInitData();
  const authHeaders: Record<string, string> = tgInitData
    ? { 'x-telegram-init-data': tgInitData }
    : { 'x-device-id': getDeviceId() };
  // Only consulted by the server when CREATING an account, so sending it
  // on every request is harmless and saves having to know which call
  // will be the one that signs us up. Absent for everybody who already
  // has an account, and for everybody at all while the gate is off.
  const invite = getInviteCode();
  if (invite) authHeaders['x-invite-code'] = invite;
  // Only the two destructive dev routes look at this, and only when
  // somebody has unlocked at /dev. Sent on every request for the same
  // reason as the invite code — knowing which call needs it is the
  // caller's problem otherwise — and absent entirely for everybody else.
  const devKey = getDevKey();
  if (devKey) authHeaders['x-dev-key'] = devKey;
  // AbortController rather than Promise.race: racing leaves the request
  // running, so a stalled call keeps its socket and its memory and still
  // resolves into nothing later. Aborting actually cancels it.
  const controller = new AbortController();
  const timeoutMs = init?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${env.apiUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...authHeaders,
        ...(init?.headers ?? {}),
      },
    });
  } catch (err) {
    // An abort we caused reads as a DOMException named AbortError, which
    // is indistinguishable from a real network fault to every caller
    // upstream. Naming it lets the connection banner say "slow" rather
    // than "broken", which is the more useful thing to tell somebody
    // standing on a metro platform.
    const timedOut = err instanceof Error && err.name === 'AbortError';
    noteFailure(timedOut);
    if (timedOut) throw new TimeoutError(path);
    throw err;
  } finally {
    clearTimeout(timer);
  }

  // REACHABILITY, NOT CORRECTNESS. A 500 still means the request crossed
  // the network and the server replied, so it clears the banner: telling
  // somebody they are offline when they are not would send them hunting
  // for signal over a bug at our end.
  noteSuccess();
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // 403 from the auth hook means the door is shut, not that anything
    // is broken. It needs to be distinguishable from a network fault,
    // because every other failure in this app is swallowed into an
    // unread field — and a user who simply has not been invited would
    // otherwise see an app that silently does nothing at all.
    if (res.status === 403 && text.includes('invite')) {
      markInviteRequired();
      throw new InviteRequiredError();
    }
    throw new Error(`${res.status} ${path}: ${text}`);
  }
  // We are through the door, so the code has done its job. Dropping it
  // here keeps a used code from lingering in a shared browser and being
  // presented by whoever opens the app next. Safe to do on any success:
  // the server claims the code before it creates the account, so a
  // retry could not have reused it anyway.
  if (invite) clearInviteCode();
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
    // The dog is due to mark. Drives the companion's excursion out to a
    // wider ring to go find a spot — on its normal ~25m orbit a mark
    // lands on top of the walker's own GPS dot and reads as the HUMAN
    // marking, which is not the game. Optional so an older server just
    // means the dog never makes the trip.
    markReady?: boolean;
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
  // Positions only. Cheap enough to poll several times faster than the
  // full sync — see the server route for why the two are split.
  presence: (pos: LatLng) => {
    const params = new URLSearchParams({
      lat: String(pos.lat),
      lng: String(pos.lng),
    });
    return req<{ players: NearbyPlayer[] }>(`/presence?${params.toString()}`);
  },

  // `dogsTag` is the fingerprint of the pets list we already hold. Sending
  // it lets the server answer `dogs: null` — "unchanged, keep yours" —
  // instead of repeating a payload measured at 29 KB, half of every sync,
  // for a list that gains about seventeen entries a week.
  syncMap: (pos: LatLng, opts?: { parks?: LatLng[]; radiusM?: number; dogsTag?: string | null }) => {
    const params = new URLSearchParams({
      lat: String(pos.lat),
      lng: String(pos.lng),
    });
    if (opts?.dogsTag) params.set('dogsTag', opts.dogsTag);
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
      // NULL means "unchanged since the tag you sent" — keep what you have.
      // Null rather than an absent key on purpose: an empty array is a real
      // answer ("no pets near you") and the two must never be confusable.
      dogs: NearbyLostDog[] | null;
      dogsTag?: string;
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
      // Marks other dogs have JUST made. Without them a neighbour's border
      // simply changed shape between one sync and the next and you never
      // saw why — the dogs looked like they were doing nothing.
      rivalMarks?: { lat: number; lng: number; ownerId: string; at: string }[];
      raids?: TerritoryRaid[];
      // Whether the walker is standing on ground they hold — the passive
      // perks hang off this. Area held comes from the standing endpoint,
      // not from here: one number, one place that computes it.
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
        // Landed on ground we already hold, renewing it rather than
        // claiming anything new.
        renewed?: boolean;
        // How many rival marks it knocked down, and whether any died.
        stolen?: number;
        captured?: boolean;
      } | null;
      // Why it didn't, when the reason is worth a word from the dog.
      mood?: 'hungry' | 'grumpy' | 'own-ground' | null;
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
  // `limit` widens the board past the default ten (clamped server-side)
  // for the fullscreen "see all" view.
  territoryLeaderboard: (limit?: number) =>
    req<{ board: TerritoryRanking[]; you: { areaM2: number; rank: number | null } }>(
      limit != null ? `/territory/leaderboard?limit=${limit}` : '/territory/leaderboard',
    ),

  // Dev affordance (see ?terrRaid=1): send a bot onto your newest mark so
  // the raid notification can be checked without waiting for one to walk
  // there on its own. Returns ok:false when you hold no ground yet.
  raidTest: () =>
    req<{ ok: boolean }>('/territory/raid-test', {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  // Check the shared dev password (see /dev). Throws on a wrong one, which
  // is the whole point — storing an unchecked password would leave the
  // operator staring at a simulator that silently does nothing.
  unlockDev: (password: string) =>
    req<{ ok: true }>('/dev/unlock', {
      method: 'POST',
      body: JSON.stringify({ password }),
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
      // Waiting on a language model, not a query — see CHAT_TIMEOUT_MS.
      timeoutMs: CHAT_TIMEOUT_MS,
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

  // Closing a supersniff search. Both answers pay — see the route for
  // why "no" is a result worth recording rather than a failure. Returns
  // the permalink of the post the pet came from when there is one, so
  // the finder can reach the owner without us holding their contact.
  finishSearch: (dogId: string, seen: boolean, pos: LatLng | null) =>
    req<{
      ok: true;
      seen: boolean;
      paws: number;
      sightingId: string | null;
      sourceUrl: string | null;
    }>('/sightings/search-result', {
      method: 'POST',
      body: JSON.stringify({ dogId, seen, lat: pos?.lat, lng: pos?.lng }),
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
