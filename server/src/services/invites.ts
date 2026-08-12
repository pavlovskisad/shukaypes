// Invite codes: the door for the closed beta.
//
// SHIPS DORMANT. With INVITE_REQUIRED unset, nothing below changes any
// behaviour — signup works exactly as it does today. It turns on when
// there are codes to hand out and people to hand them to, which is a
// decision about the beta rather than about this deploy.
//
// GATES CREATION ONLY. The check lives on the branch of resolveByDeviceId
// that inserts a new row, never on the branch that finds an existing
// one. Several hundred accounts already exist, they authenticate purely
// by a device id held in localStorage, and they have no email, no
// password and no account-merge path. A code demanded on every request
// rather than only at signup would lock every one of them out
// permanently, with nothing to recover from.

import type { FastifyBaseLogger } from 'fastify';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, schema } from '../db/index.js';
// Policy lives in lib/inviteGate (pure, no database) so it can be
// checked without one. Re-exported so callers have a single import.
export { inviteRequired, mustPresentInvite, normaliseCode } from '../lib/inviteGate.js';

type Log = Pick<FastifyBaseLogger, 'info' | 'warn'>;

/**
 * Claims one use of `code`. Returns true if the caller may create an
 * account.
 *
 * The claim is a single conditional UPDATE rather than a read followed
 * by a write: two people redeeming the last use of a code at the same
 * moment would both pass a check-then-update, and a code with
 * `max_uses: 1` would admit two. Postgres settles it here instead.
 */
export async function claimInvite(code: string, log: Log): Promise<boolean> {
  const claimed = await db
    .update(schema.inviteCodes)
    .set({ usedCount: sql`${schema.inviteCodes.usedCount} + 1` })
    .where(
      and(
        eq(schema.inviteCodes.code, code),
        isNull(schema.inviteCodes.revokedAt),
        lt(schema.inviteCodes.usedCount, schema.inviteCodes.maxUses),
      ),
    )
    .returning({ code: schema.inviteCodes.code });

  if (claimed.length === 0) {
    log.warn({ kind: 'invite_rejected', code }, 'invite code rejected');
    return false;
  }
  return true;
}

/**
 * Records which code admitted which account. Best-effort: the account
 * already exists by this point, and losing the audit row is not worth
 * failing a signup over.
 */
export async function recordRedemption(code: string, userId: string, log: Log): Promise<void> {
  try {
    await db.insert(schema.inviteRedemptions).values({ id: nanoid(), code, userId });
    log.info({ kind: 'invite_redeemed', code, userId }, 'invite redeemed');
  } catch (err) {
    log.warn(
      { kind: 'invite_redemption_unrecorded', code, userId, err: (err as Error).message },
      'could not record invite redemption',
    );
  }
}
