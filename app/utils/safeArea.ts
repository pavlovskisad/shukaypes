// Safe-area insets in CSS px, measured once via an env() probe —
// SafeAreaView values aren't reachable on web, and the inset differs
// between a browser tab (0) and an installed PWA (the notch, the home
// indicator). Cached: the probe is a DOM append + measure, and the
// answer does not change while the page lives.
const cached: { top: number | null; bottom: number | null } = { top: null, bottom: null };

function probe(side: 'top' | 'bottom'): number {
  if (typeof document === 'undefined') return 0;
  try {
    const el = document.createElement('div');
    el.style.cssText =
      `position:fixed;top:0;height:0;padding-${side}:env(safe-area-inset-${side}, 0px);` +
      'visibility:hidden;pointer-events:none;';
    document.body.appendChild(el);
    const h = el.getBoundingClientRect().height;
    el.remove();
    return h;
  } catch {
    return 0;
  }
}

export function safeAreaTopPx(): number {
  if (cached.top == null) cached.top = probe('top');
  return cached.top;
}

export function safeAreaBottomPx(): number {
  if (cached.bottom == null) cached.bottom = probe('bottom');
  return cached.bottom;
}
