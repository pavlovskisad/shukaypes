import { useEffect } from 'react';
import { balance } from '../constants/balance';
import { useGameStore } from '../stores/gameStore';
import { useStrings } from '../i18n/useStrings';

// 15s, not 5s, and skipped entirely on the map.
//
// MEASURED, not guessed: /state returns exactly the fifteen fields that
// /sync/map already nests under `state` — same keys, byte-identical
// values, verified against a running server. On the map the sync loop
// therefore delivers this every 15s anyway, and the 5s poll was 720
// requests an hour of pure duplication, at the one moment the user is
// outdoors on mobile data.
//
// It still runs on the other tabs, where nothing else refreshes the HUD.
const STATE_POLL_MS = 15000;

// A backgrounded tab is not a user. Phones spend most of a walk in a
// pocket with the screen off, and this loop happily polled through all of
// it — data, battery and server load spent on a screen nobody is looking
// at. `document.hidden` is undefined off web, where the guard is a no-op.
function appIsVisible(): boolean {
  if (typeof document === 'undefined') return true;
  return document.visibilityState !== 'hidden';
}

export function useGameLoop(onAmbient: (msg: string) => void) {
  const currentScreen = useGameStore((s) => s.currentScreen);
  // Localized ambient barks — was a hardcoded English array, which is
  // why English mutters leaked through regardless of language.
  const t = useStrings();
  const woofs = t.bubbles.woofs;

  // Server-authoritative state. One call on mount so a cold open is never
  // waiting on the interval, then only when it can actually tell us
  // something new: not while hidden, and not on the map, where /sync/map
  // is already carrying the identical payload.
  useEffect(() => {
    const tick = () => {
      if (!appIsVisible()) return;
      if (useGameStore.getState().currentScreen === 'map') return;
      void useGameStore.getState().syncState();
    };
    void useGameStore.getState().syncState();
    const id = setInterval(tick, STATE_POLL_MS);
    // Coming back to a hidden tab should feel instant rather than wait out
    // the rest of an interval — this is the one moment a user is looking
    // straight at stale numbers.
    const onVisible = () => {
      if (appIsVisible()) tick();
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisible);
    }
    return () => {
      clearInterval(id);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisible);
      }
    };
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
