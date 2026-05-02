import { create } from 'zustand';
import { balance } from '../constants/balance';
import type { FoodItem, LatLng, Quest, Token } from '@shukajpes/shared';
import { api, type NearbyLostDog } from '../services/api';
import {
  fetchNearbySpots,
  fetchNearbyParks,
  type Spot,
  type SpotCategory,
  type Park,
} from '../services/places';
import { distanceMeters } from '../utils/geo';

// Re-fetch the cached Places lists (parks for bone seeding +
// per-park paw rings, spots for the visit menu) when the user has
// walked further than this from the last fetch anchor. ~half the
// userAreaRadiusM so paws + bones still spawn before the cache
// goes meaningfully stale, but cheap enough to skip a Places call
// on every 15s tick.
const PLACES_REFRESH_THRESHOLD_M = 600;

// Daily tasks — client-side for pilot; promote to server when we add
// server-auth'd quests. Each field is a monotonic counter for today;
// progress = min(counter, target). Reset when `date` flips vs local
// Mirrors the server's daily_tasks table (PR #161). Initial state is
// blanks for today's local date; refreshDailyTasks() pulls authoritative
// counts from /tasks/today on map focus + on store hydration. Each
// tickDailyTask() applies the optimistic +N locally and POSTs to
// /tasks/tick — server is source of truth, but the UI updates without
// waiting for the round-trip.
export interface DailyTasks {
  date: string; // YYYY-MM-DD local
  tokens: number;
  bones: number;
  lostPetChecks: number;
  spotVisits: number;
  sightings: number;
}

const DAILY_TARGETS = {
  tokens: 10,
  bones: 3,
  lostPetChecks: 2,
  spotVisits: 1,
  sightings: 1,
};

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function blankTasks(): DailyTasks {
  return {
    date: todayLocal(),
    tokens: 0,
    bones: 0,
    lostPetChecks: 0,
    spotVisits: 0,
    sightings: 0,
  };
}

// Best-effort cleanup of the previous localStorage cache. Old keys
// hung around after PR #161 promoted state to the server; nuke once
// per session so the storage doesn't grow stale.
const LEGACY_STORAGE_KEY = 'shukajpes.dailyTasks.v1';
function dropLegacyStorage(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // storage disabled — fine, nothing to clean.
  }
}

export { DAILY_TARGETS };

interface GameState {
  hunger: number;
  happiness: number;
  tokensCollected: number;
  points: number;
  companionName: string;
  userPosition: LatLng | null;
  homePosition: LatLng | null;
  activeQuest: Quest | null;
  menuOpen: boolean;
  currentScreen: 'map' | 'tasks' | 'chat' | 'spots' | 'profile';
  tokens: Token[];
  // Ids we've optimistically collected but whose server commit may still
  // be in flight (or may have already landed but the next /tokens/nearby
  // poll fired before the commit was visible). We filter these out of
  // sync responses and short-circuit repeat collect() calls so the
  // auto-collect loop + 15s poll can't fight each other — without this,
  // the token blinks back on the map and the counter goes +1/-1 every
  // time the poll catches the race.
  recentlyCollectedIds: Set<string>;
  foodItems: FoodItem[];
  // Symmetric guard for food eat — same race as paw collect: auto-eat
  // loop and a user tap can both fire /feed for the same bone in the
  // same 100ms window. Without this Set, the second request 409s and
  // its catch re-adds the bone to the list = "ghost" reappear after
  // tap.
  recentlyConsumedIds: Set<string>;
  // Nearby parks fetched via Google Places. Each carries a name +
  // place_id alongside the position so the walk leaf can label routes
  // ("loop via Маріїнський парк") and the bones/paw-ring spawning can
  // dedupe by stable id. Cached across food syncs so we don't pay a
  // Places round-trip on every 15s tick; re-fetched when the user
  // walks past PLACES_REFRESH_THRESHOLD_M (Places only returns parks
  // within ~800m of the original anchor).
  parks: Park[];
  lastParksFetchPos: LatLng | null;
  lostDogs: NearbyLostDog[];
  selectedDogId: string | null;
  spots: Spot[];
  // Same logic as lastParksFetchPos — Google Places returns spots
  // within ~800m of the centre, so a long walk drifts off the cached
  // window. Re-fetched on the same threshold.
  lastSpotsFetchPos: LatLng | null;
  spotsLoading: boolean;
  selectedSpotId: string | null;
  // Map-overlay visibility toggle for the spots layer. Independent of
  // whether spots are loaded into the array — the user can declutter
  // the map without losing the cached Places fetch.
  spotsVisible: boolean;
  // Active category filter for the spots tab + map. 'all' shows
  // everything; any specific category restricts the spots layer to
  // just that category. Lives in the store so the spots tab and the
  // map agree on what's currently surfaced.
  spotsCategoryFilter: 'all' | SpotCategory;
  // Pre-computed walking route from companion's "walk" radial leaf.
  // Polyline is fetched once via the Directions API and stored here so
  // the map can render it without re-quotaing on every tick. shape
  // distinguishes roundtrip (origin → dest → origin) from one-way
  // (origin → dest) so MapView can label or style differently.
  walkRoute: LatLng[] | null;
  // spotId is null when the destination is a park (no spot marker to
  // keep alive) — see utils/walk.ts. The map renders the polyline
  // either way; spotId only governs whether the destination spot's
  // pin overrides the spots-toggle visibility.
  walkRouteMeta: { shape: 'roundtrip' | 'oneway'; spotId: string | null } | null;
  dailyTasks: DailyTasks;
  syncing: boolean;
  lastSyncError: string | null;
  // Bumped every time a paw or bone gets collected (auto OR forced).
  // The companion overlay watches this to trigger a brief Sniffing
  // sprite animation wherever it currently is, regardless of whether
  // the user or the companion was the one in range. Plain counter
  // instead of timestamp so subscribers compare with === rather than
  // worrying about stale-time math; no semantic meaning to the value.
  collectPulse: number;

