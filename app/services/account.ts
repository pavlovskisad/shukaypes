// The account half of identity: a login that outlives the day-long
// session slip, and the tokens that arrive by e-mail link.
//
// WHAT IS STORED. After an e-mail login (or a verified link, or a
// password reset — each logs the device in) the server hands back a
// 90-day refresh token. We keep it in localStorage with the user id it
// belongs to. From then on this page IS that account: services/
// session.ts keys its slip on `acct:<userId>` instead of the device
// id, and services/api.ts trades the refresh token for a fresh slip
// whenever the one we hold has expired — instead of falling back to
// the device id, which would quietly log the person into an anonymous
// account with none of their things in it.
//
// LINK TOKENS are picked out of the URL at module init, for the same
// reason services/invite.ts does it: expo-router can rewrite the URL
// between page load and the first component that would read it.
// `?verify=` confirms an address, `?reset=` opens the new-password
// screen. Both are consumed once by the door (components/ui/
// AccountDoor.tsx) and never persisted — a link is a one-shot thing.

const KEY = 'shukajpes.account';

export interface StoredAccount {
  refresh: string;
  userId: string;
}

let cached: StoredAccount | null | undefined;

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getAccount(): StoredAccount | null {
  if (cached !== undefined) return cached;
  const s = storage();
  if (!s) return (cached = null);
  try {
    const raw = s.getItem(KEY);
    if (!raw) return (cached = null);
    const v = JSON.parse(raw) as Partial<StoredAccount>;
    if (typeof v.refresh !== 'string' || typeof v.userId !== 'string') return (cached = null);
    return (cached = { refresh: v.refresh, userId: v.userId });
  } catch {
    return (cached = null);
  }
}

export function storeAccount(account: StoredAccount): void {
  cached = account;
  try {
    storage()?.setItem(KEY, JSON.stringify(account));
  } catch {
    /* private mode: the login lives for this page only */
  }
}

export function clearAccount(): void {
  cached = null;
  try {
    storage()?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

function readLinkToken(name: string): string | null {
  if (typeof window === 'undefined' || !window.location) return null;
  try {
    const v = new URL(window.location.href).searchParams.get(name);
    if (!v || v.length < 32 || v.length > 128) return null;
    if (!/^[A-Za-z0-9_-]+$/.test(v)) return null;
    return v;
  } catch {
    return null;
  }
}

const VERIFY_FROM_URL = readLinkToken('verify');
const RESET_FROM_URL = readLinkToken('reset');

let verifyTaken = false;
let resetTaken = false;

/** The verification token in the URL this page opened with, once. */
export function takeVerifyToken(): string | null {
  if (verifyTaken) return null;
  verifyTaken = true;
  return VERIFY_FROM_URL;
}

/** The password-reset token in the URL this page opened with, once. */
export function takeResetToken(): string | null {
  if (resetTaken) return null;
  resetTaken = true;
  return RESET_FROM_URL;
}

/** True when this page opened from a mail link, before either is taken. */
export function hasLinkToken(): boolean {
  return VERIFY_FROM_URL != null || RESET_FROM_URL != null;
}

// Drop ?verify= / ?reset= from the address bar once consumed, so a
// reload does not re-present a spent token and a shared screenshot
// does not carry one. Best effort; the history API is absent in some
// embedded views.
export function scrubLinkFromUrl(): void {
  if (typeof window === 'undefined' || !window.history || !window.location) return;
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('verify') && !url.searchParams.has('reset')) return;
    url.searchParams.delete('verify');
    url.searchParams.delete('reset');
    window.history.replaceState(window.history.state, '', url.toString());
  } catch {
    /* ignore */
  }
}
