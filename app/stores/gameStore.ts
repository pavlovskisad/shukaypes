import { create } from 'zustand';
import { balance } from '../constants/balance';
import type { FoodItem, LatLng, Quest, Token } from '@shukajpes/shared';

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

  setUserPosition: (pos: LatLng) => void;
  setHomePosition: (pos: LatLng) => void;
  collectToken: (id: string) => void;
  eatFood: (id: string) => void;
  startQuestBoost: () => void;
  walkBoost: () => void;
  decayTick: () => void;
  setMenuOpen: (open: boolean) => void;
  setScreen: (screen: GameState['currentScreen']) => void;
  setActiveQuest: (quest: Quest | null) => void;
  seedTokens: (tokens: Token[]) => void;
  seedFood: (items: FoodItem[]) => void;
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));

export const useGameStore = create<GameState>((set) => ({
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

  setUserPosition: (pos) =>
    set((s) => ({
      userPosition: pos,
      homePosition: s.homePosition ?? pos,
    })),

  setHomePosition: (pos) => set({ homePosition: pos }),

  collectToken: (id) =>
    set((s) => {
      const tok = s.tokens.find((t) => t.id === id);
      if (!tok || tok.collectedAt) return s;
      return {
        tokens: s.tokens.map((t) =>
          t.id === id ? { ...t, collectedAt: new Date().toISOString(), collectedBy: 'me' } : t
        ),
        tokensCollected: s.tokensCollected + 1,
        points: s.points + tok.value,
        hunger: clamp(s.hunger + balance.token.hunger),
        happiness: clamp(s.happiness + balance.token.happiness),
      };
    }),

  eatFood: (id) =>
    set((s) => {
      const f = s.foodItems.find((x) => x.id === id);
      if (!f) return s;
      return {
        foodItems: s.foodItems.filter((x) => x.id !== id),
        hunger: clamp(s.hunger + balance.bone.hunger),
        happiness: clamp(s.happiness + balance.bone.happiness),
      };
    }),

  startQuestBoost: () =>
    set((s) => ({ happiness: clamp(s.happiness + balance.searchQuest.happiness) })),

  walkBoost: () =>
    set((s) => ({ happiness: clamp(s.happiness + balance.walk.happiness) })),

  decayTick: () =>
    set((s) => ({
      hunger: clamp(s.hunger - balance.hunger.decay),
      happiness: clamp(s.happiness - balance.happiness.decay),
    })),

  setMenuOpen: (menuOpen) => set({ menuOpen }),
  setScreen: (currentScreen) => set({ currentScreen }),
  setActiveQuest: (activeQuest) => set({ activeQuest }),
  seedTokens: (tokens) => set({ tokens }),
  seedFood: (foodItems) => set({ foodItems }),
}));
