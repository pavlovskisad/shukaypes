import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { db, schema } from './db/index.js';
import { validateInitData, type TelegramUser } from './services/telegramAuth.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
    deviceId: string;
  }
}

const DEVICE_ID_HEADER = 'x-device-id';
const TELEGRAM_INIT_HEADER = 'x-telegram-init-data';

async function resolveByDeviceId(deviceId: string): Promise<string> {
  const [existing] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.deviceId, deviceId))
    .limit(1);
  if (existing) return existing.id;

  const id = nanoid();
  const username = `walker-${deviceId.slice(0, 6)}`;
  await db.insert(schema.users).values({ id, deviceId, username });
  await db.insert(schema.companionState).values({ userId: id });
  return id;
}

// Mini App users get a synthetic device_id ('tg:<telegram_id>') so
// the column stays NOT NULL + UNIQUE without a schema break. If the
// same Telegram user later opens the PWA without TG (different device,
// no Mini App), they'd come in via x-device-id with a different
// browser-generated id — that's a separate account row, account
// merging is a follow-up.
async function resolveByTelegram(tgUser: TelegramUser): Promise<string> {
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
  const id = nanoid();
  const deviceId = `tg:${tgUser.id}`;
  const username = tgUser.username ?? tgUser.first_name ?? `walker-${String(tgUser.id).slice(-6)}`;
  await db.insert(schema.users).values({
    id,
    deviceId,
    username,
    telegramId: tgUser.id,
    telegramUsername: tgUser.username ?? null,
    telegramFirstName: tgUser.first_name ?? null,
    telegramPhotoUrl: tgUser.photo_url ?? null,
  });
  await db.insert(schema.companionState).values({ userId: id });
  return id;
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

    // Prefer Telegram initData when present — it's a stronger
    // identity (signed by Telegram with our bot token) and lets a
    // Mini App user keep the same account across devices.
    const tgHeader = req.headers[TELEGRAM_INIT_HEADER];
    const tgRaw = Array.isArray(tgHeader) ? tgHeader[0] : tgHeader;
    if (tgRaw && tgRaw.length > 0) {
      const validated = validateInitData(tgRaw);
      if (validated) {
        req.deviceId = `tg:${validated.user.id}`;
        req.userId = await resolveByTelegram(validated.user);
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
    req.userId = await resolveByDeviceId(deviceId);
  });
};

export default fp(plugin, { name: 'auth' });
