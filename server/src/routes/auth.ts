// Accounts: registration at the door, e-mail verification, login,
// password recovery. D-69.
//
// THE SHAPE. Identity stays what it was — a device id or a Telegram
// signature resolves a `users` row on first contact (auth.ts). What
// this file adds is the ACCOUNT on top of that row: a nickname, a pet,
// an e-mail and a password. Registering never creates a second row;
// it writes onto the one the person already walks with, so the ~543
// legacy accounts keep their dog, their ground and their companion's
// memory when they meet the door.
//
// TWO KINDS OF ROUTE, and the auth hook treats them differently:
//
//   with an identity     /auth/me, /auth/register, /auth/resend —
//                        the hook resolves req.userId as for any
//                        other route, and these are the ONLY routes
//                        it lets through while the door is shut.
//   before any identity  /auth/login, /auth/verify, /auth/refresh,
//                        /auth/forgot, /auth/reset, /auth/logout —
//                        bypassed by the hook (a fresh browser must
//                        be able to log in without first minting an
//                        anonymous row), rate-limited by address.
//
// A login hands back two things: the day-long HMAC session slip every
// request carries (lib/session.ts, via 'email'), and a 90-day refresh
// token stored hashed in auth_sessions. The client trades the second
// for a fresh first when it expires, instead of falling back to the
// device id — which would silently log the person into an anonymous
// account.
//
// ERRORS ARE CODES, not prose: `{ error: 'email_taken' }` with a 4xx.
// The client maps codes to its own strings in both languages.

import type { FastifyBaseLogger, FastifyPluginAsync, FastifyReply } from 'fastify';
import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, schema } from '../db/index.js';
import { limitAuth, limitExpensive, limitPolling } from '../lib/rateLimit.js';
import {
  BREED_MAX,
  PET_NAME_MAX,
  doorFor,
  emailVerifyRequired,
  foldNickname,
  mailConfigured,
  maskEmail,
  normaliseEmail,
  normaliseNickname,
  normaliseShortText,
  normaliseSpecies,
  registrationRequired,
  type DoorState,
} from '../lib/accountPolicy.js';
import { hashPassword, needsRehash, passwordProblem, verifyPassword } from '../lib/password.js';
import {
  REFRESH_TTL_S,
  RESEND_COOLDOWN_S,
  RESET_TTL_S,
  VERIFY_TTL_S,
  hashToken,
  newToken,
  normaliseToken,
  type OneTimeKind,
} from '../lib/authTokens.js';
import { SESSION_ISSUE_HEADER, mintSession, type SessionVia } from '../lib/session.js';
import { sendEmail } from '../services/email.js';
import { resetMail, verifyMail } from '../services/authMail.js';

type Log = Pick<FastifyBaseLogger, 'info' | 'warn'>;
type UserRow = typeof schema.users.$inferSelect;

// What the client needs to draw the right screen. Everything about
// the person is theirs to see; the e-mail is masked anyway because it
// is echoed onto a screen that may be over somebody's shoulder.
export interface Me {
  userId: string;
  via: SessionVia | null;
  door: DoorState;
  registered: boolean;
  emailVerified: boolean;
  verifyRequired: boolean;
  mailConfigured: boolean;
  email: string | null;
  nickname: string;
  pet: { name: string | null; species: string | null; breed: string | null } | null;
  hasPassword: boolean;
  telegram: boolean;
  avatarUrl: string | null;
}

function buildMe(user: UserRow, via: SessionVia | null): Me {
  const door = doorFor({ registeredAt: user.registeredAt, emailVerifiedAt: user.emailVerifiedAt });
  return {
    userId: user.id,
    via,
    door,
    registered: user.registeredAt != null,
    emailVerified: user.emailVerifiedAt != null,
    verifyRequired: emailVerifyRequired(),
    mailConfigured: mailConfigured(),
    email: user.email ? maskEmail(user.email) : null,
    nickname: user.username,
    pet: user.petName || user.petSpecies || user.petBreed
      ? { name: user.petName, species: user.petSpecies, breed: user.petBreed }
      : null,
    hasPassword: user.passwordHash != null,
    telegram: user.telegramId != null,
    avatarUrl: user.avatarFileId ? `/photos/${user.avatarFileId}` : null,
  };
}

