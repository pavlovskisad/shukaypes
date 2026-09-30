import { useEffect, useRef } from 'react';
import { setTelegramBackButton } from '../services/telegram';

// Back and Escape close the TOP open sheet, not the app (UX-2.5, UX-14.1).
//
// Without this, Android's back (in Telegram, or a browser) went straight
// past every open sheet: in Telegram it closed the whole Mini App and a
// half-typed lost-pet report went with it; on the web it changed tab and
// left the sheet painted over the tab it landed on. And Escape closed
// only the account sheet.
//
// One module-level stack, because sheets nest (a post over a pet's
// card) and only the top one may answer a press. Each open sheet
// registers while `open` is true; `onBack` is read at press time, so a
// sheet may pass a function that refuses (a report on the wire) or asks
// first (unsaved edits) — whatever its own «close» does.
//
// Three channels, one stack:
//   - Escape, everywhere (desktop, Telegram Desktop).
//   - Telegram: the SDK's BackButton, shown while any sheet is open. It
//     is also what Android's hardware back fires while it is shown.
//   - Plain web / installed PWA: one history entry per open sheet, so
//     the browser's back pops that entry and we close the sheet.
//
// The web half has to live beside expo-router, which owns the history
// stack and resets its navigation state from `history.state.id` on
// every popstate. So an entry we push copies the router's state object
// (same id, same URL) and only adds a marker: when the router sees our
// pop it finds its own current entry and resets to where it already is.
// Sheets closed from inside (a close pill, a pick) take their entry back
// off with history.back() — deferred a tick and only if the entry is
// still the current one, because a pick that also navigates has the
// router push a new entry on top in the same commit, and backing out of
// THAT would undo the navigation. A buried entry costs one dead back
// press; undoing a navigation would cost the user their place.
//
// An entry is pushed a beat AFTER its sheet opens, never in the same
// commit, because a pick can open a sheet and navigate at once — tap a
// cafe on the spots tab and MapView, mounted behind the tab, opens its
// card while the router is still leaving /spots. When the map is the
// entry just below (the usual way to reach /spots), expo-router does not
// push '/': it steps back to it with history.go(-1) and replaces the URL
// once the popstate lands. Our entry, pushed in the same commit, was the
// one that go(-1) stepped off; onPopState took that for the user's back
// and closed the card before it was ever seen. So the push waits for the
// router: a macrotask (the commit, and with it the router's go(), has
// finished) and then SETTLE_MS, which is the router's own bound on how
// long a popstate may take (see createMemoryHistory's 100 ms timeout in
// expo-router — past it the router gives up and replaces anyway).

interface Entry {
  id: number;
  back: { current: (() => void) | undefined };
  pushed: boolean;
}

const MARK = '__sheet';
// See the header: how long a router's history.go() may still be in
// flight after the commit that called it.
const SETTLE_MS = 100;
const stack: Entry[] = [];
let nextId = 1;
// Pops we caused ourselves with history.back(), not the user's.
let ownPops = 0;
let listening = false;
// Decided on first open: Telegram's button when there is one, the
// browser's history otherwise.
let viaTelegram: boolean | null = null;

function pressTop(): void {
  stack[stack.length - 1]?.back.current?.();
}

function webHistory(): History | null {
  return typeof window !== 'undefined' && window.history ? window.history : null;
}

function currentMark(): unknown {
  const state = webHistory()?.state as Record<string, unknown> | null | undefined;
  return state?.[MARK];
}

function pushEntry(entry: Entry): void {
  const h = webHistory();
  if (!h) return;
  try {
    const state = (h.state as Record<string, unknown> | null) ?? {};
    h.pushState({ ...state, [MARK]: entry.id }, '');
    entry.pushed = true;
  } catch {
    /* no history (sandboxed frame): Escape and the close pills remain */
  }
}

// Push the entry once any navigation the same commit started has
// landed (see the header). Skipped if the sheet closed meanwhile — a back
// press inside the window then goes to the router, as it would have
// before the sheet opened.
function schedulePush(entry: Entry): void {
  setTimeout(() => {
    setTimeout(() => {
      if (stack.includes(entry) && !entry.pushed && !viaTelegram) pushEntry(entry);
    }, SETTLE_MS);
  }, 0);
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || stack.length === 0) return;
  e.preventDefault();
  pressTop();
}

function onPopState(): void {
  if (ownPops > 0) {
    ownPops -= 1;
    return;
  }
  if (viaTelegram) return;
  // Every sheet above the entry we landed on has lost its entry. Almost
  // always that is just the top one.
  const mark = currentMark();
  const at = stack.findIndex((e) => e.id === mark);
  const popped = stack
    .slice(at + 1)
    .filter((e) => e.pushed)
    .reverse();
  for (const entry of popped) {
    entry.pushed = false;
    entry.back.current?.();
    // A sheet asked to close by back may decline (unsaved edits, a report
    // on the wire) and stay open. Its entry is already gone, so put one
    // back, or the NEXT back would go past it. (Closed, it has left the
    // stack by then and nothing is pushed.)
    schedulePush(entry);
  }
}

function listen(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('popstate', onPopState);
}

function register(entry: Entry): void {
  listen();
  stack.push(entry);
  if (viaTelegram === null) viaTelegram = setTelegramBackButton(pressTop);
  else if (viaTelegram) setTelegramBackButton(pressTop);
  if (!viaTelegram) schedulePush(entry);
}

function unregister(entry: Entry): void {
  const i = stack.indexOf(entry);
  if (i >= 0) stack.splice(i, 1);
  if (viaTelegram) {
    if (stack.length === 0) setTelegramBackButton(null);
    return;
  }
  if (!entry.pushed) return;
  entry.pushed = false;
  setTimeout(() => {
    const h = webHistory();
    if (!h || currentMark() !== entry.id) return;
    ownPops += 1;
    h.back();
  }, 0);
}

export function useSheetBack(open: boolean, onBack: (() => void) | undefined): void {
  const backRef = useRef(onBack);
  backRef.current = onBack;
  useEffect(() => {
    if (!open) return;
    const entry: Entry = { id: nextId++, back: backRef, pushed: false };
    register(entry);
    return () => unregister(entry);
  }, [open]);
}
