// Telegram Mini App helpers. When the app runs inside Telegram,
// window.Telegram.WebApp.initData is a signed payload our server
// verifies (see server/src/services/telegramAuth.ts). Outside
// Telegram window.Telegram is undefined; every helper returns null
// so the existing device-id auth path runs unchanged.

interface TelegramSafeAreaInset {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface TelegramWebApp {
  initData: string;
  // start_param comes from the t.me/<bot>?startapp=<param> deep link —
  // the bot's lost-pet reply embeds 'lost-<id>' there so the app can
  // open straight to that dog's pin instead of dropping the user on
  // the generic map.
  initDataUnsafe?: {
    user?: { id?: number; first_name?: string; username?: string };
    start_param?: string;
  };
  ready: () => void;
  expand: () => void;
  // Layout helpers — present on TG WebApp SDK ≥ 7.x. We feature-detect
  // before calling so older clients don't throw.
  disableVerticalSwipes?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  safeAreaInset?: TelegramSafeAreaInset;
  contentSafeAreaInset?: TelegramSafeAreaInset;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function getTelegramWebApp(): TelegramWebApp | null {
  if (typeof window === 'undefined') return null;
  return window.Telegram?.WebApp ?? null;
}

export function getTelegramInitData(): string | null {
  const wa = getTelegramWebApp();
  if (!wa || !wa.initData || wa.initData.length === 0) return null;
  return wa.initData;
}

export function isInTelegram(): boolean {
  return getTelegramInitData() !== null;
}

// Mini App was opened via t.me/<bot>?startapp=<param>. The bot uses
// this to deep-link into a specific lost-pet pin (e.g. 'lost-<id>').
// Returns null outside Telegram, or when the app was opened cold.
export function getTelegramStartParam(): string | null {
  const wa = getTelegramWebApp();
  const raw = wa?.initDataUnsafe?.start_param;
  return raw && raw.length > 0 ? raw : null;
}

// Safe-area inset Telegram reports for the Mini App sheet. Differs
// from iOS's CSS env(safe-area-inset-*) because TG's own chrome eats
// part of the top. We layer this on top of insets we already read
// from react-native-safe-area-context elsewhere.
export function getTelegramSafeAreaInset(): TelegramSafeAreaInset | null {
  const wa = getTelegramWebApp();
  if (!wa) return null;
  // contentSafeAreaInset is the newer (more accurate) field; fall
  // back to safeAreaInset on older SDKs.
  return wa.contentSafeAreaInset ?? wa.safeAreaInset ?? null;
}

// Pick the bottom inset to use for floating UI (tab bar, chat input).
// In TG Mini App, TG manages the area under the home indicator itself
// so iOS's env(safe-area-inset-bottom) reports a strip that isn't
// actually ours to pad for — using it doubles the inset and pushes
// the tab bar's anchor below TG's content area. Caller passes in the
// iOS inset (from useSafeAreaInsets) as the fallback for plain web.
export function pickBottomInset(iosBottom: number): number {
  const tg = getTelegramSafeAreaInset();
  if (tg) return tg.bottom;
  return iosBottom;
}

// Same idea for the top: when in TG, TG's chrome strip takes the top
// so the inset should come from TG, not iOS's status-bar env.
export function pickTopInset(iosTop: number): number {
  const tg = getTelegramSafeAreaInset();
  if (tg) return tg.top;
  return iosTop;
}

// Configure Mini App chrome to match our brand + smooth the seam.
// Called once at app boot from app/_layout.tsx.
export function notifyTelegramReady(): void {
  const wa = getTelegramWebApp();
  if (!wa) return;
  try {
    wa.ready();
    // expand() opens the Mini App to full height of the TG sheet so
    // we don't render in the short default ~50% window.
    wa.expand();
    // Without this, swiping the map vertically triggers TG's
    // 'swipe down to close' gesture — every map pan would close
    // the app. Critical for a map-centric Mini App.
    wa.disableVerticalSwipes?.();
    // Paint TG's header strip + sheet background white so the seam
    // between our content and TG's chrome disappears.
    wa.setHeaderColor?.('#ffffff');
    wa.setBackgroundColor?.('#ffffff');
  } catch {
    /* swallow — best-effort UX hint */
  }
}
