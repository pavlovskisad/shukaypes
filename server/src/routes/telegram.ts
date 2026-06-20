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

// Logger handle for sendMessage. Set on plugin init so the helper can
// report TG API failures without us threading a logger through every
// caller. Falls back to console when unset (e.g. in tests).
let sendLog: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void } = {
  info: (o, m) => console.log(m ?? '', o),
  warn: (o, m) => console.warn(m ?? '', o),
};

async function sendMessage(
  chatId: number,
  text: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    const res = await fetch(`${TG_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        ...extra,
      }),
    });
    // Capture TG's response so silent failures (e.g. 'not enough rights
    // to send messages', 'message to reply not found', HTML parse
    // errors) actually show up in fly logs.
    const json = (await res.json().catch(() => null)) as
      | { ok: boolean; description?: string; error_code?: number }
      | null;
    if (!json?.ok) {
      sendLog.warn(
        {
          kind: 'telegram_send',
          chat_id: chatId,
          status: res.status,
          error_code: json?.error_code,
          description: json?.description,
          preview: text.slice(0, 80),
        },
        '[telegram] sendMessage failed',
      );
    } else {
      sendLog.info(
        { kind: 'telegram_send', chat_id: chatId, preview: text.slice(0, 80) },
        '[telegram] sendMessage ok',
      );
    }
  } catch (err) {
    sendLog.warn(
      { kind: 'telegram_send', chat_id: chatId, err: (err as Error).message },
      '[telegram] sendMessage threw',
    );
  }
}

function miniAppUrl(): string {
  return process.env.TELEGRAM_MINI_APP_URL ?? 'https://shukaypes.vercel.app';
}

function botUsername(): string {
  return process.env.TELEGRAM_BOT_USERNAME ?? 'shukaypes_bot';
}

// Deep-link that opens the bot's main Mini App from anywhere in
// Telegram (groups included). The `web_app` inline-button type only
// works in private chats — sending it to a group yields TG's
// BUTTON_TYPE_INVALID 400. A regular `url` button pointing at this
// t.me/<bot>?startapp link sidesteps the restriction and still opens
// the Mini App as a Mini App (not the external browser).
function miniAppDeepLink(startParam = 'lostpet'): string {
  return `https://t.me/${botUsername()}?startapp=${startParam}`;
}

// Inline keyboard with a web_app button — tapping opens the Mini App
// inside Telegram, no browser switch, auth via initData. ONLY valid
// in private chats; for groups use openAppGroupKeyboard().
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

// Group-safe variant — `url` button instead of `web_app`. Tapping
// opens the Mini App via TG's deep-link handler. The startapp param
// lets us tell the app it was opened from a lost-pet thread (future:
// could prefill a 'sniff this post' flow).
function openAppGroupKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: '🐾 open шукайпес',
          url: miniAppDeepLink('lostpet'),
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
// Two-stage match: a verb/state keyword (lost/missing/etc) plus enough
// signal to avoid barking at every chat. Strongest signals: a photo
// (most real lost-pet posts have one), or a pet noun in the same
// message (so 'lost the dog' fires, 'lost my keys' doesn't).
//
// JS `\b` only recognises ASCII word chars, so we use Unicode-aware
// lookarounds `(?<!\p{L})x(?!\p{L})` with the `u` flag. Without this,
// every Cyrillic alternative silently never matches.
const NOT_LETTER = '(?<!\\p{L})';
const NOT_LETTER_AHEAD = '(?!\\p{L})';
const W = (alt: string) => `${NOT_LETTER}(?:${alt})${NOT_LETTER_AHEAD}`;

const LOST_PET_RE = new RegExp(
  [
    W('загубив(?:ся|сь|ась|ася|ши)?'),
    W('загубил(?:а|и|ась|ася)?'),
    W('зник(?:ла|ло|ли)?'),
    W('пропав'),
    W('пропала'),
    W('пропал[ао]?'),
    W('потеря(?:лся|лась|ли|н|на)'),
    W('ищу\\s+(?:собаку|кота|пса|щенка|котенка)'),
    W('шукаю\\s+(?:собак(?:у|и)?|кота|пса|щеня)'),
    W('винагорода'),
    W('нагорода'),
    '\\blost\\b',
    '\\bmissing\\b',
    '\\breward\\b',
  ].join('|'),
  'iu',
);

// Pet-noun signal — when present alongside a lost-keyword we trust the
// match even on short text-only posts. Cyrillic stems need Unicode
// boundaries for the same reason as above.
const PET_NOUN_RE = new RegExp(
  [
    NOT_LETTER + '(?:собак|пес|пёс|пса|щен|кіт|кот|котен|кошк|кішк)',
    '\\b(?:cat|dog|puppy|kitten|pet)\\b',
  ].join('|'),
  'iu',
);

function looksLikeLostPet(msg: NonNullable<TgUpdate['message']>): boolean {
  const text = `${msg.text ?? ''} ${msg.caption ?? ''}`.trim();
  if (text.length < 12) return false;
  if (!LOST_PET_RE.test(text)) return false;
  // Strongest signal — a photo with a lost keyword is almost always a
  // real post; reply immediately.
  if (msg.photo) return true;
  // Text-only: pet noun + keyword is a strong combo even short ('загубив
  // собаку на поштовій'). Without a pet noun fall back to the old length
  // gate so 'I lost my keys' doesn't trigger.
  if (PET_NOUN_RE.test(text)) return true;
  return text.length >= 60;
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
      reply_markup: openAppGroupKeyboard(),
    },
  );
}

const plugin: FastifyPluginAsync = async (app) => {
  // Route sendMessage failures through pino so they show up in fly logs
  // alongside the rest of the request stream.
  sendLog = {
    info: (o, m) => app.log.info(o, m),
    warn: (o, m) => app.log.warn(o, m),
  };
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
      } else if (msg.chat?.type === 'group' || msg.chat?.type === 'supergroup') {
        // Log every group msg the bot actually receives — lets us tell
        // from `fly logs` whether group-privacy is letting updates
        // through at all, and whether the matcher fired or skipped.
        const text = `${msg.text ?? ''} ${msg.caption ?? ''}`.trim();
        const matched = looksLikeLostPet(msg);
        req.log.info(
          {
            kind: 'telegram_group_msg',
            chat_id: msg.chat.id,
            chat_title: msg.chat.title,
            has_photo: !!msg.photo,
            text_len: text.length,
            preview: text.slice(0, 80),
            matched,
          },
          '[telegram] group message',
        );
        if (matched) await handleGroupLostPet(msg.chat.id, msg.message_id);
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