  setUserPosition: (pos: LatLng) => void;
  setHomePosition: (pos: LatLng) => void;
  // `force` skips the server distance check — used for explicit user
  // taps on a paw/bone marker so a visible item is always collectable.
  // Auto-collect leaves it false so the anti-cheat gate still applies.
  collectToken: (id: string, force?: boolean) => Promise<void>;
  eatFood: (id: string, force?: boolean) => Promise<void>;
  setMenuOpen: (open: boolean) => void;
  setScreen: (screen: GameState['currentScreen']) => void;
  setActiveQuest: (quest: Quest | null) => void;
  syncState: () => Promise<void>;
  // Sweeps any uncollected token / uneaten bone the user walked past
  // while the tab was suspended (or just between 100ms loop ticks).
  // Server diff'ed against its own Redis-stored last position, so this
  // only ever credits a real corridor, not a teleport.
  collectPath: (pos: LatLng) => Promise<void>;
  syncTokens: (pos: LatLng) => Promise<void>;
  syncFood: (pos: LatLng) => Promise<void>;
  syncLostDogs: (pos: LatLng) => Promise<void>;
  // Bulk equivalent of syncTokens + syncFood + syncLostDogs +
  // syncState in a single round-trip. MapView calls this on focus +
  // every 15s; the per-resource actions stay around for callers that
  // only need one slice (Quests tab refreshing the lost-pet list,
  // etc).
  syncMap: (pos: LatLng) => Promise<void>;
  setSelectedDog: (id: string | null) => void;
  syncSpots: (pos: LatLng) => Promise<void>;
  setSelectedSpot: (id: string | null) => void;
  setSpotsVisible: (visible: boolean) => void;
  setSpotsCategoryFilter: (filter: 'all' | SpotCategory) => void;
  setWalkRoute: (
    route: LatLng[] | null,
    meta: { shape: 'roundtrip' | 'oneway'; spotId: string | null } | null,
  ) => void;
  reportSighting: (dogId: string) => Promise<{ ok: boolean; trusted?: boolean } | void>;
  // Detective quests. Start flips any existing active quest to abandoned
  // server-side. advance checks proximity to the current waypoint and
  // progresses (or completes). abandon closes the current one. Start +
  // advance return Claude-Haiku narration for the arriving bubble
  // (null on failure — caller falls back to a hardcoded line).
  syncActiveQuest: () => Promise<void>;
  startQuest: (
    dogId: string,
  ) => Promise<{ quest: Quest | null; narration: string | null }>;
  advanceQuestIfNear: (
    pos: LatLng,
  ) => Promise<{
    advanced: boolean;
    completed: boolean;
    narration: string | null;
  }>;
  // Tap-to-complete the current waypoint. Forces the server-side
  // distance check off — useful for walking through the flow at your
  // desk without simulating GPS.
  forceAdvanceActiveWaypoint: () => Promise<{
    advanced: boolean;
    completed: boolean;
    narration: string | null;
  }>;
  abandonActiveQuest: () => Promise<void>;
  // Optimistic local +N, then fire-and-forget POST /tasks/tick.
  tickDailyTask: (key: keyof Omit<DailyTasks, 'date'>, amount?: number) => void;
  // Authoritative pull from /tasks/today. Fired on first app load
  // and again when the map tab refocuses (catches midnight rollover
  // + cross-device updates). Replaces the previous client-side
  // refreshDailyTasksIfStale that only handled date staleness.
  refreshDailyTasks: () => Promise<void>;
}

