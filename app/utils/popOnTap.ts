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
  { transform: 'scale(1.15)', offset: 0.4, easing: 'cubic-bezier(0.33, 1, 0.68, 1)' },
  { transform: 'scale(1)', offset: 1 },
];

// 240 ms total — short enough that elements which unmount
// immediately after tap (modal close X, radial menu item,
// card → modal) still show a visible chunk of the pop
// before they're gone. Peak at 40 % → ~96 ms, which is
// inside any reasonable React re-render window.
const POP_OPTIONS: KeyframeAnimationOptions = {
  duration: 240,
  fill: 'none',
};

// Defer used by playPopThen — long enough for the pop's
// peak (~96 ms) to render before the action triggers an
// unmount, short enough to still feel instant.
const POP_DEFER_MS = 120;

export function playPop(el: HTMLElement | null | undefined): void {
  if (!el || typeof el.animate !== 'function') return;
  el.animate(POP_KEYFRAMES, POP_OPTIONS);
}

// Pop the element AND defer the action by ~120 ms so the pop's
// peak frames render before the action causes the element to
// unmount or animate-out (modal closes, radial collapses, card
// → modal transition, etc.). Without the defer the pop is
// effectively invisible on unmount-triggering taps.
//
// Use sparingly — only for actions that obviously remove the
// tapped element. Regular actions should use playPop() with
// no defer so the UI stays snappy.
export function playPopThen(
  el: HTMLElement | null | undefined,
  action: () => void,
): void {
  playPop(el);
  setTimeout(action, POP_DEFER_MS);
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
