// A per-IP ceiling on NEW account creation.
//
// The auth hook mints a users + companion_state row for any unrecognised
// device id or Telegram identity, and that happens inside the preHandler —
// before any route's rate limiter runs, and for requests that are ultimately
// refused too. So without this, one address can create unbounded rows by
// presenting a fresh device id each request. This guards the creation itself.
//
// It runs ONLY on the creation path, after the caller is known not to have an
// account, so an existing user is never affected (the D-35 invariant: a gate
// never locks out an account that already exists).
//
// Fail-open, loudly: if Redis is unavailable the call is allowed and logged,
// matching how the rest of the app degrades without Redis (spawn cooldown,
// presence). An outage should not lock every new user out; the log line is
// the evidence that creation is briefly uncounted. When invites are required
// (closed beta) that gate is the real control regardless.

import { redis } from '../db/redis.js';

type Log = { warn: (obj: object, msg: string) => void };

const WINDOW_S = Number(process.env.ACCOUNT_CREATE_WINDOW_S) || 600; // 10 min
const MAX_PER_WINDOW = Number(process.env.ACCOUNT_CREATE_MAX_PER_IP) || 20;

export class AccountCreateLimitError extends Error {
  constructor() {
    super('account creation rate limit');
    this.name = 'AccountCreateLimitError';
  }
}

export async function guardAccountCreation(ip: string, log: Log): Promise<void> {
  if (!ip) return; // no address to key on — don't block a real user over it
  if (redis.status !== 'ready') {
    log.warn({ kind: 'account_create_guard_unavailable', ip }, 'account-create guard skipped — Redis down, creation UNCOUNTED');
    return;
  }
  try {
    const key = `create:ip:${ip}`;
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, WINDOW_S);
    if (n > MAX_PER_WINDOW) {
      log.warn(
        { kind: 'account_create_flood', ip, count: n, max: MAX_PER_WINDOW, windowS: WINDOW_S },
        'account creation rate limit hit for this address',
      );
      throw new AccountCreateLimitError();
    }
  } catch (err) {
    if (err instanceof AccountCreateLimitError) throw err;
    log.warn(
      { kind: 'account_create_guard_error', err: (err as Error).message },
      'account-create guard errored — allowing the creation',
    );
  }
}
