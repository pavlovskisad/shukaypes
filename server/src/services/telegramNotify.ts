// Operational notifications to the owner's Telegram chat.
//
// Separate from the sendMessage inside routes/telegram.ts on purpose,
// though they both POST to the same API. That one answers a user: it is
// chat-scoped, HTML-formatted, i18n'd, and part of the Mini App bot's
// conversation. This one reports on the machine to exactly one chat, has
// no user to be polite to, and above all must never throw — it is called
// from the scrape cron, and an alerting path that can break the thing it
// watches is worse than no alerting at all.
//
// Silent no-op when ALERT_CHAT_ID is unset, so the feature ships dormant
// and turning it on is one env var. The caller logs either way, so an
// unset chat id degrades to log-only rather than to nothing.

import type { FastifyBaseLogger } from 'fastify';

const TG_API = 'https://api.telegram.org';
const SEND_TIMEOUT_MS = 10_000;

type Log = Pick<FastifyBaseLogger, 'info' | 'warn'>;

export function alertChatId(): string | null {
  const raw = process.env.ALERT_CHAT_ID?.trim();
  return raw ? raw : null;
}

/**
 * Sends `text` to ALERT_CHAT_ID. Resolves true if Telegram accepted it.
 * Never rejects: every failure is logged and swallowed.
 */
export async function notifyOwner(text: string, log: Log): Promise<boolean> {
  const chatId = alertChatId();
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!chatId || !token) return false;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(`${TG_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // No parse_mode. Alert bodies carry URLs, error strings and raw
      // source names; running those through the HTML parser is a way to
      // have an alert fail to send precisely when something is broken.
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: ctl.signal,
    });
    const json = (await res.json().catch(() => null)) as
      | { ok: boolean; description?: string }
      | null;
    if (!json?.ok) {
      log.warn(
        { kind: 'alert_send_failed', status: res.status, description: json?.description },
        '[alert] telegram rejected the message',
      );
      return false;
    }
    return true;
  } catch (err) {
    log.warn({ kind: 'alert_send_failed', err: (err as Error).message }, '[alert] send failed');
    return false;
  } finally {
    clearTimeout(timer);
  }
}