async function loadUser(userId: string): Promise<UserRow | null> {
  const [row] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  return row ?? null;
}

async function findByEmail(email: string): Promise<UserRow | null> {
  const [row] = await db
    .select()
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${email}`)
    .limit(1);
  return row ?? null;
}

// The slip every request carries, re-minted so it says what the row
// now says about the door. Null when sessions are unconfigured, in
// which case the client keeps identifying the old way.
function issueSlip(reply: FastifyReply, user: UserRow, deviceId: string, via: SessionVia): string | null {
  const door = doorFor({ registeredAt: user.registeredAt, emailVerifiedAt: user.emailVerifiedAt });
  const token = mintSession({ userId: user.id, deviceId, via, registered: door === 'open' });
  if (token) reply.header(SESSION_ISSUE_HEADER, token);
  return token;
}

// A 90-day login. Only the hash is stored.
async function openRefresh(userId: string, deviceId: string | null): Promise<string> {
  const token = newToken();
  await db.insert(schema.authSessions).values({
    id: nanoid(),
    userId,
    tokenHash: hashToken(token),
    deviceId,
    expiresAt: new Date(Date.now() + REFRESH_TTL_S * 1000),
  });
  return token;
}

async function revokeAllRefresh(userId: string): Promise<void> {
  await db
    .update(schema.authSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.authSessions.userId, userId), isNull(schema.authSessions.revokedAt)));
}

// One-time tokens. Issuing a new one retires the previous of the same
// kind, so an old verification link cannot confirm an address the
// person has since corrected.
async function issueOneTime(userId: string, kind: OneTimeKind, ttlS: number): Promise<string> {
  await db
    .update(schema.authTokens)
    .set({ usedAt: new Date() })
    .where(
      and(eq(schema.authTokens.userId, userId), eq(schema.authTokens.kind, kind), isNull(schema.authTokens.usedAt)),
    );
  const token = newToken();
  await db.insert(schema.authTokens).values({
    id: nanoid(),
    userId,
    kind,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + ttlS * 1000),
  });
  return token;
}

// Consume a one-time token: returns its user, or null. Marking it used
// and reading it are one UPDATE … RETURNING, so two clicks on the same
// link cannot both succeed.
async function consumeOneTime(token: string, kind: OneTimeKind): Promise<string | null> {
  const [row] = await db
    .update(schema.authTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(schema.authTokens.tokenHash, hashToken(token)),
        eq(schema.authTokens.kind, kind),
        isNull(schema.authTokens.usedAt),
        gt(schema.authTokens.expiresAt, new Date()),
      ),
    )
    .returning({ userId: schema.authTokens.userId });
  return row?.userId ?? null;
}

async function lastIssuedAt(userId: string, kind: OneTimeKind): Promise<Date | null> {
  const [row] = await db
    .select({ at: sql<Date | null>`max(${schema.authTokens.createdAt})` })
    .from(schema.authTokens)
    .where(and(eq(schema.authTokens.userId, userId), eq(schema.authTokens.kind, kind)));
  return row?.at ? new Date(row.at) : null;
}

function clientDeviceId(raw: unknown, fallback: string): string {
  return typeof raw === 'string' && raw.length >= 8 && raw.length <= 128 ? raw : fallback;
}

function fail(reply: FastifyReply, status: number, error: string): { error: string } {
  reply.code(status);
  return { error };
}

// The hook leaves authVia empty only on the routes it bypasses, none
// of which read it; on the identified routes it is always set.
function viaOf(req: { authVia: SessionVia | '' }): SessionVia {
  return req.authVia === '' ? 'device' : req.authVia;
}

async function sendVerification(user: UserRow, log: Log): Promise<boolean> {
  if (!user.email) return false;
  const token = await issueOneTime(user.id, 'verify', VERIFY_TTL_S);
  const result = await sendEmail(verifyMail(user.email, user.username, token), log);
  return result.sent;
}

const plugin: FastifyPluginAsync = async (app) => {
  if (registrationRequired() && !mailConfigured()) {
    app.log.warn(
      { kind: 'auth_config' },
      '[auth] the door is up but no mail sender is configured (RESEND_API_KEY / EMAIL_FROM): ' +
        'registration will not require e-mail verification until it is',
    );
  }

  // ---- With an identity ----

  app.get('/auth/me', limitPolling, async (req, reply) => {
    const user = await loadUser(req.userId);
    if (!user) return fail(reply, 404, 'not_found');
    issueSlip(reply, user, req.deviceId, viaOf(req));
    return buildMe(user, viaOf(req));
  });

  app.post<{
    Body: {
      nickname?: unknown;
      petName?: unknown;
      petSpecies?: unknown;
      petBreed?: unknown;
      email?: unknown;
      password?: unknown;
      consent?: unknown;
    };
  }>('/auth/register', limitExpensive, async (req, reply) => {
    const user = await loadUser(req.userId);
    if (!user) return fail(reply, 404, 'not_found');
    // Already through: nothing to do, and no way to quietly change a
    // verified e-mail or password from an unauthenticated form.
    if (user.registeredAt && user.emailVerifiedAt) return fail(reply, 409, 'already_registered');

    const body = req.body ?? {};
    const nickname = normaliseNickname(body.nickname);
    if (!nickname) return fail(reply, 400, 'nickname_invalid');
    const email = normaliseEmail(body.email);
    if (!email) return fail(reply, 400, 'email_invalid');
    const pwProblem = passwordProblem(body.password);
    if (pwProblem) return fail(reply, 400, `password_${pwProblem}`);
    if (body.consent !== true) return fail(reply, 400, 'consent_required');
    const petSpecies = body.petSpecies == null || body.petSpecies === '' ? null : normaliseSpecies(body.petSpecies);
    if (body.petSpecies && !petSpecies) return fail(reply, 400, 'species_invalid');
    const petName = body.petName ? normaliseShortText(body.petName, PET_NAME_MAX) : null;
    if (body.petName && !petName) return fail(reply, 400, 'pet_name_invalid');
    const petBreed = body.petBreed ? normaliseShortText(body.petBreed, BREED_MAX) : null;
    if (body.petBreed && !petBreed) return fail(reply, 400, 'breed_invalid');

    const owner = await findByEmail(email);
    if (owner && owner.id !== user.id) return fail(reply, 409, 'email_taken');
    const nicknameKey = foldNickname(nickname);
    const [nick] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(and(eq(schema.users.nicknameKey, nicknameKey), ne(schema.users.id, user.id)))
      .limit(1);
    if (nick) return fail(reply, 409, 'nickname_taken');

    const passwordHash = await hashPassword(body.password as string);
    const now = new Date();
    const emailChanged = user.email?.toLowerCase() !== email;
    const [updated] = await db
      .update(schema.users)
      .set({
        username: nickname,
        nicknameKey,
        email,
        // A corrected address must be verified again; the same address
        // keeps whatever verification it had.
        emailVerifiedAt: emailChanged ? null : user.emailVerifiedAt,
        passwordHash,
        petName,
        petSpecies,
        petBreed,
        registeredAt: user.registeredAt ?? now,
        consentAt: now,
      })
      .where(eq(schema.users.id, user.id))
      .returning();
    if (!updated) return fail(reply, 500, 'update_failed');

    // The companion takes the real pet's name (D-69). Renaming later is
    // the profile's job; this is the default, set once, at the door.
    if (petName) {
      await db
        .update(schema.companionState)
        .set({ name: petName })
        .where(eq(schema.companionState.userId, user.id));
    }

    let emailSent = false;
    if (!updated.emailVerifiedAt) emailSent = await sendVerification(updated, req.log);
    req.log.info(
      { kind: 'auth_register', user: user.id, via: viaOf(req), emailSent, hasPet: !!petName },
      '[auth] registered',
    );
    issueSlip(reply, updated, req.deviceId, viaOf(req));
    return { ok: true, emailSent, me: buildMe(updated, viaOf(req)) };
  });

  app.post('/auth/resend', limitExpensive, async (req, reply) => {
    const user = await loadUser(req.userId);
    if (!user) return fail(reply, 404, 'not_found');
    if (!user.email || !user.registeredAt) return fail(reply, 400, 'not_registered');
    if (user.emailVerifiedAt) return { ok: true, emailSent: false, alreadyVerified: true };
    const last = await lastIssuedAt(user.id, 'verify');
    if (last && Date.now() - last.getTime() < RESEND_COOLDOWN_S * 1000) {
      return fail(reply, 429, 'resend_cooldown');
    }
    const emailSent = await sendVerification(user, req.log);
    return { ok: true, emailSent };
  });

  // ---- Before any identity (bypassed by the auth hook) ----

  app.post<{ Body: { token?: unknown; deviceId?: unknown } }>('/auth/verify', limitAuth, async (req, reply) => {
    const token = normaliseToken(req.body?.token);
    if (!token) return fail(reply, 400, 'token_invalid');
    const userId = await consumeOneTime(token, 'verify');
    if (!userId) return fail(reply, 400, 'token_expired');
    const [user] = await db
      .update(schema.users)
      .set({ emailVerifiedAt: new Date() })
      .where(eq(schema.users.id, userId))
      .returning();
    if (!user) return fail(reply, 404, 'not_found');
    // The device that clicked the link is logged in, whichever device
    // that is: the mail may well be opened on a different phone than
    // the one that registered.
    const deviceId = clientDeviceId(req.body?.deviceId, `acct:${user.id}`);
    const session = issueSlip(reply, user, deviceId, 'email');
    const refresh = await openRefresh(user.id, deviceId);
    req.log.info({ kind: 'auth_verify', user: user.id }, '[auth] e-mail verified');
    return { ok: true, session, refresh, me: buildMe(user, 'email') };
  });

  app.post<{ Body: { email?: unknown; password?: unknown; deviceId?: unknown } }>(
    '/auth/login',
    limitAuth,
    async (req, reply) => {
      const email = normaliseEmail(req.body?.email);
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      // Unknown address and wrong password answer identically, and
      // verifyPassword spends a derivation either way.
      const user = email ? await findByEmail(email) : null;
      const ok = await verifyPassword(password.slice(0, 200), user?.passwordHash);
      if (!user || !ok) return fail(reply, 401, 'bad_credentials');
      if (needsRehash(user.passwordHash)) {
        await db
          .update(schema.users)
          .set({ passwordHash: await hashPassword(password) })
          .where(eq(schema.users.id, user.id));
      }
      const deviceId = clientDeviceId(req.body?.deviceId, `acct:${user.id}`);
      const session = issueSlip(reply, user, deviceId, 'email');
      if (!session) return fail(reply, 503, 'sessions_unconfigured');
      const refresh = await openRefresh(user.id, deviceId);
      req.log.info({ kind: 'auth_login', user: user.id }, '[auth] login');
      return { ok: true, session, refresh, me: buildMe(user, 'email') };
    },
  );

  app.post<{ Body: { refresh?: unknown; deviceId?: unknown } }>('/auth/refresh', limitAuth, async (req, reply) => {
    const refresh = normaliseToken(req.body?.refresh);
    if (!refresh) return fail(reply, 400, 'token_invalid');
    const [row] = await db
      .update(schema.authSessions)
      .set({ lastUsedAt: new Date() })
      .where(
        and(
          eq(schema.authSessions.tokenHash, hashToken(refresh)),
          isNull(schema.authSessions.revokedAt),
          gt(schema.authSessions.expiresAt, new Date()),
        ),
      )
      .returning({ userId: schema.authSessions.userId, deviceId: schema.authSessions.deviceId });
    if (!row) return fail(reply, 401, 'refresh_invalid');
    const user = await loadUser(row.userId);
    if (!user) return fail(reply, 401, 'refresh_invalid');
    const deviceId = clientDeviceId(req.body?.deviceId, row.deviceId ?? `acct:${user.id}`);
    const session = issueSlip(reply, user, deviceId, 'email');
    if (!session) return fail(reply, 503, 'sessions_unconfigured');
    return { ok: true, session, me: buildMe(user, 'email') };
  });

  app.post<{ Body: { refresh?: unknown } }>('/auth/logout', limitAuth, async (req) => {
    const refresh = normaliseToken(req.body?.refresh);
    if (refresh) {
      await db
        .update(schema.authSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(schema.authSessions.tokenHash, hashToken(refresh)), isNull(schema.authSessions.revokedAt)));
    }
    return { ok: true };
  });

  app.post<{ Body: { email?: unknown } }>('/auth/forgot', limitAuth, async (req) => {
    const email = normaliseEmail(req.body?.email);
    // Always the same answer, so the form cannot be used to learn
    // which addresses have accounts.
    if (!email) return { ok: true };
    const user = await findByEmail(email);
    if (user && user.registeredAt) {
      const token = await issueOneTime(user.id, 'reset', RESET_TTL_S);
      await sendEmail(resetMail(user.email!, user.username, token), req.log);
      req.log.info({ kind: 'auth_forgot', user: user.id }, '[auth] reset mail issued');
    }
    return { ok: true };
  });

  app.post<{ Body: { token?: unknown; password?: unknown; deviceId?: unknown } }>(
    '/auth/reset',
    limitAuth,
    async (req, reply) => {
      const token = normaliseToken(req.body?.token);
      if (!token) return fail(reply, 400, 'token_invalid');
      const pwProblem = passwordProblem(req.body?.password);
      if (pwProblem) return fail(reply, 400, `password_${pwProblem}`);
      const userId = await consumeOneTime(token, 'reset');
      if (!userId) return fail(reply, 400, 'token_expired');
      const current = await loadUser(userId);
      if (!current) return fail(reply, 404, 'not_found');
      const [user] = await db
        .update(schema.users)
        .set({
          passwordHash: await hashPassword(req.body!.password as string),
          // Following a link from the inbox proves the inbox.
          emailVerifiedAt: current.emailVerifiedAt ?? new Date(),
        })
        .where(eq(schema.users.id, userId))
        .returning();
      if (!user) return fail(reply, 404, 'not_found');
      // Every other login dies with the old password.
      await revokeAllRefresh(user.id);
      const deviceId = clientDeviceId(req.body?.deviceId, `acct:${user.id}`);
      const session = issueSlip(reply, user, deviceId, 'email');
      const refresh = await openRefresh(user.id, deviceId);
      req.log.info({ kind: 'auth_reset', user: user.id }, '[auth] password reset');
      return { ok: true, session, refresh, me: buildMe(user, 'email') };
    },
  );
};

export default plugin;

// Paths the auth hook must not put an identity in front of. Named
// here, next to the routes, so the two lists cannot drift apart.
export const PRE_IDENTITY_AUTH_PATHS = new Set([
  '/auth/verify',
  '/auth/login',
  '/auth/refresh',
  '/auth/logout',
  '/auth/forgot',
  '/auth/reset',
]);
