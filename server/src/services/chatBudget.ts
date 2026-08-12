// Spend ceilings for the model calls a user can trigger.
//
// The exposure this closes is not today's bill — measured over the last
// seven days, the whole service spent three Opus turns across three
// people. It is that nothing bounded it. Any account could call /chat
// at the route limit indefinitely, `ANTHROPIC_API_KEY` had no cap on
// it, and the only way to stop a runaway was to delete the secret,
// which 502s the app for everybody.
//
// Three controls, smallest blast radius first:
//
//   per-user daily   a human has a bad day; a script has a great one.
//   global daily     the backstop. If something gets past the per-user
//                    limit — many accounts, a bug, a loop — this is the
//                    number that stands between a mistake and a bill.
//   kill switch      turn it off entirely, without a deploy.
//
// FAILS OPEN, DELIBERATELY, AND THIS IS A REAL TRADE. The counters live
// in Redis. If Redis is unreachable the budget cannot be read, and the
// choice is between refusing every chat (the dog goes mute for everyone
// during an unrelated outage) and allowing them uncounted (spending
// continues unbounded until Redis returns). Chat is the product's
// texture rather than its function, but a silently-mute companion reads
// as "the app is broken" to a beta tester, while the rate limits and the
// kill switch still stand in front of the spend. So: open, logged at
// error level with a greppable kind, and visible in the console.

import type { FastifyBaseLogger } from 'fastify';
import { redis } from '../db/redis.js';

type Log = Pick<FastifyBaseLogger, 'warn' | 'error'>;

// Generous against real use, tight against a script. Current real usage
// is roughly three active turns per WEEK across the whole service, so
// these are ~2 orders of magnitude of headroom, not a squeeze.
const DEFAULT_USER_ACTIVE_PER_DAY = 50;
const DEFAULT_GLOBAL_ACTIVE_PER_DAY = 1000;
// Ambient bubbles are Haiku and six words long — cheap enough to bound
// loosely, not cheap enough to leave unbounded.
const DEFAULT_USER_AMBIENT_PER_DAY = 300;

const DAY_SECONDS = 60 * 60 * 24;

export type ChatMode = 'active' | 'ambient';

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/**
 * True when chat is switched off entirely. Read per request so flipping
 * `CHAT_DISABLED` takes effect on the next machine start without a code
 * deploy — and so the admin console can surface the current state
 * without asking the process what it booted with.
 */
export function chatDisabled(): boolean {
  const raw = process.env.CHAT_DISABLED?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

// UTC day. Deliberately not the user's local day: a per-user local
// midnight would need a timezone we do not reliably have, and the point
// is a spend ceiling rather than a fair daily allowance.
function dayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export interface BudgetVerdict {
  allowed: boolean;
  /** Set when refused, safe to show a user. */
  reason?: 'disabled' | 'user_daily' | 'global_daily';
}

/**
 * Counts one model call against the budgets and says whether it may
 * proceed. Increments first and compares after, so concurrent requests
 * cannot all read an under-limit value and then all spend.
 */
export async function chargeChatBudget(
  userId: string,
  mode: ChatMode,
  log: Log,
  nowMs: number = Date.now(),
): Promise<BudgetVerdict> {
  if (chatDisabled()) return { allowed: false, reason: 'disabled' };

  const day = dayKey(nowMs);
  const userLimit =
    mode === 'active'
      ? envInt('CHAT_USER_DAILY_LIMIT', DEFAULT_USER_ACTIVE_PER_DAY)
      : envInt('CHAT_USER_AMBIENT_DAILY_LIMIT', DEFAULT_USER_AMBIENT_PER_DAY);

  try {
    const userKey = `llm:${mode}:user:${userId}:${day}`;
    const userCount = await redis.incr(userKey);
    // Only set the TTL on first write, so a busy user's window doesn't
    // slide forward forever.
    if (userCount === 1) await redis.expire(userKey, DAY_SECONDS);
    if (userCount > userLimit) {
      log.warn(
        { kind: 'chat_budget_user', userId, mode, count: userCount, limit: userLimit },
        'user hit their daily model budget',
      );
      return { allowed: false, reason: 'user_daily' };
    }

    // The global backstop only guards the expensive tier. An ambient
    // bubble is Haiku and cannot meaningfully move a bill.
    if (mode === 'active') {
      const globalLimit = envInt('CHAT_GLOBAL_DAILY_LIMIT', DEFAULT_GLOBAL_ACTIVE_PER_DAY);
      const globalKey = `llm:active:global:${day}`;
      const globalCount = await redis.incr(globalKey);
      if (globalCount === 1) await redis.expire(globalKey, DAY_SECONDS);
      if (globalCount > globalLimit) {
        log.error(
          { kind: 'chat_budget_global', count: globalCount, limit: globalLimit },
          'GLOBAL daily model budget exhausted — chat refused for everyone',
        );
        return { allowed: false, reason: 'global_daily' };
      }
    }

    return { allowed: true };
  } catch (err) {
    // See the header: open, but loud. This line is the only evidence
    // that spending is currently uncounted.
    log.error(
      { kind: 'chat_budget_unavailable', err: (err as Error).message, userId, mode },
      'model budget store unreachable — allowing the call UNCOUNTED',
    );
    return { allowed: true };
  }
}

/** Current usage, for the admin console. Never throws. */
export async function readChatBudget(
  nowMs: number = Date.now(),
): Promise<{ globalActiveToday: number; globalLimit: number; disabled: boolean } | null> {
  try {
    const day = dayKey(nowMs);
    const raw = await redis.get(`llm:active:global:${day}`);
    return {
      globalActiveToday: Number(raw ?? 0),
      globalLimit: envInt('CHAT_GLOBAL_DAILY_LIMIT', DEFAULT_GLOBAL_ACTIVE_PER_DAY),
      disabled: chatDisabled(),
    };
  } catch {
    return null;
  }
}
