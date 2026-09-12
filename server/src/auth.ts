import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { db, schema } from './db/index.js';
import { validateInitData, type TelegramUser } from './services/telegramAuth.js';
import { claimInvite, mustPresentInvite, normaliseCode, recordRedemption } from './services/invites.js';
import {
  SESSION_HEADER,
  SESSION_ISSUE_HEADER,
  mintSession,
  sessionNeedsRenewal,
  verifySession,
  type SessionVia,
} from './lib/session.js';
import { doorFor, passesDoor, registrationRequired } from './lib/accountPolicy.js';
import { PRE_IDENTITY_AUTH_PATHS } from './routes/auth.js';

type Log = Pick<FastifyRequest['log'], 'info' | 'warn'>;

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
    deviceId: string;
    // How this request was identified: 'telegram', 'device' or
    // 'email'. Empty on the routes the hook bypasses.
    authVia: SessionVia | '';
  }
}

// What the hook learns about an account when it resolves a row: the
// id, and whether the person is through the door (lib/accountPolicy),
// which is stamped into the session slip so no later request needs a
// database read to know.
interface Resolved {
  id: string;
  registered: boolean;
}

function resolved(row: { id: string; registeredAt: Date | null; emailVerifiedAt: Date | null }): Resolved {
  return { id: row.id, registered: doorFor(row) === 'open' };
}

export class RegistrationRequiredError extends Error {
  constructor() {
    super('registration required');
    this.name = 'RegistrationRequiredError';
  }
}

const DEVICE_ID_HEADER = 'x-device-id';
const TELEGRAM_INIT_HEADER = 'x-telegram-init-data';
const INVITE_CODE_HEADER = 'x-invite-code';

export class InviteRequiredError extends Error {
  constructor() {
    super('invite code required');
    this.name = 'InviteRequiredError';
  }
}

const ACCOUNT_FACTS = {
  id: schema.users.id,
  registeredAt: schema.users.registeredAt,
  emailVerifiedAt: schema.users.emailVerifiedAt,
};

async function resolveByDeviceId(
  deviceId: string,
  invite: string | null,
  log: Log,
): Promise<Resolved> {
  const [existing] = await db
    .select(ACCOUNT_FACTS)
    .from(schema.users)
    .where(eq(schema.users.deviceId, deviceId))
    .limit(1);
  // EVERY EXISTING ACCOUNT RETURNS HERE, unconditionally. No invite
  // check, no flag, nothing added to this branch — see services/invites.ts
  // for why. Whatever changes below, this line must keep meaning "you
  // already have an account, come in". (The DOOR is not this: a row
  // that has not registered keeps its account and is asked to register
  // it — see D-69.)
  if (existing) return resolved(existing);

  // Past this point we are creating an account, which is the only thing
  // the closed beta actually needs to control. `mustPresentInvite` is a
  // pure predicate with its own fixture check asserting that an existing
  // account is never gated under any configuration.
  let claimedCode: string | null = null;
  if (mustPresentInvite({ hasExistingAccount: false })) {
    const code = normaliseCode(invite);
    if (!code || !(await claimInvite(code, log))) throw new InviteRequiredError();
    claimedCode = code;
  }

  const id = nanoid();
  const username = `walker-${deviceId.slice(0, 6)}`;
  // onConflictDoNothing + re-select, because this used to be a plain
  // check-then-insert with no transaction against a UNIQUE column. The
  // client fires /sync/map, /state and /places/spots concurrently on a
  // cold start, so on a first launch several requests raced: both missed
  // the SELECT, both inserted, one took a unique violation, and the
  // exception escaped the preHandler as a 500 on the very first screen
  // a new user ever sees. It could also leave a users row with no
  // companion_state, which then 404s /sync/map forever.
  const inserted = await db
    .insert(schema.users)
    .values({ id, deviceId, username })
    .onConflictDoNothing({ target: schema.users.deviceId })
    .returning({ id: schema.users.id });

  const userId = inserted[0]?.id ?? (await resolveExistingDeviceId(deviceId));
  if (!userId) throw new Error(`could not resolve user for device ${deviceId.slice(0, 8)}…`);

  // Same treatment: the companion row must exist even if a racing
  // request created it first.
  await db.insert(schema.companionState).values({ userId }).onConflictDoNothing();

  if (claimedCode) await recordRedemption(claimedCode, userId, log);
  // A row made this instant has registered nothing.
  return { id: userId, registered: !registrationRequired() };
}

// The row a concurrent request inserted while we were losing the race.
async function resolveExistingDeviceId(deviceId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.deviceId, deviceId))
    .limit(1);
  return row?.id ?? null;
}

