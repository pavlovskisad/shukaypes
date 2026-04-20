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

const STATE_POLL_MS = 5000;

export function useGameLoop(onAmbient: (msg: string) => void) {
  const currentScreen = useGameStore((s) => s.currentScreen);

  // Server-authoritative state — poll every 5s while app is open.
  useEffect(() => {
    useGameStore.getState().syncState();
    const id = setInterval(() => {
      useGameStore.getState().syncState();
    }, STATE_POLL_MS);
    return () => clearInterval(id);
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
