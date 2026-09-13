// The client half of session tokens. See server/src/lib/session.ts for
// why they exist; in one line, so the Mini App stops uploading a
// kilobyte of Telegram initData on every request.
//
// The server hands a token back on a response header after any request
// that identified us the old way, and again when the one we hold is in
// its last hours. We keep it in localStorage with its expiry and the
// identity it was minted for, send it instead of the identity headers
// while it is fresh, and drop it the moment the server refuses it — the
// request wrapper retries once the old way, which mints a new one.
//
// Bound to an identity on purpose. Storage is per origin and the Mini
// App and the PWA do not share one, but a token for a device-id account
// must never be presented from a page that now has a Telegram identity,
// or the wrong account answers. `for` records who the token is for and
// the token is only used when that still matches.

import { getDeviceId } from './deviceId';
import { getTelegramInitData, getTelegramWebApp } from './telegram';
import { getAccount } from './account';

export const SESSION_HEADER = 'x-session';
export const SESSION_ISSUE_HEADER = 'x-session-token';
const KEY = 'shukajpes.session';
// Do not present a token about to expire: the round trip may outlive it.
const EXPIRY_MARGIN_S = 30;

interface Stored {
  token: string;
  exp: number;
  for: string;
}

let cached: Stored | null | undefined;

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function read(): Stored | null {
  if (cached !== undefined) return cached;
  const s = storage();
  if (!s) return (cached = null);
  try {
    const raw = s.getItem(KEY);
    if (!raw) return (cached = null);
    const v = JSON.parse(raw) as Partial<Stored>;
    if (typeof v.token !== 'string' || typeof v.exp !== 'number' || typeof v.for !== 'string') {
      return (cached = null);
    }
    return (cached = { token: v.token, exp: v.exp, for: v.for });
  } catch {
    return (cached = null);
  }
}

// Who this page is: the logged-in account when there is one (its slip
// was minted from a refresh token, not from a header this device
// holds), else `tg:<id>` inside Telegram, else the device id. The two
// header cases match the `d` claim the server signs, so a token's
// identity can be checked without decoding it; the account case is
// keyed on the user id, which is what a login is a claim about.
export function identityKey(): string {
  const account = getAccount();
  if (account) return `acct:${account.userId}`;
  const tgUser = getTelegramInitData() ? getTelegramWebApp()?.initDataUnsafe?.user?.id : undefined;
  return typeof tgUser === 'number' ? `tg:${tgUser}` : getDeviceId();
}

function decodeExp(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(b64)) as { exp?: unknown };
    return typeof json.exp === 'number' ? json.exp : null;
  } catch {
    return null;
  }
}

/** The token to send, or null when we should identify the old way. */
export function getSessionToken(): string | null {
  const v = read();
  if (!v) return null;
  if (v.for !== identityKey()) return null;
  if (v.exp - EXPIRY_MARGIN_S <= Date.now() / 1000) return null;
  return v.token;
}

export function storeSession(token: string): void {
  const exp = decodeExp(token);
  if (exp == null) return;
  const v: Stored = { token, exp, for: identityKey() };
  cached = v;
  try {
    storage()?.setItem(KEY, JSON.stringify(v));
  } catch {
    /* private mode: the token lives for this page only */
  }
}

export function clearSession(): void {
  cached = null;
  try {
    storage()?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/**
 * The headers that say who we are: the session token while we hold a
 * fresh one, else Telegram initData inside the Mini App, else the device
 * id. One recipe for every caller, so a 401 anywhere means real auth
 * failure and not a helper that missed the newest header.
 *
 * With an ACCOUNT on this page and no fresh slip, this must not be
 * called: the fallback headers would identify the anonymous device
 * row, not the account. services/api.ts refreshes the slip first
 * (ensureAccountSession) and only then asks for headers.
 */
export function authHeaders(): Record<string, string> {
  const session = getSessionToken();
  if (session) return { [SESSION_HEADER]: session };
  const tgInitData = getTelegramInitData();
  return tgInitData ? { 'x-telegram-init-data': tgInitData } : { 'x-device-id': getDeviceId() };
}

/** Keep any token the server handed back on this response. */
export function absorbIssuedSession(res: Response): void {
  try {
    const issued = res.headers.get(SESSION_ISSUE_HEADER);
    if (issued) storeSession(issued);
  } catch {
    /* an opaque response has no readable headers */
  }
}
