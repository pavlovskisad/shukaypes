import { create } from 'zustand';
import { balance } from '../constants/balance';
import type { LatLng, Quest } from '@shukajpes/shared';

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

  setUserPosition: (pos: LatLng) => void;
  setHomePosition: (pos: LatLng) => void;
  collectToken: (value?: number) => void;
  eatFood: () => void;
  startQuestBoost: () => void;
  walkBoost: () => void;
  decayTick: () => void;
  setMenuOpen: (open: boolean) => void;
  setScreen: (screen: GameState['currentScreen']) => void;
  setActiveQuest: (quest: Quest | null) => void;
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

  setUserPosition: (pos) =>
    set((s) => ({
      userPosition: pos,
      homePosition: s.homePosition ?? pos,
    })),

  setHomePosition: (pos) => set({ homePosition: pos }),

  collectToken: (value = 1) =>
    set((s) => ({
      tokensCollected: s.tokensCollected + 1,
      points: s.points + value,
      hunger: clamp(s.hunger + balance.token.hunger),
      happiness: clamp(s.happiness + balance.token.happiness),
    })),

  eatFood: () =>
    set((s) => ({
      hunger: clamp(s.hunger + balance.bone.hunger),
      happiness: clamp(s.happiness + balance.bone.happiness),
    })),

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
}));
