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
import {
  looksLikeLostPet as looksLikeLostPetShared,
  looksLikeRehoming as looksLikeRehomingShared,
} from '../pipeline/keywords.js';
import { ingestFromTelegramPost, type IngestOutcome } from '../services/telegramIngest.js';

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
// t.me/<bot>?start=... link is the most reliable fallback:
//
//   - ?startapp= opens the Main Mini App directly, BUT only if one
//     has been registered for the bot via BotFather → Configure
//     Mini App. Without that, TG falls back to opening the bot chat
//     and the param is silently dropped — so the user lands in DM
//     with nothing pre-filled.
//   - ?start= always opens the bot chat with /start <param> auto-
//     primed (sent on first contact, surfaced as a START button on
//     return visits). Our DM /start handler detects the lost-<id>
//     prefix and replies with a web_app button that does the actual
//     Mini App launch — works for every user regardless of bot
//     configuration.
//
// Future improvement: if the user registers a Main Mini App in
// BotFather, switch this back to ?startapp= for one-tap launch.
function miniAppDeepLink(startParam = 'lostpet'): string {
  return `https://t.me/${botUsername()}?start=${startParam}`;
}

// Mini App URL with an embedded dog id — used by the web_app button
// the DM /start handler sends when it detects a `lost-<id>` param.
// The app reads `?dog=<id>` from window.location.search and routes
// the same way it does for Telegram.WebApp.initDataUnsafe.start_param.
function miniAppDogUrl(dogId: string): string {
  return `${miniAppUrl()}?dog=${encodeURIComponent(dogId)}`;
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
// passes through to the Mini App as initDataUnsafe.start_param, which
// the client can use to route straight to the relevant lost-pet
// search (handler not yet wired client-side, but the link is stable).
function openAppGroupKeyboard(startParam: string = 'lostpet') {
  return {
    inline_keyboard: [
      [
        {
          text: '🐾 open шукайпес',
          url: miniAppDeepLink(startParam),
        },
      ],
    ],
  };
}

async function handleStart(
  chatId: number,
  firstName?: string,
  startParam?: string,
): Promise<void> {
  // Deep-link continuation: the group/DM share link uses
  // ?start=lost-<id>. When TG opens our DM with that param, we land
  // here. Reply with a focused web_app button that drops the user
  // straight onto the dog's pin (Mini App reads ?dog= from the URL).
  if (startParam && startParam.startsWith('lost-')) {
    const dogId = startParam.slice('lost-'.length);
    if (dogId) {
      await sendMessage(
        chatId,
        "🐾 tap below to open the search — i'll take you straight to the pin.",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🐾 open the search', web_app: { url: miniAppDogUrl(dogId) } }],
            ],
          },
        },
      );
      return;
    }
  }
  const hi = firstName ? `привіт, ${firstName}!` : 'привіт!';
  const text = [
    `${hi} i'm <b>шукайпес</b> — your kyiv walking companion.`,
    '',
    'we walk, we sniff, we find lost pets, we learn the city paw by paw.',
    '',
    "🆘 <b>lost a pet?</b> just tell me here — say their name, where you last saw them, what they look like (a photo helps). i'll add them to the map so helpers nearby can spot them.",
    '',
    'tap below to open the map. 🐾',
  ].join('\n');
  await sendMessage(chatId, text, { reply_markup: openAppKeyboard() });
}

// /lost prompt — no conversation state, just nudges the user toward
// the format the parser handles cleanest. The very next DM they send
// will hit the looksLikeLostPetMessage gate and route through
// ingestFromTelegramPost the same as a description sent without /lost.
async function handleLostCommand(chatId: number): Promise<void> {
  const text = [
    "tell me about your missing pet 🐾",
    '',
    "the more detail the better — name, where + when last seen, what they look like, any reward. a photo helps a lot.",
    '',
    "<i>example: «загубив пса Барсика на Поштовій вчора ввечері, чорний з білою лапою, нашийник червоний, нагорода 2000»</i>",
  ].join('\n');
  await sendMessage(chatId, text);
}

