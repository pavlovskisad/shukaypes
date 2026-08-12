import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { db, schema } from './db/index.js';
import { validateInitData, type TelegramUser } from './services/telegramAuth.js';
import { claimInvite, mustPresentInvite, normaliseCode, recordRedemption } from './services/invites.js';

type Log = Pick<FastifyRequest['log'], 'info' | 'warn'>;

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
    deviceId: string;
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

async function resolveByDeviceId(
  deviceId: string,
  invite: string | null,
  log: Log,
): Promise<string> {
  const [existing] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.deviceId, deviceId))
    .limit(1);
  // EVERY EXISTING ACCOUNT RETURNS HERE, unconditionally. No invite
  // check, no flag, nothing added to this branch — see services/invites.ts
  // for why. Whatever changes below, this line must keep meaning "you
  // already have an account, come in".
  if (existing) return existing.id;

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
  return userId;
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
): Promise<string> {
  const [existing] = await db
    .select({ id: schema.users.id })
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
    return existing.id;
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
  return userId;
}

const plugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest('userId', '');
  app.decorateRequest('deviceId', '');

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

    // Prefer Telegram initData when present — it's a stronger
    // identity (signed by Telegram with our bot token) and lets a
    // Mini App user keep the same account across devices.
    // Only consulted when creating an account — an existing user never
    // needs to present one. Sent as a header by the client, which picks
    // it up from an ?invite= link or the Mini App start parameter.
    const inviteHeader = req.headers[INVITE_CODE_HEADER];
    const invite = (Array.isArray(inviteHeader) ? inviteHeader[0] : inviteHeader) ?? null;

    const tgHeader = req.headers[TELEGRAM_INIT_HEADER];
    const tgRaw = Array.isArray(tgHeader) ? tgHeader[0] : tgHeader;
    if (tgRaw && tgRaw.length > 0) {
      const validated = validateInitData(tgRaw);
      if (validated) {
        req.deviceId = `tg:${validated.user.id}`;
        try {
          req.userId = await resolveByTelegram(validated.user, invite, req.log);
        } catch (err) {
          if (err instanceof InviteRequiredError) {
            reply.code(403);
            throw new Error('invite required');
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
    try {
      req.userId = await resolveByDeviceId(deviceId, invite, req.log);
    } catch (err) {
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
