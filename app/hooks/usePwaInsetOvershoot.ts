import { useSafeAreaInsets } from 'react-native-safe-area-context';

// In an installed PWA (display-mode: standalone) the home-screen webview
// leaves the bottom home-indicator strip uncovered with plain height
// units, so public/index.html sizes the root to
//   calc(100dvh + env(safe-area-inset-bottom))
// to make the world bleed all the way through that strip. The side effect
// is that the layout's bottom edge now sits BELOW the visible screen by
// exactly that inset. Any element anchored to the bottom (the floating
// tab bar, the chat input band, the profile stat deck) therefore has to
// add this overshoot to its `bottom` offset, or it lands too low —
// flush against / under the home indicator.
//
// Returns 0 everywhere the root is NOT extended: a normal browser tab and
// the Telegram Mini App (display-mode: browser), where the standalone
// media query in index.html doesn't apply.
export function usePwaInsetOvershoot(): number {
  const insets = useSafeAreaInsets();
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 0;
  }
  return window.matchMedia('(display-mode: standalone)').matches
    ? insets.bottom
    : 0;
}