// Catch-all reply for any other DM text — friendly nudge to the
// same button so users don't bounce on a wall of silence.
async function handleOtherDm(chatId: number): Promise<void> {
  await sendMessage(
    chatId,
    "i'm just a dog with a map — tap below and we walk together. (lost a pet? tell me right here and i'll add them to the map.)",
    { reply_markup: openAppKeyboard() },
  );
}

// Bot's reply to a DM that looks like the user is reporting their own
// missing pet. Tone is more personal than the group reply — the user
// IS the OP here — and the deep link is front-and-centre so they can
// forward it to neighbours / share to other groups themselves.
async function handleDmLostPet(
  chatId: number,
  outcome: IngestOutcome | null,
): Promise<void> {
  if (outcome?.kind === 'inserted' || outcome?.kind === 'updated') {
    const { name, emoji } = outcome.parsed;
    const verb = outcome.kind === 'inserted' ? 'added' : 'updated';
    const link = miniAppDeepLink(`lost-${outcome.dogId}`);
    const text = [
      `${emoji} got it — ${verb} ${name} on the map.`,
      '',
      "tap the button to open the search. share this link with neighbours so helpers nearby can spot them too:",
      '',
      link,
    ].join('\n');
    await sendMessage(chatId, text, { reply_markup: openAppKeyboard() });
    return;
  }
  if (outcome?.kind === 'duplicate' || outcome?.kind === 'already-ingested') {
    const link = outcome.dogId ? miniAppDeepLink(`lost-${outcome.dogId}`) : miniAppDeepLink('lostpet');
    const text = [
      "i already had this one on the map 🐾",
      '',
      "share this link with neighbours so helpers nearby can spot them:",
      '',
      link,
    ].join('\n');
    await sendMessage(chatId, text, { reply_markup: openAppKeyboard() });
    return;
  }
  // Low-confidence / parse-error / rehoming / skipped — fall back to
  // a friendly nudge for more detail rather than silently failing.
  await sendMessage(
    chatId,
    "hmm, i couldn't catch enough detail. try again like «загубив пса Барсика на Поштовій вчора, чорний з білою лапою, винагорода» — i'll add them right away.",
    { reply_markup: openAppKeyboard() },
  );
}

// Pre-parse gate: cheap regex filter so we don't burn a Haiku call on
// every chat message. Reuses the same keyword sets the scrape pipeline
// uses — substring stems, not word-boundary regex, so Cyrillic
// inflections match without JS's ASCII-only \b problem.
function looksLikeLostPetMessage(msg: NonNullable<TgUpdate['message']>): boolean {
  const text = `${msg.text ?? ''} ${msg.caption ?? ''}`.trim();
  // looksLikeLostPetShared already requires BOTH a pet noun AND a
  // lost-keyword — "загубив пса" (11 chars) is enough signal on its
  // own. The minimum length here just rejects single-word noise.
  if (text.length < 8) return false;
  // Rehoming posts (offering a pet for adoption) read superficially
  // similar to lost-pet posts — short-circuit before keyword check so
  // we don't reply 'sniff sniff' on an adoption ad.
  if (looksLikeRehomingShared(text)) return false;
  return looksLikeLostPetShared(text);
}

// Reply text + deep-link param vary by ingest outcome so the bot's
// message reflects what actually happened (added vs already-known vs
// generic 'sniff sniff' when we couldn't parse).
function buildGroupReply(outcome: IngestOutcome | null): { text: string; startParam: string } {
  if (!outcome) {
    return {
      text: "*sniff sniff* — looks like a lost one. open me to start a search:",
      startParam: 'lostpet',
    };
  }
  switch (outcome.kind) {
    case 'inserted': {
      const name = outcome.parsed.name;
      const emoji = outcome.parsed.emoji;
      return {
        text: `*sniff sniff* ${emoji}\n\nadded ${name} to the map — tap below to start the search:`,
        startParam: `lost-${outcome.dogId}`,
      };
    }
    case 'updated':
    case 'duplicate':
    case 'already-ingested': {
      return {
        text: "*sniff sniff* — i've sniffed this one before. already on the map:",
        startParam: outcome.dogId ? `lost-${outcome.dogId}` : 'lostpet',
      };
    }
    default:
      return {
        text: "*sniff sniff* — looks like a lost one. open me to start a search:",
        startParam: 'lostpet',
      };
  }
}

