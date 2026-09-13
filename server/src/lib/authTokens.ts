// One-time tokens and refresh tokens: the pure half.
//
// A token is 32 random bytes, base64url, handed to the person once (in
// a link, or in a login response). Only its SHA-256 is stored, so the
// tables hold nothing that can be replayed. Lookups are by hash, which
// is a UNIQUE column, so verifying is one indexed read.

import crypto from 'crypto';

export const VERIFY_TTL_S = 24 * 60 * 60;
export const RESET_TTL_S = 60 * 60;
export const REFRESH_TTL_S = 90 * 24 * 60 * 60;
// A person may ask for another verification mail this often.
export const RESEND_COOLDOWN_S = 60;

export type OneTimeKind = 'verify' | 'reset';

export function newToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('base64url');
}

// What arrives from a link or a request body. Bounded so a hostile
// value cannot cost more than a hash of a short string.
export function normaliseToken(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (v.length < 32 || v.length > 128) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(v)) return null;
  return v;
}
