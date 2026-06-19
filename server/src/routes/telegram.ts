// Telegram Bot wiring for шукайпес. Receives Telegram updates via
// webhook, replies to /start with a Mini App button that opens the
// PWA inside Telegram with one tap. Auth there happens automatically
// via initData (see server/src/services/telegramAuth.ts).
//
// Webhook URL:    https://shukajpes-api.fly.dev/telegram/webhook
// Webhook secret: TELEGRAM_WEBHOOK_SECRET env (optional but checked
//                 when set — protects against a leaked URL).
// Mini App URL:   TELEGRAM_MINI_APP_URL env, falls back to the
//                 Vercel deploy.

import type { FastifyPluginAsync } from 'fastify';

const TG_API = 'https://api.telegram.org';

interface TgPhoto {
  file_id: string;
  width: number;
  height: number;
}

interface TgUpdate {
  message?: {
    message_id: number;
    chat: { id: number; type: 'private' | 'group' | 'supergroup' | 'channel'; title?: string };
    from?: { id: number; first_name?: string; username?: string };
    text?: string;
    caption?: string;
    photo?: TgPhoto[];
  };
}

async function sendMessage(
  chatId: number,
  text: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`${TG_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        ...extra,
      }),
    });
  } catch {
    /* best-effort — webhook still returns 200 to TG */
  }
}

function miniAppUrl(): string {
  return process.env.TELEGRAM_MINI_APP_URL ?? 'https://shukaypes.vercel.app';
}

// Inline keyboard with a web_app button — tapping opens the Mini App
// inside Telegram, no browser switch, auth via initData.
function openAppKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: '🐾 open шукайпес',
          web_app: { url: miniAppUrl() },
        },
      ],
    ],
  };
}

async function handleStart(chatId: number, firstName?: string): Promise<void> {
  const hi = firstName ? `привіт, ${firstName}!` : 'привіт!';
  const text = [
    `${hi} i'm <b>шукайпес</b> — your kyiv walking companion.`,
    '',
    'we walk, we sniff, we find lost pets, we learn the city paw by paw.',
    '',
    'tap below to open the map. 🐾',
  ].join('\n');
  await sendMessage(chatId, text, { reply_markup: openAppKeyboard() });
}

// Catch-all reply for any other DM text — friendly nudge to the
// same button so users don't bounce on a wall of silence.
async function handleOtherDm(chatId: number): Promise<void> {
  await sendMessage(
    chatId,
    "i'm just a dog with a map — tap below and we walk together.",
    { reply_markup: openAppKeyboard() },
  );
}

// Heuristic: does this group message look like a lost-pet post?
// Ukrainian, Russian, English keywords + needs at least a photo or a
// substantial caption so we don't bark at every chat message.
const LOST_PET_RE =
  /\b(загубив(ся|ся|сь|ся)|загубилася|зник|зникла|пропав|пропала|пропал[ао]?|потерялся|потерялась|потерян|ищу собаку|ищу кота|ищу пса|шукаю собак|шукаю кота|lost|missing|reward|винагорода|нагорода)\b/i;

function looksLikeLostPet(msg: NonNullable<TgUpdate['message']>): boolean {
  const text = `${msg.text ?? ''} ${msg.caption ?? ''}`.trim();
  if (text.length < 20) return false;
  if (!LOST_PET_RE.test(text)) return false;
  // Photo isn't strictly required (some posts are text-only) but a
  // photo + keyword combo is the strongest signal. Allow text-only
  // when caption is long enough to look like a real description.
  if (!msg.photo && text.length < 60) return false;
  return true;
}

async function handleGroupLostPet(
  chatId: number,
  messageId: number,
): Promise<void> {
  // Reply to the original post so the thread reads naturally.
  await sendMessage(
    chatId,
    "*sniff sniff* — looks like a lost one. open me to start a search:",
    {
      reply_to_message_id: messageId,
      reply_markup: openAppKeyboard(),
    },
  );
}

const plugin: FastifyPluginAsync = async (app) => {
  app.post<{ Body: TgUpdate }>('/telegram/webhook', async (req, reply) => {
    // Verify Telegram's secret token if we set one. Without this
    // anyone who guesses the webhook URL could spam our bot via us.
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (secret) {
      const got = req.headers['x-telegram-bot-api-secret-token'];
      if (got !== secret) {
        reply.code(403);
        return { ok: false };
      }
    }

    const update = req.body;
    const msg = update?.message;
    if (msg) {
      if (msg.chat?.type === 'private' && typeof msg.text === 'string') {
        const chatId = msg.chat.id;
        const firstName = msg.from?.first_name;
        if (msg.text.startsWith('/start')) {
          await handleStart(chatId, firstName);
        } else {
          await handleOtherDm(chatId);
        }
      } else if (
        (msg.chat?.type === 'group' || msg.chat?.type === 'supergroup') &&
        looksLikeLostPet(msg)
      ) {
        await handleGroupLostPet(msg.chat.id, msg.message_id);
      }
    }
    // Always ack — anything other than 200 makes Telegram retry the
    // same update for hours. Errors get swallowed inside handlers.
    return { ok: true };
  });
};

export default plugin;

// Idempotent webhook + bot-commands registration. Safe to call on
// every boot; Telegram accepts repeat setWebhook calls and just
// overwrites. Surfaces a clear log line so we can tell from `fly
// logs` whether the bot is actually subscribed.
export async function registerTelegramWebhook(
  publicUrl: string,
  log: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void },
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    log.warn({ kind: 'telegram_webhook' }, '[telegram] TELEGRAM_BOT_TOKEN missing — bot disabled');
    return;
  }
  try {
    const url = `${publicUrl.replace(/\/$/, '')}/telegram/webhook`;
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    const body: Record<string, unknown> = {
      url,
      allowed_updates: ['message'],
      drop_pending_updates: false,
    };
    if (secret) body.secret_token = secret;
    const res = await fetch(`${TG_API}/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { ok: boolean; description?: string };
    if (json.ok) {
      log.info({ kind: 'telegram_webhook', url }, '[telegram] webhook registered');
    } else {
      log.warn(
        { kind: 'telegram_webhook', err: json.description },
        '[telegram] setWebhook failed',
      );
    }
    // Publish /start so it shows in the bot's command menu.
    await fetch(`${TG_API}/bot${token}/setMyCommands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        commands: [{ command: 'start', description: 'open шукайпес' }],
      }),
    });
    // Description appears as the 'What can this bot do?' panel
    // Telegram shows BEFORE the user sends anything — exactly the
    // 'who's here?' moment we want a hint at.
    await fetch(`${TG_API}/bot${token}/setMyDescription`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        description:
          "woof! who's here?! type /start (or tap the button below) and we go sniffin 🐾",
      }),
    });
    // Short description shows on the bot's profile card.
    await fetch(`${TG_API}/bot${token}/setMyShortDescription`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        short_description: 'every walk has a purpose. 🐾',
      }),
    });
    // Chat menu button — replaces the default '/' menu with a one-tap
    // shortcut into the Mini App. Persistent at the bottom-left of
    // the chat input.
    await fetch(`${TG_API}/bot${token}/setChatMenuButton`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        menu_button: {
          type: 'web_app',
          text: 'open шукайпес',
          web_app: { url: miniAppUrl() },
        },
      }),
    });
  } catch (err) {
    log.warn(
      { kind: 'telegram_webhook', err: (err as Error).message },
      '[telegram] webhook setup errored',
    );
  }
}