async function handleGroupLostPet(
  chatId: number,
  messageId: number,
  outcome: IngestOutcome | null,
): Promise<void> {
  const { text, startParam } = buildGroupReply(outcome);
  await sendMessage(chatId, text, {
    reply_to_message_id: messageId,
    reply_markup: openAppGroupKeyboard(startParam),
  });
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
      if (msg.chat?.type === 'private') {
        const chatId = msg.chat.id;
        const firstName = msg.from?.first_name;
        const cmd = typeof msg.text === 'string' ? msg.text : '';
        if (cmd.startsWith('/start')) {
          // /start <param> — strip the command + leading whitespace
          // and pass the rest through. Telegram delivers the param
          // separated by exactly one space; trim defensively.
          const startParam = cmd.slice('/start'.length).trim() || undefined;
          await handleStart(chatId, firstName, startParam);
        } else if (cmd.startsWith('/lost')) {
          await handleLostCommand(chatId);
        } else if (looksLikeLostPetMessage(msg)) {
          // User is reporting their own missing pet via DM — runs
          // through the same parser + upsert path the group listener
          // uses. Errors must NOT propagate; we always answer.
          let outcome: IngestOutcome | null = null;
          try {
            outcome = await ingestFromTelegramPost(msg, req.log);
            req.log.info(
              {
                kind: 'telegram_ingest',
                chat_id: chatId,
                message_id: msg.message_id,
                via: 'dm',
                outcome: outcome.kind,
                dog_id: 'dogId' in outcome ? outcome.dogId : undefined,
              },
              '[telegram] dm ingest result',
            );
          } catch (err) {
            req.log.warn(
              { kind: 'telegram_ingest', via: 'dm', err: (err as Error).message },
              '[telegram] dm ingest threw',
            );
          }
          await handleDmLostPet(chatId, outcome);
        } else if (msg.photo && !cmd && !msg.caption) {
          // Photo-only with no caption — prompt for the description
          // we need to parse anything useful.
          await sendMessage(
            chatId,
            "thanks for the photo 🐾 — could you also send me your pet's name and where you last saw them?",
          );
        } else {
          await handleOtherDm(chatId);
        }
      } else if (msg.chat?.type === 'group' || msg.chat?.type === 'supergroup') {
        // Log every group msg the bot actually receives — lets us tell
        // from `fly logs` whether group-privacy is letting updates
        // through at all, and whether the matcher fired or skipped.
        const text = `${msg.text ?? ''} ${msg.caption ?? ''}`.trim();
        const matched = looksLikeLostPetMessage(msg);
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
        if (matched) {
          // Parse + ingest synchronously — Haiku is ~2-3s, well inside
          // TG's webhook timeout. Errors here must NOT propagate; the
          // ingestFromGroupPost helper catches its own and returns an
          // outcome we map to a generic reply.
          let outcome: IngestOutcome | null = null;
          try {
            outcome = await ingestFromTelegramPost(msg, req.log);
            req.log.info(
              {
                kind: 'telegram_ingest',
                chat_id: msg.chat.id,
                message_id: msg.message_id,
                outcome: outcome.kind,
                dog_id:
                  'dogId' in outcome ? outcome.dogId : undefined,
              },
              '[telegram] ingest result',
            );
          } catch (err) {
            req.log.warn(
              { kind: 'telegram_ingest', err: (err as Error).message },
              '[telegram] ingest threw',
            );
          }
          await handleGroupLostPet(msg.chat.id, msg.message_id, outcome);
        }
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
    // Publish /start + /lost so both show in the bot's command menu.
    await fetch(`${TG_API}/bot${token}/setMyCommands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        commands: [
          { command: 'start', description: 'open шукайпес' },
          { command: 'lost', description: 'report a missing pet' },
        ],
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
          "woof! lost a pet? tell me here and i'll add them to the map. or /start to walk and sniff with me 🐾",
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