export const useGameStore = create<GameState>((set, get) => ({
  hunger: balance.hunger.start,
  happiness: balance.happiness.start,
  tokensCollected: 0,
  points: 0,
  companionName: 'шукайпес',
  userPosition: null,
  homePosition: null,
  activeQuest: null,
  menuOpen: false,
  currentScreen: 'map',
  tokens: [],
  recentlyCollectedIds: new Set<string>(),
  recentlyConsumedIds: new Set<string>(),
  foodItems: [],
  parks: [],
  lastParksFetchPos: null,
  lostDogs: [],
  selectedDogId: null,
  spots: [],
  lastSpotsFetchPos: null,
  spotsLoading: false,
  selectedSpotId: null,
  // Default off — POIs only render once the user explicitly enables
  // the layer via the HUD toggle. Avoids cluttering the map at first
  // load with every nearby cafe and pet store.
  spotsVisible: false,
  spotsCategoryFilter: 'all',
  walkRoute: null,
  walkRouteMeta: null,
  // Initial state is empty for today's date; refreshDailyTasks() pulls
  // from the server on first app load and again on map-tab refocus.
  dailyTasks: blankTasks(),
  syncing: false,
  lastSyncError: null,
  collectPulse: 0,

  setUserPosition: (pos) =>
    set((s) => ({
      userPosition: pos,
      homePosition: s.homePosition ?? pos,
    })),

  setHomePosition: (pos) => set({ homePosition: pos }),

  collectToken: async (id, force = false) => {
    const { userPosition, tokens, recentlyCollectedIds } = get();
    // Short-circuit the moment we've started collecting this id — if the
    // 15s sync races ahead and brings the token back as uncollected, the
    // auto-collect loop would otherwise re-fire and produce +1/-1 thrash.
    if (recentlyCollectedIds.has(id)) return;
    const tok = tokens.find((t) => t.id === id);
    if (!tok || tok.collectedAt || !userPosition) return;
    // Optimistic UI + in-flight guard.
    set((s) => {
      const next = new Set(s.recentlyCollectedIds);
      next.add(id);
      return {
        recentlyCollectedIds: next,
        tokens: s.tokens.map((t) =>
          t.id === id ? { ...t, collectedAt: new Date().toISOString() } : t,
        ),
        tokensCollected: s.tokensCollected + 1,
        points: s.points + tok.value,
        collectPulse: s.collectPulse + 1,
      };
    });
    try {
      await api.collectToken(id, userPosition, force);
      get().tickDailyTask('tokens');
      // Pull fresh hunger/happiness so the meters reflect the +2/+5
      // bumps immediately rather than waiting for the 5s poll. Counter
      // can't go backwards: syncState's tokensCollected is Math.max
      // against local, so a stale /state response is harmless.
      void get().syncState();
    } catch (err) {
      // Revert ONLY counter + points. Keep the token flagged collected
      // locally and keep its id in recentlyCollectedIds — otherwise the
      // 100ms auto-collect loop sees it as uncollected again, refires
      // collectToken, server rejects (already-collected / too-far /
      // whatever), we roll back, loop refires … one failing token would
      // spin +1/-1 forever. The server is the source of truth; if it
      // already collected the token, our optimistic state was correct.
      set((s) => ({
        tokensCollected: Math.max(0, s.tokensCollected - 1),
        points: Math.max(0, s.points - tok.value),
        lastSyncError: (err as Error).message,
      }));
    }
  },

  eatFood: async (id, force = false) => {
    const { userPosition, foodItems, recentlyConsumedIds } = get();
    // Same in-flight guard as collectToken — auto-eat loop and a user
    // tap can both fire /feed for the same bone in the same 100ms
    // window. Without this, the second request would 409 and re-add
    // the bone, then next sync would remove it again — visible "blip
    // back" + no counter increment.
    if (recentlyConsumedIds.has(id)) return;
    const f = foodItems.find((x) => x.id === id);
    if (!f || !userPosition) return;
    set((s) => {
      const next = new Set(s.recentlyConsumedIds);
      next.add(id);
      return {
        recentlyConsumedIds: next,
        foodItems: s.foodItems.filter((x) => x.id !== id),
        collectPulse: s.collectPulse + 1,
      };
    });
    try {
      await api.feed(id, userPosition, force);
      get().tickDailyTask('bones');
      // syncState pulls fresh hunger/happiness so the +20/+8 bumps
      // land immediately. tokensCollected stays monotonic via Math.max.
      void get().syncState();
    } catch (err) {
      // Same shape as collectToken's error path: keep the Set entry
      // so the auto-eat loop doesn't refire, only surface the error.
      // Don't re-add the bone to foodItems — the next /food/nearby
      // poll reconciles authoritatively (server already 409'd, so
      // the bone is gone server-side).
      set({ lastSyncError: (err as Error).message });
    }
  },

  setMenuOpen: (menuOpen) => set({ menuOpen }),
  setScreen: (currentScreen) => set({ currentScreen }),
  setActiveQuest: (activeQuest) => set({ activeQuest }),

  syncActiveQuest: async () => {
    try {
      const { quest } = await api.getActiveQuest();
      // Server includes a `status` field alongside the shared Quest
      // shape. We only keep a quest in local state while it's active;
      // completed/abandoned ones live only as historical records.
      set({ activeQuest: quest && quest.status === 'active' ? quest : null });
    } catch (err) {
      set({ lastSyncError: (err as Error).message });
    }
  },

  startQuest: async (dogId) => {
    const { userPosition } = get();
    if (!userPosition) return { quest: null, narration: null };
    try {
      const { quest, narration } = await api.startQuest(dogId, userPosition);
      set({ activeQuest: quest.status === 'active' ? quest : null });
      return { quest, narration };
    } catch (err) {
      set({ lastSyncError: (err as Error).message });
      return { quest: null, narration: null };
    }
  },

  advanceQuestIfNear: async (pos) => {
    const { activeQuest } = get();
    if (!activeQuest) return { advanced: false, completed: false, narration: null };
    // Proximity check is re-done server-side with a 60m anti-cheat
    // radius; we gate the request client-side with a tighter 50m so
    // rapid jitter around the waypoint doesn't spam /advance.
    const waypoint = activeQuest.waypoints[activeQuest.currentWaypoint];
    if (!waypoint) return { advanced: false, completed: false, narration: null };
    const dLat = pos.lat - waypoint.position.lat;
    const dLng = pos.lng - waypoint.position.lng;
    const dM = Math.sqrt(
      dLat * dLat * 111_000 * 111_000 + dLng * dLng * 71_000 * 71_000,
    );
    if (dM > 50) return { advanced: false, completed: false, narration: null };
    try {
      const { quest, completed, narration } = await api.advanceQuest(
        activeQuest.id,
        pos,
      );
      set({
        activeQuest: !completed && quest.status === 'active' ? quest : null,
      });
      return { advanced: true, completed, narration };
    } catch (err) {
      const msg = (err as Error).message;
      if (!msg.includes('403')) set({ lastSyncError: msg });
      return { advanced: false, completed: false, narration: null };
    }
  },

  forceAdvanceActiveWaypoint: async () => {
    const { activeQuest, userPosition } = get();
    if (!activeQuest || !userPosition) {
      return { advanced: false, completed: false, narration: null };
    }
    try {
      const { quest, completed, narration } = await api.advanceQuest(
        activeQuest.id,
        userPosition,
        true,
      );
      set({
        activeQuest: !completed && quest.status === 'active' ? quest : null,
      });
      return { advanced: true, completed, narration };
    } catch (err) {
      set({ lastSyncError: (err as Error).message });
      return { advanced: false, completed: false, narration: null };
    }
  },

  abandonActiveQuest: async () => {
    const { activeQuest } = get();
    if (!activeQuest) return;
    set({ activeQuest: null });
    try {
      await api.abandonQuest(activeQuest.id);
    } catch (err) {
      // Best-effort — we already dropped it locally, no point re-injecting
      // an abandoned quest because of a transient server blip.
      set({ lastSyncError: (err as Error).message });
    }
  },

  syncState: async () => {
    set({ syncing: true });
    try {
      const s = await api.getState();
      set((prev) => ({
        points: s.user.points,
        // Monotonic. A stale /state response (commit not yet visible, or
        // arriving out of order after a later one) must not shrink the
        // counter — the optimistic path only ever adds, so the local
        // value is always a valid lower bound.
        tokensCollected: Math.max(prev.tokensCollected, s.user.totalTokens),
        hunger: s.companion.hunger,
        happiness: s.companion.happiness,
        companionName: s.companion.name,
        syncing: false,
        lastSyncError: null,
      }));
    } catch (err) {
      set({ syncing: false, lastSyncError: (err as Error).message });
    }
  },

  collectPath: async (pos) => {
    try {
      const res = await api.collectPath(pos);
      // If anything got swept, the server bumped points / counters /
      // companion stats — pull the fresh values so the HUD updates.
      if (res.tokensCollected > 0 || res.foodConsumed > 0) {
        void get().syncState();
      }
    } catch (err) {
      // Path collection is a convenience layer — don't surface a
      // failure as a hard error; the regular foreground auto-collect
      // still works.
      set({ lastSyncError: (err as Error).message });
    }
  },

  syncTokens: async (pos) => {
    try {
      // Pass the cached parks along so the server can seed paws around
      // them too. First sync (before parks load) just sends none — the
      // user-area + dog-zone pools still cover the screen.
      const parks = get().parks;
      const parkPositions = parks.map((p) => p.position);
      const { tokens } = await api.getTokensNearby(
        pos,
        parkPositions.length ? parkPositions : undefined,
      );
      const collected = get().recentlyCollectedIds;
      // Drop anything we've already collected locally — otherwise a poll
      // that races ahead of the server commit re-injects the token and
      // the auto-collect loop picks it up a second time.
      const filtered = collected.size
        ? tokens.filter((t) => !collected.has(t.id))
        : tokens;
      set({ tokens: filtered });
    } catch (err) {
      set({ lastSyncError: (err as Error).message });
    }
  },

  syncFood: async (pos) => {
    try {
      // Lazy-load parks on the first food sync, AND re-fetch when the
      // user has walked past the last fetch point by more than the
      // refresh threshold — Google Places returned the parks within
      // ~800m of the original anchor, so a long walk would otherwise
      // keep seeding bones in the wrong neighbourhood. The fetch is
      // ~one Places call per refresh; the threshold (600m) keeps the
      // round-trip count low.
      let parks = get().parks;
      const lastAt = get().lastParksFetchPos;
      const movedFar = lastAt
        ? distanceMeters(lastAt, pos) > PLACES_REFRESH_THRESHOLD_M
        : false;
      if (!parks.length || movedFar) {
        const fetched = await fetchNearbyParks(pos);
        if (fetched.length) {
          parks = fetched;
          set({ parks, lastParksFetchPos: pos });
        } else if (!parks.length) {
          // First-fetch failure (Places not loaded, fetch returned 0).
          // Don't update lastParksFetchPos so we retry next call.
        }
      }
      const { food } = await api.getFoodNearby(
        pos,
        parks.length ? parks.map((p) => p.position) : undefined,
      );
      // Same defense as syncTokens: drop server rows we've already
      // consumed locally so a poll racing ahead of /feed commit can't
      // re-inject a ghost bone.
      const consumed = get().recentlyConsumedIds;
      const filtered = consumed.size
        ? food.filter((f) => !consumed.has(f.id))
        : food;
      set({ foodItems: filtered });
    } catch (err) {
      set({ lastSyncError: (err as Error).message });
    }
  },

  syncLostDogs: async (pos) => {
    try {
      const { dogs } = await api.getLostDogsNearby(pos);
      set({ lostDogs: dogs });
    } catch (err) {
      set({ lastSyncError: (err as Error).message });
    }
  },

  syncMap: async (pos) => {
    // Lazy-fetch / refresh parks first so the bulk sync can pass them
    // along — same logic syncFood used to own. Places returns parks
    // within ~800m of the original anchor, so a long walk requires
    // a re-fetch past PLACES_REFRESH_THRESHOLD_M.
    let parks = get().parks;
    const lastAt = get().lastParksFetchPos;
    const movedFar = lastAt
      ? distanceMeters(lastAt, pos) > PLACES_REFRESH_THRESHOLD_M
      : false;
    if (!parks.length || movedFar) {
      try {
        const fetched = await fetchNearbyParks(pos);
        if (fetched.length) {
          parks = fetched;
          set({ parks, lastParksFetchPos: pos });
        }
      } catch {
        // Places transient — keep going with stale parks; server's
        // user-area + dog-zone pools still seed the map.
      }
    }

    try {
      const parkPositions = parks.map((p) => p.position);
      const res = await api.syncMap(pos, {
        parks: parkPositions.length ? parkPositions : undefined,
      });
      const collected = get().recentlyCollectedIds;
      const filteredTokens = collected.size
        ? res.tokens.filter((t) => !collected.has(t.id))
        : res.tokens;
      // Single set() so all four pieces of state land in one render
      // pass. Previously the four parallel sync* calls each fired
      // their own set, producing up to four re-renders per tick.
      set((prev) => ({
        tokens: filteredTokens,
        foodItems: res.food,
        lostDogs: res.dogs,
        points: res.state.user.points,
        tokensCollected: Math.max(prev.tokensCollected, res.state.user.totalTokens),
        hunger: res.state.companion.hunger,
        happiness: res.state.companion.happiness,
        companionName: res.state.companion.name,
        lastSyncError: null,
      }));
    } catch (err) {
      set({ lastSyncError: (err as Error).message });
    }
  },

  setSelectedDog: (selectedDogId) => {
    set({ selectedDogId });
    if (selectedDogId) get().tickDailyTask('lostPetChecks');
  },

  syncSpots: async (pos) => {
    // Skip the round-trip when the cache is fresh enough — Places is
    // pricey, and the spots tab calls this on every focus. Re-fetch
    // when the user has moved past the threshold OR we have nothing
    // cached at all.
    const lastAt = get().lastSpotsFetchPos;
    const movedFar = lastAt
      ? distanceMeters(lastAt, pos) > PLACES_REFRESH_THRESHOLD_M
      : false;
    if (get().spots.length > 0 && !movedFar) return;
    set({ spotsLoading: true });
    try {
      const spots = await fetchNearbySpots(pos);
      set({ spots, lastSpotsFetchPos: pos, spotsLoading: false });
    } catch (err) {
      set({ spotsLoading: false, lastSyncError: (err as Error).message });
    }
  },

  setSelectedSpot: (selectedSpotId) => {
    set({ selectedSpotId });
    if (selectedSpotId) get().tickDailyTask('spotVisits');
  },

  setSpotsVisible: (spotsVisible) => set({ spotsVisible }),
  setSpotsCategoryFilter: (spotsCategoryFilter) =>
    set((s) => ({
      spotsCategoryFilter,
      // Picking a specific category implies "show me cafes on the
      // map" — flip the layer on automatically. Switching back to
      // 'all' leaves whatever visibility state the user had.
      spotsVisible:
        spotsCategoryFilter !== 'all' ? true : s.spotsVisible,
    })),

  setWalkRoute: (walkRoute, walkRouteMeta) => set({ walkRoute, walkRouteMeta }),

  reportSighting: async (dogId) => {
    const { userPosition } = get();
    if (!userPosition) return;
    try {
      const res = await api.reportSighting(dogId, userPosition);
      get().tickDailyTask('sightings');
      // If the server accepted it as close-enough, the dog's last-seen
      // coord was refreshed — re-pull the nearby list so the pin moves
      // to match without waiting for the next 15s tick.
      if (res.trusted) await get().syncLostDogs(userPosition);
      return { ok: true, trusted: res.trusted };
    } catch (err) {
      set({ lastSyncError: (err as Error).message });
      return { ok: false };
    }
  },

  tickDailyTask: (key, amount = 1) => {
    const prev = get().dailyTasks;
    const today = todayLocal();
    // If we crossed midnight since the last tick, snap to a fresh
    // row before applying the increment. Server upsert will create
    // its own row at this date too.
    const base: DailyTasks =
      prev.date === today
        ? prev
        : { ...blankTasks(), date: today };
    const next: DailyTasks = { ...base, [key]: base[key] + amount };
    set({ dailyTasks: next });
    // Fire-and-forget — server is authoritative but we don't block
    // the UI on the round-trip. Failures show up only if the
    // refresh-on-focus pulls a different value back.
    void api.tickDailyTask(today, key, amount).catch(() => {});
  },

  refreshDailyTasks: async () => {
    const today = todayLocal();
    try {
      const { tasks } = await api.getDailyTasks(today);
      set({ dailyTasks: tasks });
    } catch {
      // Network blip — keep the local optimistic counts. The next
      // refresh-on-focus reconciles.
    }
    // One-time legacy localStorage cleanup. Cheap, idempotent.
    dropLegacyStorage();
  },
}));
