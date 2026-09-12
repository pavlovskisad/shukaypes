// The account's policy, with no database attached.
//
// Same shape as lib/inviteGate.ts and for the same reason: the one
// decision that can lock a person out — "may this request pass the
// door?" — is a pure function of a few facts, checked exhaustively in
// accounts.check.ts, rather than an ordering of branches in the auth
// hook.
//
// THE DOOR. Registration is required for everybody (D-69, decided by
// the owner on 12 Sep): the app opens on the registration screen until
// the account carries a nickname, an e-mail and a password, and the
// API refuses everything but /auth/* until then. A row created before
// registration (first contact happens before the form) is the row that
// gets registered, never replaced. The pre-door accounts themselves are
// wiped at rollout (db/wipe-users.ts) — the owner's call, no real users
// yet — so every account in the table has been through this policy.
//
// TWO SWITCHES, both defaulting to the strict side, both there so a
// launch-day mail outage is a config change and not a redeploy:
//
//   REGISTRATION_REQUIRED   unset/1 = the door is up. 0 = the app
//                           behaves as before this file existed.
//   EMAIL_VERIFY_REQUIRED   unset/1 = a registered account must also
//                           have clicked its verification link.
//                           0 = registering is enough.
//
// …and one that is not a switch but a fact: with no mail sender
// configured (RESEND_API_KEY unset) verification cannot be required,
// because nobody could ever satisfy it. That case is logged loudly at
// boot (routes/auth.ts) and the door falls back to registration only.

export type PetSpecies = 'dog' | 'cat';

export interface DoorFacts {
  registeredAt: Date | null;
  emailVerifiedAt: Date | null;
}

export type DoorState = 'open' | 'register' | 'verify';

function flag(name: string, dflt: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return dflt;
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export function registrationRequired(): boolean {
  return flag('REGISTRATION_REQUIRED', true);
}

export function mailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

/** Verification is required only when it is both wanted and possible. */
export function emailVerifyRequired(opts?: { mail?: boolean }): boolean {
  const mail = opts?.mail ?? mailConfigured();
  return mail && flag('EMAIL_VERIFY_REQUIRED', true);
}

/**
 * What the app should show this account: the map, the registration
 * form, or the "check your inbox" screen.
 *
 * `required` and `verify` default to the environment; the check passes
 * them explicitly so every combination is exercised.
 */
export function doorFor(
  facts: DoorFacts,
  opts?: { required?: boolean; verify?: boolean },
): DoorState {
  const required = opts?.required ?? registrationRequired();
  if (!required) return 'open';
  if (!facts.registeredAt) return 'register';
  const verify = opts?.verify ?? emailVerifyRequired();
  if (verify && !facts.emailVerifiedAt) return 'verify';
  return 'open';
}

// Routes that must work with the door shut, or nobody could ever open
// it. Everything else 403s until doorFor says 'open'. The auth hook's
// own bypasses (/health, /admin/*, /photos/*, /client-errors…) are
// decided before this list is consulted.
export function passesDoor(path: string | undefined): boolean {
  if (!path) return false;
  return path === '/auth' || path.startsWith('/auth/');
}

// ---- Field validation ----

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 24;
export const PET_NAME_MAX = 40;
export const BREED_MAX = 60;

// Letters in any script, digits, space, and the three joiners people
// actually put in a name. No control characters, no emoji-only names
// on a leaderboard.
const NICKNAME_RE = /^[\p{L}\p{N} _.'-]+$/u;

export function normaliseNickname(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().replace(/\s+/g, ' ');
  if (v.length < NICKNAME_MIN || v.length > NICKNAME_MAX) return null;
  if (!NICKNAME_RE.test(v)) return null;
  return v;
}

/**
 * The uniqueness key for a nickname. Folded here rather than by SQL
 * lower(): Postgres folds non-ASCII only under some locales, and
 * whether «Оля» and «оля» are the same person must not depend on the
 * database's. NFKC first, so fullwidth and composed forms collapse too.
 */
export function foldNickname(nickname: string): string {
  return nickname.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Deliberately loose: an @, a dot after it, nothing silly. The real
// validation is the verification mail.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normaliseEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  if (v.length < 6 || v.length > 254) return null;
  if (!EMAIL_RE.test(v)) return null;
  return v;
}

export function normaliseSpecies(raw: unknown): PetSpecies | null {
  return raw === 'dog' || raw === 'cat' ? raw : null;
}

export function normaliseShortText(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().replace(/\s+/g, ' ');
  if (v.length === 0 || v.length > max) return null;
  return v;
}

/** Hide most of an address for echoing back: al***@gmail.com. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const keep = Math.min(2, local.length);
  return `${local.slice(0, keep)}***${email.slice(at)}`;
}
