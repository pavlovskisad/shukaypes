// Cross-surface haptic feedback.
//
// - In a Telegram Mini App we use Telegram's HapticFeedback API, which works
//   on iOS *and* Android (plain web `navigator.vibrate` is unsupported on
//   iOS Safari).
// - Elsewhere with the Vibration API (Android web / PWA) we use
//   navigator.vibrate.
// - iOS Safari / installed PWA has NO web vibration API, so as a last resort
//   we use the "switch toggle" trick: iOS 17.4+ fires a subtle native haptic
//   when a <input type="checkbox" switch> flips, so we flip a hidden one.
//   Must run inside a user gesture (poke = a tap, so we're fine). Best-effort:
//   silent no-op on older iOS / desktop Safari.
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

// Lazily-created hidden iOS switch. Toggling it fires a subtle native haptic
// on iOS 17.4+ Safari — the only way to get any buzz there. Reused across
// calls; kept rendered (offscreen, not display:none) so iOS actually toggles it.
let iosSwitchEl: HTMLInputElement | null = null;
function iosSwitchHaptic(): void {
  if (typeof document === 'undefined') return;
  if (!iosSwitchEl) {
    const label = document.createElement('label');
    label.setAttribute('aria-hidden', 'true');
    label.style.cssText =
      'position:fixed;top:-40px;left:-40px;width:8px;height:8px;opacity:0;pointer-events:none;';
    const input = document.createElement('input');
    input.type = 'checkbox';
    // The `switch` attribute is what makes iOS render/handle it as a toggle
    // (and emit the haptic on flip).
    input.setAttribute('switch', '');
    label.appendChild(input);
    (document.body ?? document.documentElement).appendChild(label);
    iosSwitchEl = input;
  }
  // A synthetic click flips the switch → iOS emits the toggle haptic.
  iosSwitchEl.click();
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
      return;
    }
    // No Telegram, no Vibration API → iOS Safari/PWA. Try the switch hack.
    iosSwitchHaptic();
  } catch {
    /* haptics are best-effort */
  }
}
