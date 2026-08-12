// The invite gate's policy, with no database attached.
//
// Split from services/invites.ts (which talks to Postgres) so the one
// safety-critical decision here can be checked without a connection —
// and so nothing about a database outage or a missing env var can change
// the answer to "is this person allowed to keep their account".

export function inviteRequired(): boolean {
  const raw = process.env.INVITE_REQUIRED?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

/**
 * Does this request need to present an invite code?
 *
 * THE INVARIANT: an account that already exists NEVER needs a code,
 * under any configuration, ever.
 *
 * Several hundred real accounts authenticate by a device id in
 * localStorage with no email, no password and no recovery path.
 * Returning true for one of them locks that person out of their pet,
 * their territory and their companion's memory, permanently, and the
 * only symptom they see is a 403 they can do nothing about. There is no
 * configuration in which that is intended, so `hasExistingAccount`
 * short-circuits before anything else is consulted.
 *
 * Exhaustively checked in invites.check.ts rather than left to the
 * ordering of two branches in an auth hook.
 */
export function mustPresentInvite(opts: {
  hasExistingAccount: boolean;
  required?: boolean;
}): boolean {
  if (opts.hasExistingAccount) return false;
  return opts.required ?? inviteRequired();
}

export function normaliseCode(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  if (code.length < 4 || code.length > 32) return null;
  return code;
}