// Mini App users get a synthetic device_id ('tg:<telegram_id>') so
// the column stays NOT NULL + UNIQUE without a schema break. If the
// same Telegram user later opens the PWA without TG (different device,
// no Mini App), they'd come in via x-device-id with a different
// browser-generated id — that's a separate account row, account
// merging is a follow-up.
async function resolveByTelegram(
  tgUser: TelegramUser,
  invite: string | null,
  log: Log,
): Promise<Resolved> {
  const [existing] = await db
    .select(ACCOUNT_FACTS)
    .from(schema.users)
    .where(eq(schema.users.telegramId, tgUser.id))
    .limit(1);
  if (existing) {
    // Profile fields can change on Telegram's side (renamed, new
    // avatar) — refresh them opportunistically every authed request.
    // Cheap UPDATE on a single PK lookup.
    await db
      .update(schema.users)
      .set({
        telegramUsername: tgUser.username ?? null,
        telegramFirstName: tgUser.first_name ?? null,
        telegramPhotoUrl: tgUser.photo_url ?? null,
      })
      .where(eq(schema.users.id, existing.id));
    return resolved(existing);
  }
  // Creation, so the same gate applies. Telegram gives a signed
  // identity, which is a stronger claim about WHO somebody is — but not
  // a claim that they were invited, and the bot is discoverable.
  let claimedCode: string | null = null;
  if (mustPresentInvite({ hasExistingAccount: false })) {
    const code = normaliseCode(invite);
    if (!code || !(await claimInvite(code, log))) throw new InviteRequiredError();
    claimedCode = code;
  }

  const id = nanoid();
  const deviceId = `tg:${tgUser.id}`;
  const username = tgUser.username ?? tgUser.first_name ?? `walker-${String(tgUser.id).slice(-6)}`;
  // Same race as the device-id path: a Mini App cold start fires several
  // requests at once, and telegram_id carries a UNIQUE constraint.
  const inserted = await db
    .insert(schema.users)
    .values({
      id,
      deviceId,
      username,
      telegramId: tgUser.id,
      telegramUsername: tgUser.username ?? null,
      telegramFirstName: tgUser.first_name ?? null,
      telegramPhotoUrl: tgUser.photo_url ?? null,
    })
    .onConflictDoNothing({ target: schema.users.telegramId })
    .returning({ id: schema.users.id });

  let userId = inserted[0]?.id ?? null;
  if (!userId) {
    const [row] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.telegramId, tgUser.id))
      .limit(1);
    userId = row?.id ?? null;
  }
  if (!userId) throw new Error(`could not resolve user for telegram id ${tgUser.id}`);

  await db.insert(schema.companionState).values({ userId }).onConflictDoNothing();
  if (claimedCode) await recordRedemption(claimedCode, userId, log);
  return { id: userId, registered: !registrationRequired() };
}

// Hand the client a session token for the identity just resolved. See
// lib/session.ts. A null (no secret configured) sets no header, and the
// client keeps identifying itself the old way on every request.
function issueSession(
  reply: { header: (name: string, value: string) => unknown },
  userId: string,
  deviceId: string,
  via: SessionVia,
  registered: boolean,
): void {
  const token = mintSession({ userId, deviceId, via, registered });
  if (token) reply.header(SESSION_ISSUE_HEADER, token);
}

// THE DOOR. Once somebody is identified, everything but /auth/* is
// refused until their account is registered (and verified, when mail
// is configured) — D-69. A 403 with this text, like the invite gate's,
// is a state for the client to draw, not a fault.
//
// The account itself is never touched here: a row that meets the door
// keeps its id, its dog and its ground, and /auth/register writes onto
// that same row. The invariant that an existing account is never LOST
// to a gate (D-35) holds; what changed is that it must be finished
// before the map opens.
function passDoor(path: string | undefined, registered: boolean): void {
  if (registered) return;
  if (!registrationRequired()) return;
  if (passesDoor(path)) return;
  throw new RegistrationRequiredError();
}

const plugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest('userId', '');
  app.decorateRequest('deviceId', '');
  app.decorateRequest('authVia', '');

  app.addHook('preHandler', async (req: FastifyRequest, reply) => {
    // routeOptions.url is unset on unmatched routes — 404s, and the deploy-lag
    // window when new routes aren't registered yet. Fall back to the raw URL
    // so the /admin/* bypass holds before Fastify has matched anything.
    const matched = req.routeOptions?.url;
    const raw = req.url ? req.url.split('?')[0] : undefined;
    const path = matched ?? raw;
    if (path === '/health' || path === '/health/deep') return;
    if (path === '/stats') return;
    if (path?.startsWith('/admin/')) return;
    // Telegram webhook is authenticated by its own secret token
    // header (see routes/telegram.ts), not by our app's auth.
    if (path === '/telegram/webhook') return;
    // Crash reports must work for somebody with no account — including
    // somebody whose crash IS account creation failing. Authenticating
    // it would also mint a user row for every visitor who ever throws.
    if (path === '/client-errors') return;
    // Photo proxy is fetched by plain <img src> tags, which cannot
    // carry our x-device-id / x-telegram-init-data headers — auth here
    // would 401 every image. It serves only photos already posted to
    // public lost-pet groups, keyed by an opaque TG file_id, so it's
    // safe to leave open.
    if (path?.startsWith('/photos/')) return;
    // Logging in, following a verification or reset link, trading a
    // refresh token: a fresh browser must be able to do these WITHOUT
    // first being minted an anonymous account. Each is rate-limited by
    // address and authenticates by what it carries (routes/auth.ts).
    if (path && PRE_IDENTITY_AUTH_PATHS.has(path)) return;

    // Prefer Telegram initData when present — it's a stronger
    // identity (signed by Telegram with our bot token) and lets a
    // Mini App user keep the same account across devices.
    // Only consulted when creating an account — an existing user never
    // needs to present one. Sent as a header by the client, which picks
    // it up from an ?invite= link or the Mini App start parameter.
    const inviteHeader = req.headers[INVITE_CODE_HEADER];
    const invite = (Array.isArray(inviteHeader) ? inviteHeader[0] : inviteHeader) ?? null;

    // A SESSION TOKEN FIRST: no database, no HMAC over a kilobyte of
    // initData, no profile-refresh UPDATE. A token in its last hours is
    // re-issued on the way out. An invalid or expired one is ignored
    // rather than refused — the client sends nothing else alongside a
    // token, so it lands on the 401 below, drops the token, and
    // re-identifies the old way on its retry. See lib/session.ts.
    const sessionHeader = req.headers[SESSION_HEADER];
    const sessionRaw = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
    if (sessionRaw && sessionRaw.length > 0) {
      const claims = verifySession(sessionRaw);
      if (claims) {
        req.userId = claims.userId;
        req.deviceId = claims.deviceId;
        req.authVia = claims.via;
        if (sessionNeedsRenewal(claims)) {
          issueSession(reply, claims.userId, claims.deviceId, claims.via, claims.registered);
        }
        try {
          passDoor(path, claims.registered);
        } catch (err) {
          if (err instanceof RegistrationRequiredError) {
            reply.code(403);
            throw new Error('registration required');
          }
          throw err;
        }
        return;
      }
    }

    const tgHeader = req.headers[TELEGRAM_INIT_HEADER];
    const tgRaw = Array.isArray(tgHeader) ? tgHeader[0] : tgHeader;
    if (tgRaw && tgRaw.length > 0) {
      const validated = validateInitData(tgRaw);
      if (validated) {
        req.deviceId = `tg:${validated.user.id}`;
        req.authVia = 'telegram';
        try {
          const account = await resolveByTelegram(validated.user, invite, req.log);
          req.userId = account.id;
          issueSession(reply, req.userId, req.deviceId, 'telegram', account.registered);
          passDoor(path, account.registered);
        } catch (err) {
          if (err instanceof InviteRequiredError) {
            reply.code(403);
            throw new Error('invite required');
          }
          if (err instanceof RegistrationRequiredError) {
            reply.code(403);
            throw new Error('registration required');
          }
          throw err;
        }
        return;
      }
      // Bad signature, expired payload, or bot token unset → fall
      // through and try the device-id header. If neither works the
      // 401 below fires.
    }

    const header = req.headers[DEVICE_ID_HEADER];
    const deviceId = Array.isArray(header) ? header[0] : header;
    if (!deviceId || deviceId.length < 8 || deviceId.length > 128) {
      reply.code(401);
      throw new Error('missing or invalid x-device-id header');
    }
    req.deviceId = deviceId;
    req.authVia = 'device';
    try {
      const account = await resolveByDeviceId(deviceId, invite, req.log);
      req.userId = account.id;
      issueSession(reply, req.userId, deviceId, 'device', account.registered);
      passDoor(path, account.registered);
    } catch (err) {
      if (err instanceof RegistrationRequiredError) {
        reply.code(403);
        throw new Error('registration required');
      }
      if (err instanceof InviteRequiredError) {
        // 403, not 401: the credentials are fine, the door is shut. A
        // 401 would read to the client as "your device id is broken",
        // which is the wrong thing to tell somebody who simply has not
        // been invited yet.
        reply.code(403);
        throw new Error('invite required');
      }
      throw err;
    }
  });
};

export default fp(plugin, { name: 'auth' });
