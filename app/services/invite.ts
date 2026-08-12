// Invite code capture for the closed beta.
//
// The code arrives by one of two doors and has to survive long enough to
// reach the server on the request that creates the account:
//
//   web       https://shukaypes.vercel.app/?invite=CODE
//   telegram  https://t.me/<bot>?startapp=invite-CODE
//
// CAPTURED AT MODULE INIT, for the same reason `INITIAL_URL_DOG_ID` in
// services/telegram.ts is: expo-router resolves the initial route and
// can rewrite the URL — dropping the query — between page load and the
// first component that would read it. Reading `window.location` later is
// unreliable, so the snapshot is taken the moment this module loads.
//
// PERSISTED, because the code is needed on the first API call that
// creates an account, and that may not be the first page view: a user
// can open the link, get bounced by a slow network, reload without the
// query, and still deserve to get in. It is cleared once an account
// exists, so a shared device does not silently pass a stale code.
//
// Prefixed 'invite-' inside start_param because that parameter already
// carries 'lost-<id>' deep links; the two must not be confused for one
// another.

import { getTelegramStartParam } from './telegram';

const KEY = 'shukajpes.inviteCode';
const TG_PREFIX = 'invite-';

function normalise(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  // Mirrors normaliseCode on the server. A code that cannot possibly be
  // valid is not worth storing or sending.
  if (code.length < 4 || code.length > 32) return null;
  if (!/^[A-Z0-9-]+$/.test(code)) return null;
  return code;
}

const FROM_INITIAL_URL = (() => {
  if (typeof window === 'undefined' || !window.location) return null;
  try {
    return normalise(new URL(window.location.href).searchParams.get('invite'));
  } catch {
    return null;
  }
})();

function fromTelegram(): string | null {
  const param = getTelegramStartParam();
  if (param && param.startsWith(TG_PREFIX)) return normalise(param.slice(TG_PREFIX.length));
  return null;
}

function stored(): string | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  return normalise(window.localStorage.getItem(KEY));
}

function persist(code: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(KEY, code);
  } catch {
    // Private-mode Safari and friends. The in-memory value still works
    // for this session, which covers the signup it is needed for.
  }
}

let cached: string | null = null;

/**
 * The invite code to present, or null. Checks the URL snapshot first,
 * then Telegram's start param, then whatever was stored on a previous
 * visit — and remembers the first one it finds.
 */
export function getInviteCode(): string | null {
  if (cached) return cached;
  const found = FROM_INITIAL_URL ?? fromTelegram() ?? stored();
  if (found) {
    cached = found;
    persist(found);
  }
  return found;
}

/**
 * Called once the server has accepted us. Keeps a used code from
 * lingering on a shared browser, where it would otherwise be presented
 * by the next person to open the app.
 */
export function clearInviteCode(): void {
  cached = null;
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}
