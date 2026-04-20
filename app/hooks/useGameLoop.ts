import { useEffect } from 'react';
import { balance } from '../constants/balance';
import { useGameStore } from '../stores/gameStore';

const AMBIENT_MESSAGES = [
  'nice street…',
  '*sniff sniff*',
  'ooh',
  'hmm',
  'good walk',
];

export function useGameLoop(onAmbient: (msg: string) => void) {
  const currentScreen = useGameStore((s) => s.currentScreen);

  useEffect(() => {
    const decay = setInterval(() => {
      useGameStore.getState().decayTick();
    }, balance.hunger.interval);

    return () => clearInterval(decay);
  }, []);

  useEffect(() => {
    if (currentScreen !== 'map') return;

    const ambient = setInterval(() => {
      const menuOpen = useGameStore.getState().menuOpen;
      if (menuOpen) return;
      if (Math.random() > balance.ambientChance) return;
      const msg = AMBIENT_MESSAGES[Math.floor(Math.random() * AMBIENT_MESSAGES.length)]!;
      onAmbient(msg);
    }, balance.ambientInterval);

    return () => clearInterval(ambient);
  }, [currentScreen, onAmbient]);
}
