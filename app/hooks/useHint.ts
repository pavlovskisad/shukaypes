// Tiny one-shot hint system. Each hint is identified by a stable
// `id` and shown at most once per device — the dismiss / first
// interaction writes a flag to localStorage and the hint never
// fires again.
//
// Web-only storage for now; native fallback ships when AsyncStorage
// is wired (same swap as services/deviceId.ts).
//
// Usage:
//   const sniffHint = useHint('map:long-press-to-sniff', {
//     // optional — auto-dismiss after this many ms even if user
//     // doesn't interact. null = stay until dismiss() called.
//     autoDismissMs: 5000,
//     // optional — initial delay before the hint appears (so it
//     // doesn't slap the user the instant they open the screen).
//     showDelayMs: 1200,
//   });
//   if (sniffHint.visible) {
//     return <SpeechBubble text="затисни щоб понюхати 🐾" />;
//   }
//
// On the consuming side, call sniffHint.dismiss() when the user
// performs the gesture the hint was about — that marks it seen
// AND hides it immediately.

import { useEffect, useRef, useState } from 'react';

const STORAGE_PREFIX = 'hint:';
const SEEN_VALUE = '1';

function hasBeenSeen(id: string): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + id) === SEEN_VALUE;
  } catch {
    return false;
  }
}

function markSeen(id: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + id, SEEN_VALUE);
  } catch {
    /* private mode / quota / etc — best effort */
  }
}

interface Options {
  // Auto-dismiss after this many ms even with no user interaction.
  // Default 5000. Pass null to disable.
  autoDismissMs?: number | null;
  // Wait this long before showing. Default 0. Useful when a screen
  // has its own enter animation and you want the hint to appear
  // after things settle.
  showDelayMs?: number;
}

export function useHint(id: string, opts: Options = {}) {
  const { autoDismissMs = 5000, showDelayMs = 0 } = opts;
  // Seen state initialised once from storage. Bail-out early if
  // already seen so the show / auto-dismiss timers never start.
  const seenAtMountRef = useRef(hasBeenSeen(id));
  const [visible, setVisible] = useState(false);

  const dismiss = () => {
    if (seenAtMountRef.current) return;
    seenAtMountRef.current = true;
    markSeen(id);
    setVisible(false);
  };

  useEffect(() => {
    if (seenAtMountRef.current) return;
    const showTimer = setTimeout(() => {
      setVisible(true);
    }, showDelayMs);
    let autoTimer: ReturnType<typeof setTimeout> | null = null;
    if (autoDismissMs != null) {
      autoTimer = setTimeout(() => {
        // Mark seen even on auto-dismiss — we showed the hint
        // for the full window, that counts as "user had a chance
        // to see it".
        if (!seenAtMountRef.current) {
          seenAtMountRef.current = true;
          markSeen(id);
          setVisible(false);
        }
      }, showDelayMs + autoDismissMs);
    }
    return () => {
      clearTimeout(showTimer);
      if (autoTimer) clearTimeout(autoTimer);
    };
    // id + opts are stable across the lifetime of a hint usage;
    // re-running the effect on every render would reset the show
    // delay and dismiss timers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { visible, dismiss };
}
