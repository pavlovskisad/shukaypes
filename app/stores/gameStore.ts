import { create } from 'zustand';
import { balance } from '../constants/balance';
import type { FoodItem, LatLng, Quest, Token } from '@shukajpes/shared';
import { api, type NearbyLostDog } from '../services/api';
import { fetchNearbySpots, type Spot } from '../services/places';

// Daily tasks — client-side for pilot; promote to server when we add
// server-auth'd quests. Each field is a monotonic counter for today;
// progress = min(counter, target). Reset when `date` flips vs local
// today. Persisted via localStorage on web; on native we'd wire
// AsyncStorage but native map is stubbed anyway, so ignoring for now.
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

const TASKS_STORAGE_KEY = 'shukajpes.dailyTasks.v1';

function loadTasks(): DailyTasks {
  const blank: DailyTasks = {
    date: todayLocal(),
    tokens: 0,
    bones: 0,
    lostPetChecks: 0,
    spotVisits: 0,
    sightings: 0,
  };
  if (typeof window === 'undefined' || !window.localStorage) return blank;
  try {
    const raw = window.localStorage.getItem(TASKS_STORAGE_KEY);
    if (!raw) return blank;
    const parsed = JSON.parse(raw) as DailyTasks;
    if (parsed.date !== todayLocal()) return blank;
    return parsed;
  } catch {
    return blank;
  }
}

function saveTasks(t: DailyTasks): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(t));
  } catch {
    // storage full / disabled — silently skip
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
  foodItems: FoodItem[];
  lostDogs: NearbyLostDog[];
  selectedDogId: string | null;
  spots: Spot[];
  spotsLoading: boolean;
  selectedSpotId: string | null;
  dailyTasks: DailyTasks;
  syncing: boolean;
  lastSyncError: string | null;

  setUserPosition: (pos: LatLng) => void;
  setHomePosition: (pos: LatLng) => void;
  collectToken: (id: string) => Promise<void>;
  eatFood: (id: string) => Promise<void>;
  setMenuOpen: (open: boolean) => void;
  setScreen: (screen: GameState['currentScreen']) => void;
  setActiveQuest: (quest: Quest | null) => void;
  syncState: () => Promise<void>;
  syncTokens: (pos: LatLng) => Promise<void>;
  syncFood: (pos: LatLng) => Promise<void>;
  syncLostDogs: (pos: LatLng) => Promise<void>;
  setSelectedDog: (id: string | null) => void;
  syncSpots: (pos: LatLng) => Promise<void>;
  setSelectedSpot: (id: string | null) => void;
  reportSighting: (dogId: string) => Promise<{ ok: boolean; trusted?: boolean } | void>;
  tickDailyTask: (key: keyof Omit<DailyTasks, 'date'>, amount?: number) => void;
  refreshDailyTasksIfStale: () => void;
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
  foodItems: [],
  lostDogs: [],
  selectedDogId: null,
  spots: [],
  spotsLoading: false,
  selectedSpotId: null,
  dailyTasks: loadTasks(),
  syncing: false,
  lastSyncError: null,

  setUserPosition: (pos) =>
    set((s) => ({
      userPosition: pos,
      homePosition: s.homePosition ?? pos,
    })),

  setHomePosition: (pos) => set({ homePosition: pos }),

  collectToken: async (id) => {
    const { userPosition, tokens } = get();
    const tok = tokens.find((t) => t.id === id);
    if (!tok || tok.collectedAt || !userPosition) return;
    // Optimistic UI.
    set((s) => ({
      tokens: s.tokens.map((t) =>
        t.id === id ? { ...t, collectedAt: new Date().toISOString() } : t,
      ),
      tokensCollected: s.tokensCollected + 1,
      points: s.points + tok.value,
    }));
    try {
      await api.collectToken(id, userPosition);
      get().tickDailyTask('tokens');
      await get().syncState();
    } catch (err) {
      set((s) => ({
        tokens: s.tokens.map((t) =>
          t.id === id ? { ...t, collectedAt: undefined } : t,
        ),
        tokensCollected: Math.max(0, s.tokensCollected - 1),
        points: Math.max(0, s.points - tok.value),
        lastSyncError: (err as Error).message,
      }));
    }
  },

  eatFood: async (id) => {
    const { userPosition, foodItems } = get();
    const f = foodItems.find((x) => x.id === id);
    if (!f || !userPosition) return;
    set((s) => ({ foodItems: s.foodItems.filter((x) => x.id !== id) }));
    try {
      await api.feed(id, userPosition);
      get().tickDailyTask('bones');
      await get().syncState();
    } catch (err) {
      set((s) => ({
        foodItems: [...s.foodItems, f],
        lastSyncError: (err as Error).message,
      }));
    }
  },

  setMenuOpen: (menuOpen) => set({ menuOpen }),
  setScreen: (currentScreen) => set({ currentScreen }),
  setActiveQuest: (activeQuest) => set({ activeQuest }),

  syncState: async () => {
    set({ syncing: true });
    try {
      const s = await api.getState();
      set({
        points: s.user.points,
        tokensCollected: s.user.totalTokens,
        hunger: s.companion.hunger,
        happiness: s.companion.happiness,
        companionName: s.companion.name,
        syncing: false,
        lastSyncError: null,
      });
    } catch (err) {
      set({ syncing: false, lastSyncError: (err as Error).message });
    }
  },

  syncTokens: async (pos) => {
    try {
      const { tokens } = await api.getTokensNearby(pos);
      set({ tokens });
    } catch (err) {
      set({ lastSyncError: (err as Error).message });
    }
  },

  syncFood: async (pos) => {
    try {
      const { food } = await api.getFoodNearby(pos);
      set({ foodItems: food });
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

  setSelectedDog: (selectedDogId) => {
    set({ selectedDogId });
    if (selectedDogId) get().tickDailyTask('lostPetChecks');
  },

  syncSpots: async (pos) => {
    set({ spotsLoading: true });
    try {
      const spots = await fetchNearbySpots(pos);
      set({ spots, spotsLoading: false });
    } catch (err) {
      set({ spotsLoading: false, lastSyncError: (err as Error).message });
    }
  },

  setSelectedSpot: (selectedSpotId) => {
    set({ selectedSpotId });
    if (selectedSpotId) get().tickDailyTask('spotVisits');
  },

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
    const base: DailyTasks =
      prev.date === today ? prev : { date: today, tokens: 0, bones: 0, lostPetChecks: 0, spotVisits: 0, sightings: 0 };
    const next: DailyTasks = { ...base, [key]: base[key] + amount };
    set({ dailyTasks: next });
    saveTasks(next);
  },

  refreshDailyTasksIfStale: () => {
    const prev = get().dailyTasks;
    if (prev.date === todayLocal()) return;
    const fresh: DailyTasks = {
      date: todayLocal(),
      tokens: 0,
      bones: 0,
      lostPetChecks: 0,
      spotVisits: 0,
      sightings: 0,
    };
    set({ dailyTasks: fresh });
    saveTasks(fresh);
  },
}));
