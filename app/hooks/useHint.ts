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

// Runtime "seen this session" set, shared across all useHint instances.
// Lets the SAME hint id mounted in two places (e.g. the swipe hint on
// both the dogs deck and the spots deck) fire on whichever surface the
// user hits first and NOT on the other — even when persist:false skips
// localStorage. Cleared on reload, like persist:false itself.
const seenThisSession = new Set<string>();

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
  const seenAtMountRef = useRef(
    (persist && hasBeenSeen(id)) || seenThisSession.has(id),
  );
  const [visible, setVisible] = useState(false);
  // Reactive copy of seenAtMountRef so consumers can sequence
  // hints on the same surface — "show hint B only after hint A
  // has been seen". Initial value matches the ref; flips true on
  // dismiss (manual or auto).
  const [seen, setSeen] = useState(seenAtMountRef.current);

  const markSeen_ = () => {
    seenAtMountRef.current = true;
    seenThisSession.add(id);
    if (persist) markSeen(id);
    setSeen(true);
  };

  // Call when the user performs the gesture the hint was about — hides
  // it and locks it seen.
  const dismiss = () => {
    setVisible(false);
    if (!seenAtMountRef.current) markSeen_();
  };

  // Show ONCE, the first time `ready` has stayed true through the show
  // delay. Crucially, the hint is marked seen the moment it actually
  // shows — so it never fires a second time, and a sibling instance
  // with the same id (e.g. the swipe hint on the other carousel) is
  // suppressed. `ready` flipping false before the delay elapses just
  // cancels the pending show; it restarts from zero next time ready
  // returns. Chaining ("show B after A") keys off `seen` + `visible`,
  // not a post-dismiss flag.
  useEffect(() => {
    if (seenAtMountRef.current || seenThisSession.has(id) || !ready) return;
    const showTimer = setTimeout(() => {
      markSeen_();
      setVisible(true);
    }, showDelayMs);
    return () => clearTimeout(showTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Auto-hide after the visible window. Purely visual — the hint is
  // already marked seen on show, so this only takes the bubble down.
  useEffect(() => {
    if (!visible || autoDismissMs == null) return;
    const t = setTimeout(() => setVisible(false), autoDismissMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  return { visible, dismiss, seen };
}
