// Cross-surface haptic feedback.
//
// - In a Telegram Mini App we use Telegram's HapticFeedback API, which works
//   on iOS *and* Android (plain web `navigator.vibrate` is unsupported on
//   iOS Safari).
// - Elsewhere (Android web / PWA) we fall back to navigator.vibrate.
// - iOS Safari PWA outside Telegram has no web vibration API — it's a no-op.
//
// Always wrapped in try/catch — haptics are a nicety, never a hard dependency.

type HapticKind = 'light' | 'medium' | 'heavy' | 'success' | 'warning';

interface TgHaptics {
  impactOccurred?: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
  notificationOccurred?: (type: 'success' | 'warning' | 'error') => void;
}

function tgHaptics(): TgHaptics | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    Telegram?: { WebApp?: { HapticFeedback?: TgHaptics } };
  };
  return w.Telegram?.WebApp?.HapticFeedback ?? null;
}

export function haptic(kind: HapticKind = 'light'): void {
  try {
    const tg = tgHaptics();
    if (tg) {
      if (kind === 'success' || kind === 'warning') {
        tg.notificationOccurred?.(kind);
      } else {
        tg.impactOccurred?.(kind);
      }
      return;
    }
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (nav && typeof nav.vibrate === 'function') {
      const pattern =
        kind === 'success'
          ? [12, 40, 18]
          : kind === 'warning'
            ? [20, 60, 20]
            : kind === 'heavy'
              ? 40
              : kind === 'medium'
                ? 25
                : 12;
      nav.vibrate(pattern);
    }
  } catch {
    /* haptics are best-effort */
  }
}
