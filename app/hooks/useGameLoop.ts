import { useEffect } from 'react';
import { balance } from '../constants/balance';
import { useGameStore } from '../stores/gameStore';
import { useStrings } from '../i18n/useStrings';

const STATE_POLL_MS = 5000;

export function useGameLoop(onAmbient: (msg: string) => void) {
  const currentScreen = useGameStore((s) => s.currentScreen);
  // Localized ambient barks — was a hardcoded English array, which is
  // why English mutters leaked through regardless of language.
  const t = useStrings();
  const woofs = t.bubbles.woofs;

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
      const { menuOpen, activeHint } = useGameStore.getState();
      if (menuOpen) return;
      // Don't talk over an onboarding hint — let the hint own the
      // bubble while it's showing.
      if (activeHint) return;
      if (Math.random() > balance.ambientChance) return;
      const msg = woofs[Math.floor(Math.random() * woofs.length)] ?? '*sniff*';
      onAmbient(msg);
    }, balance.ambientInterval);

    return () => clearInterval(ambient);
  }, [currentScreen, onAmbient, woofs]);
}
