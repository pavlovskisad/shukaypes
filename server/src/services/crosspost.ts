// Publish a first-party lost-pet report outward through the bot.
//
// The channel post is doing three jobs at once, and that is the design
// rather than a coincidence:
//
//   1. STORAGE. This app's photo pipeline runs on Telegram file_ids
//      (routes/photos.ts is a read proxy over them; there is no object
//      store anywhere). sendPhoto's response hands back the file_id,
//      so publishing the post IS uploading the photo.
//   2. DISTRIBUTION. The channel is ours; every configured district
//      group then gets a copyMessage of the same post.
//   3. THE SHAREABLE THING. A public channel post has a t.me URL the
//      poster can forward into chats no bot will ever be admitted to.
//
// Configuration, all optional — the feature ships dormant:
//   CROSSPOST_CHANNEL_ID        chat id of our channel (bot must be
//                               admin with post rights)
//   CROSSPOST_CHANNEL_USERNAME  public @name, used only to build the
//                               t.me/<name>/<id> share URL
//   CROSSPOST_GROUP_IDS         comma-separated chat ids of district
//                               groups that have accepted the bot
//
// EVERY failure here is a log line, never a throw. Pet creation must
// not depend on Telegram being up, and one group that kicked the bot
// must not stop the next group from hearing about the pet.

import type { FastifyBaseLogger } from 'fastify';
import { messages } from '../i18n/botMessages.js';

const TG_API = 'https://api.telegram.org';
const SEND_TIMEOUT_MS = 15_000;
// Telegram allows ~20 messages/minute to the same chat and 30/s overall;
// one pet fanning out to a handful of groups is far below both, but
// spacing the sends keeps a burst of two simultaneous reports polite.
const FAN_OUT_SPACING_MS = 1100;

type Log = Pick<FastifyBaseLogger, 'info' | 'warn'>;

function token(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN || null;
}

export function crosspostChannelId(): string | null {
  const raw = process.env.CROSSPOST_CHANNEL_ID?.trim();
  return raw ? raw : null;
}

export function crosspostGroupIds(): string[] {
  return (process.env.CROSSPOST_GROUP_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function botUsername(): string {
  return process.env.TELEGRAM_BOT_USERNAME ?? 'shukaypes_bot';
}

// Same group-safe deep link routes/telegram.ts uses for its replies: a
// plain url button through t.me/<bot>?start=lost-<id>, because web_app
// buttons are invalid outside private chats.
function groupKeyboard(dogId: string) {
  return {
    inline_keyboard: [
      [
        {
          text: messages.uk.buttonOpenSearch,
          url: `https://t.me/${botUsername()}?start=${encodeURIComponent(`lost-${dogId}`)}`,
        },
      ],
    ],
  };
}

async function tgCall(
  method: string,
  body: Record<string, unknown> | FormData,
  log: Log,
): Promise<Record<string, unknown> | null> {
  const t = token();
  if (!t) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), SEND_TIMEOUT_MS);
  try {
    const isForm = body instanceof FormData;
    const res = await fetch(`${TG_API}/bot${t}/${method}`, {
      method: 'POST',
      headers: isForm ? undefined : { 'content-type': 'application/json' },
      body: isForm ? body : JSON.stringify(body),
      signal: ctl.signal,
    });
    const json = (await res.json().catch(() => null)) as
      | { ok: boolean; result?: Record<string, unknown>; description?: string }
      | null;
    if (!json?.ok) {
      log.warn(
        { kind: 'crosspost_call', method, status: res.status, description: json?.description },
        '[crosspost] telegram rejected the call',
      );
      return null;
    }
    return json.result ?? {};
  } catch (err) {
    log.warn({ kind: 'crosspost_call', method, err: (err as Error).message }, '[crosspost] call threw');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface ChannelPost {
  messageId: number;
  /** Telegram file_id of the LARGEST size of the uploaded photo, if any. */
  photoFileId: string | null;
  /** t.me link when the channel's public username is configured. */
  postUrl: string | null;
}

/**
 * Posts the report to our channel. With a photo this is also the photo
 * UPLOAD — the returned file_id is what the row stores and what
 * /photos/:fileId serves from then on. Returns null when the channel is
 * unconfigured or Telegram refused; the caller creates the pet anyway.
 */
export async function publishToChannel(
  opts: { caption: string; photo?: { bytes: Buffer; mime: string } | null },
  log: Log,
): Promise<ChannelPost | null> {
  const chatId = crosspostChannelId();
  if (!chatId) return null;

  let result: Record<string, unknown> | null;
  if (opts.photo) {
    const form = new FormData();
    form.set('chat_id', chatId);
    form.set('caption', opts.caption);
    form.set(
      'photo',
      new Blob([new Uint8Array(opts.photo.bytes)], { type: opts.photo.mime }),
      'pet.jpg',
    );
    result = await tgCall('sendPhoto', form, log);
  } else {
    result = await tgCall('sendMessage', { chat_id: chatId, text: opts.caption }, log);
  }
  if (!result) return null;

  const messageId = typeof result.message_id === 'number' ? result.message_id : null;
  if (messageId === null) return null;

  // sendPhoto returns every thumbnail size; the last entry is the
  // largest — same convention telegramIngest relies on.
  const sizes = Array.isArray(result.photo)
    ? (result.photo as { file_id?: string }[])
    : [];
  const photoFileId = sizes.length > 0 ? sizes[sizes.length - 1]?.file_id ?? null : null;

  const username = process.env.CROSSPOST_CHANNEL_USERNAME?.replace(/^@/, '');
  const postUrl = username ? `https://t.me/${username}/${messageId}` : null;

  log.info(
    { kind: 'crosspost_channel', message_id: messageId, has_photo: !!photoFileId },
    '[crosspost] published to channel',
  );
  return { messageId, photoFileId, postUrl };
}

/**
 * Copies the channel post into every configured district group, with a
 * deep-link button back to the pet's pin. Sequential and spaced; each
 * failure is logged and skipped. Fire-and-forget from the route — never
 * awaited on the request path.
 */
export async function fanOutToGroups(
  opts: { channelMessageId: number; dogId: string },
  log: Log,
): Promise<void> {
  const chatId = crosspostChannelId();
  const groups = crosspostGroupIds();
  if (!chatId || groups.length === 0) return;

  for (const group of groups) {
    const result = await tgCall(
      'copyMessage',
      {
        chat_id: group,
        from_chat_id: chatId,
        message_id: opts.channelMessageId,
        reply_markup: groupKeyboard(opts.dogId),
      },
      log,
    );
    log.info(
      { kind: 'crosspost_group', group, ok: result !== null, dog_id: opts.dogId },
      '[crosspost] group fan-out',
    );
    await new Promise((r) => setTimeout(r, FAN_OUT_SPACING_MS));
  }
}
