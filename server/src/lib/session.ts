// Session tokens: identity once, a short signed slip thereafter.
//
// WHY. Every request from the Mini App carried the whole Telegram
// initData — the user JSON, the query id, the auth date, Telegram's
// signature — about half a kilobyte to a kilobyte, on the presence poll
// twenty times a minute. Roughly a megabyte an hour of UPLOAD on a walk,
// and upload is the slow direction on mobile (12-beta-perf-compat.md,
// F-1). Behind it, the server re-validated the HMAC and, for Telegram
// users, ran a profile-refresh UPDATE on every single request; for
// device-id users, a SELECT. On the launch-day hot path (L-2) those are
// queries that buy nothing after the first one.
//
// WHAT. After the first request identifies somebody the old way, the
// server hands back a token: a v1.<payload>.<signature> string of about
// two hundred bytes, HMAC-SHA256 over a JSON payload naming the user,
// the device id and how they were identified, valid for a day. The
// client sends that instead. A valid token resolves the user with no
// database round trip; one in its last hours is re-issued on the way
// out so an active user never falls back; an expired or tampered one is
// simply ignored and the request re-identifies the old way.
//
// WHAT IT IS NOT. Not a change to who can do what. A token asserts
// exactly what the header it replaces asserted, for the same person,
// for less time than a device id lives (forever). `via` is recorded so
// that P1-6 — requiring the Telegram-signed identity for anything with
// real value — can be built on it later without another handshake.
//
// THE KEY. `SESSION_SECRET` if set; otherwise derived from the bot
// token, which is the key Telegram's own signature already depends on,
// so deriving from it adds no new trust. Neither set → no tokens are
// minted, none verify, and every request identifies the old way. That
// is the state of a deployment that has never heard of this file, and
// it is fully functional.

import crypto from 'crypto';

export const SESSION_HEADER = 'x-session';
export const SESSION_ISSUE_HEADER = 'x-session-token';
export const SESSION_TTL_S = 24 * 60 * 60;
// Re-issue when this much life is left, so a phone that is opened at
// least once a day never has to present its identity again.
export const SESSION_RENEW_WINDOW_S = 6 * 60 * 60;
const MAX_TOKEN_LENGTH = 2048;
const CLOCK_SKEW_S = 60;

export type SessionVia = 'telegram' | 'device';

export interface SessionClaims {
  userId: string;
  deviceId: string;
  via: SessionVia;
  issuedAt: number;
  expiresAt: number;
}

export function sessionSecret(): Buffer | null {
  const explicit = process.env.SESSION_SECRET;
  if (explicit && explicit.length >= 16) return Buffer.from(explicit, 'utf8');
  const bot = process.env.TELEGRAM_BOT_TOKEN;
  if (bot && bot.length > 0) {
    return crypto.createHmac('sha256', 'shukajpes-session').update(bot).digest();
  }
  return null;
}

function sign(payload: string, secret: Buffer): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function mintSession(
  input: { userId: string; deviceId: string; via: SessionVia },
  nowS: number = nowSeconds(),
): string | null {
  const secret = sessionSecret();
  if (!secret) return null;
  const body = {
    u: input.userId,
    d: input.deviceId,
    v: input.via,
    iat: nowS,
    exp: nowS + SESSION_TTL_S,
  };
  const payload = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
  return `v1.${payload}.${sign(payload, secret)}`;
}

export function verifySession(
  token: string | undefined,
  nowS: number = nowSeconds(),
): SessionClaims | null {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  const secret = sessionSecret();
  if (!secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const payload = parts[1]!;
  const sig = parts[2]!;
  const expected = sign(payload, secret);
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let body: unknown;
  try {
    body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object') return null;
  const o = body as Record<string, unknown>;
  if (typeof o.u !== 'string' || o.u.length === 0) return null;
  if (typeof o.d !== 'string' || o.d.length === 0) return null;
  if (o.v !== 'telegram' && o.v !== 'device') return null;
  if (typeof o.iat !== 'number' || typeof o.exp !== 'number') return null;
  if (!Number.isFinite(o.iat) || !Number.isFinite(o.exp)) return null;
  if (o.exp <= nowS) return null;
  if (o.iat > nowS + CLOCK_SKEW_S) return null;
  if (o.exp - o.iat > SESSION_TTL_S) return null;
  return { userId: o.u, deviceId: o.d, via: o.v, issuedAt: o.iat, expiresAt: o.exp };
}

export function sessionNeedsRenewal(claims: SessionClaims, nowS: number = nowSeconds()): boolean {
  return claims.expiresAt - nowS < SESSION_RENEW_WINDOW_S;
}
