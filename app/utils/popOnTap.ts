// Shared "pop on tap" gesture for any tappable chip / button.
// Same scale envelope and bezier curves as the snap-pop on the
// tab scroll cards, the carousel commit-pop, and the selected-
// POI marker — so every interactive element in the app belongs
// to one motion family.
//
// Usage:
//   onClick={(e) => { playPop(e.currentTarget); handler(); }}
//
// Or with a Pressable (RN):
//   <Pressable onPress={() => handler()} onPressIn={popPressableTarget} />
//
// Web-only. Returns silently on native or if the element doesn't
// support .animate (very old browsers).

const POP_KEYFRAMES = [
  { transform: 'scale(0.92)', offset: 0, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' },
  { transform: 'scale(1.12)', offset: 0.4, easing: 'cubic-bezier(0.33, 1, 0.68, 1)' },
  { transform: 'scale(1)', offset: 1 },
];

const POP_OPTIONS: KeyframeAnimationOptions = {
  duration: 460,
  fill: 'none',
};

export function playPop(el: HTMLElement | null | undefined): void {
  if (!el || typeof el.animate !== 'function') return;
  el.animate(POP_KEYFRAMES, POP_OPTIONS);
}

// Convenience for RN's Pressable — its onPressIn receives a
// GestureResponderEvent; we reach for the underlying DOM node
// via target. On web, RN-Web exposes the real HTMLElement.
export function popPressableEvent(e: { target?: unknown }): void {
  const target = e?.target;
  if (target && typeof (target as HTMLElement).animate === 'function') {
    playPop(target as HTMLElement);
  }
}
