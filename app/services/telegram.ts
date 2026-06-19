// Telegram Mini App helpers. When the app runs inside Telegram,
// window.Telegram.WebApp.initData is a signed payload our server
// verifies (see server/src/services/telegramAuth.ts). Outside
// Telegram window.Telegram is undefined; every helper returns null
// so the existing device-id auth path runs unchanged.

interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: { user?: { id?: number; first_name?: string; username?: string } };
  ready: () => void;
  expand: () => void;
  // Plenty more on the real object — only typed what we touch.
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

// Tell Telegram we're ready to render — removes the loading splash
// it shows over the Mini App's iframe. Safe to call repeatedly; the
// outermost mount calls this once.
export function notifyTelegramReady(): void {
  const wa = getTelegramWebApp();
  if (!wa) return;
  try {
    wa.ready();
    // expand() opens the Mini App to full height of the TG sheet so
    // we don't render in the short default ~50% window.
    wa.expand();
  } catch {
    /* swallow — best-effort UX hint */
  }
}
