import { create } from 'zustand';
import { balance } from '../constants/balance';
import type { FoodItem, LatLng, Quest, Token } from '@shukajpes/shared';
import { api, type NearbyLostDog } from '../services/api';
import { fetchNearbySpots, type Spot } from '../services/places';

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

  setSelectedDog: (selectedDogId) => set({ selectedDogId }),

  syncSpots: async (pos) => {
    set({ spotsLoading: true });
    try {
      const spots = await fetchNearbySpots(pos);
      set({ spots, spotsLoading: false });
    } catch (err) {
      set({ spotsLoading: false, lastSyncError: (err as Error).message });
    }
  },

  setSelectedSpot: (selectedSpotId) => set({ selectedSpotId }),
}));
