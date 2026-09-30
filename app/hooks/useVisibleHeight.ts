// The height of what the person can actually see, in CSS px.
//
// MEASURED, NOT `vh`. On iOS Safari `vh` is the height with the
// toolbars hidden, so a share of it is more than the same share of
// what is really on screen — the account sheet learned this the hard
// way, landing its paper on top of the dog.
//
// Read at mount, on orientation change, on a resize that is NOT the
// keyboard, and when Telegram's sheet settles at a new height (UX-12.14).
// The keyboard opening is a resize too, and a layout that shrinks under
// the person's own thumb is worse than one that is briefly too tall — so
// a resize while a text field has focus is ignored. Anything else (a
// desktop window dragged, the Mini App expanded to full height, split
// screen) used to leave every card sized for the old window.
//
// Lived inside AccountDoor until the tasks tab needed it too, for the
// same question in a different place (how tall is one snap-card?).
// AccountDoor still re-exports it so its own callers are unchanged.

import { useEffect, useState } from 'react';
import { onTelegramViewportSettled } from '../services/telegram';

// A text field has focus, so the resize in hand is (almost certainly)
// the on-screen keyboard coming or going.
function typing(): boolean {
  const el = typeof document !== 'undefined' ? document.activeElement : null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable;
}

export function useVisibleHeight(): number {
  const [h, setH] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 800));
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const on = () => setH(window.innerHeight);
    const onResize = () => {
      if (!typing()) on();
    };
    window.addEventListener('orientationchange', on);
    window.addEventListener('resize', onResize);
    const offTelegram = onTelegramViewportSettled(onResize);
    return () => {
      window.removeEventListener('orientationchange', on);
      window.removeEventListener('resize', onResize);
      offTelegram();
    };
  }, []);
  return h;
}
