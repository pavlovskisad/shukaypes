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
//     // optional — gate the hint's show / dismiss timers behind a
//     // predicate. While `ready` is false the timers are paused;
//     // they (re)start once it flips true. Lets a hint wait for
//     // the dog's greeting bubble to clear before counting down.
//     ready: !bubble && !localBubble,
//     // optional — auto-dismiss after this many ms of actually-
//     // ready time. null = stay until dismiss() called.
//     autoDismissMs: 6000,
//     // optional — initial delay (from the moment `ready` first
//     // turns true) before the hint appears.
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
  // Auto-dismiss after this many ms of actually-ready time.
  // Default 5000. Pass null to disable.
  autoDismissMs?: number | null;
  // Wait this long (after `ready` first turns true) before
  // showing. Default 0.
  showDelayMs?: number;
  // Predicate gating the hint's timers. While false the show
  // delay + auto-dismiss don't run; flipping to true starts /
  // restarts them. Default true (always ready).
  ready?: boolean;
  // When false, the hint does NOT persist its seen-flag to
  // localStorage — it fires fresh on every mount / reload.
  // Useful while iterating on the hint's wording / timing /
  // appearance so you don't have to wipe storage between runs.
  // Flip to true (the default) once the hint's behaviour is
  // settled and we want it to be one-shot per device.
  persist?: boolean;
}

export function useHint(id: string, opts: Options = {}) {
  const {
    autoDismissMs = 5000,
    showDelayMs = 0,
    ready = true,
    persist = true,
  } = opts;
  const seenAtMountRef = useRef(persist ? hasBeenSeen(id) : false);
  const [visible, setVisible] = useState(false);

  const dismiss = () => {
    if (seenAtMountRef.current) return;
    seenAtMountRef.current = true;
    if (persist) markSeen(id);
    setVisible(false);
  };

  // Timers (re)start whenever `ready` flips true, so a hint
  // can wait for greeting bubbles / modals / etc. to clear
  // before its show countdown begins. Going from ready=true
  // → ready=false during the show delay just cancels the
  // timers; a subsequent ready=true restarts from zero.
  useEffect(() => {
    if (seenAtMountRef.current || !ready) return;
    const showTimer = setTimeout(() => {
      setVisible(true);
    }, showDelayMs);
    let autoTimer: ReturnType<typeof setTimeout> | null = null;
    if (autoDismissMs != null) {
      autoTimer = setTimeout(() => {
        if (!seenAtMountRef.current) {
          seenAtMountRef.current = true;
          if (persist) markSeen(id);
          setVisible(false);
        }
      }, showDelayMs + autoDismissMs);
    }
    return () => {
      clearTimeout(showTimer);
      if (autoTimer) clearTimeout(autoTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  return { visible, dismiss };
}
