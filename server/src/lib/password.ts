// Passwords, hashed with scrypt from Node's own crypto.
//
// WHY SCRYPT AND NOT ARGON2. argon2id is the textbook answer, and it
// is a native module: a compile step in the Fly image, a prebuilt
// binary to trust, and one more thing that can fail at boot on a
// shared-cpu-1x. scrypt ships inside Node, is memory-hard, and sits on
// OWASP's accepted list. The parameters below (N=2^15, r=8, p=1, 32
// byte salt and key) are their recommended floor for scrypt. On this
// VM a hash takes tens of milliseconds, which is the point.
//
// The stored string carries its own parameters, so they can be raised
// later and old hashes keep verifying until the person next logs in
// (at which point the caller may re-hash — see needsRehash).
//
//   scrypt$<N>$<r>$<p>$<salt b64url>$<key b64url>
//
// Nothing here touches the database or the environment. Checked in
// accounts.check.ts.

import crypto from 'crypto';

const N = 1 << 15;
const R = 8;
const P = 1;
const SALT_BYTES = 32;
const KEY_BYTES = 32;

// scrypt needs maxmem above 128 * N * r; leave headroom.
const MAXMEM = 128 * N * R * 2;

export const PASSWORD_MIN_LENGTH = 8;
// A ceiling, because scrypt cost scales with input length and a
// megabyte "password" is a cheap way to burn a core.
export const PASSWORD_MAX_LENGTH = 200;

export function passwordProblem(pw: unknown): 'missing' | 'short' | 'long' | null {
  if (typeof pw !== 'string' || pw.length === 0) return 'missing';
  if (pw.length < PASSWORD_MIN_LENGTH) return 'short';
  if (pw.length > PASSWORD_MAX_LENGTH) return 'long';
  return null;
}

function derive(pw: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(pw.normalize('NFKC'), salt, KEY_BYTES, { N: n, r, p, maxmem: MAXMEM }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_BYTES);
  const key = await derive(pw, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

interface Parsed {
  n: number;
  r: number;
  p: number;
  salt: Buffer;
  key: Buffer;
}

function parse(stored: string | null | undefined): Parsed | null {
  if (!stored) return null;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (![n, r, p].every((v) => Number.isInteger(v) && v > 0)) return null;
  // A stored N above what we would ever set is not a hash we wrote;
  // refusing it also bounds the work an attacker-controlled row could
  // make verify() do.
  if (n > N * 4) return null;
  try {
    const salt = Buffer.from(parts[4]!, 'base64url');
    const key = Buffer.from(parts[5]!, 'base64url');
    if (salt.length < 16 || key.length < 16) return null;
    return { n, r, p, salt, key };
  } catch {
    return null;
  }
}

/**
 * True when `pw` is the password behind `stored`. A malformed or
 * missing hash verifies nothing — and still costs one derivation, so
 * a login against an e-mail with no password takes as long as a wrong
 * password does.
 */
export async function verifyPassword(pw: string, stored: string | null | undefined): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed) {
    await derive(pw, Buffer.alloc(SALT_BYTES), N, R, P).catch(() => undefined);
    return false;
  }
  const key = await derive(pw, parsed.salt, parsed.n, parsed.r, parsed.p);
  if (key.length !== parsed.key.length) return false;
  return crypto.timingSafeEqual(key, parsed.key);
}

/** True when a hash was written with weaker parameters than today's. */
export function needsRehash(stored: string | null | undefined): boolean {
  const parsed = parse(stored);
  if (!parsed) return true;
  return parsed.n < N || parsed.r < R || parsed.p < P;
}
