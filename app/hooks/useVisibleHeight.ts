// The height of what the person can actually see, in CSS px.
//
// MEASURED, NOT `vh`. On iOS Safari `vh` is the height with the
// toolbars hidden, so a share of it is more than the same share of
// what is really on screen — the account sheet learned this the hard
// way, landing its paper on top of the dog.
//
// Read at mount and on orientation change, NOT on every resize: the
// keyboard opening is a resize, and a layout that shrinks under the
// person's own thumb is worse than one that is briefly too tall.
//
// Lived inside AccountDoor until the tasks tab needed it too, for the
// same question in a different place (how tall is one snap-card?).
// AccountDoor still re-exports it so its own callers are unchanged.

import { useEffect, useState } from 'react';

export function useVisibleHeight(): number {
  const [h, setH] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 800));
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const on = () => setH(window.innerHeight);
    window.addEventListener('orientationchange', on);
    return () => window.removeEventListener('orientationchange', on);
  }, []);
  return h;
}
