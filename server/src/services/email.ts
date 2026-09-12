// Outbound e-mail through Resend's REST API.
//
// One vendor call, no SDK: the endpoint is a single POST and the
// server already talks to Telegram the same way. Configuration:
//
//   RESEND_API_KEY   the API key. Unset → nothing is sent, every call
//                    returns { sent: false, reason: 'unconfigured' },
//                    and lib/accountPolicy.ts stops requiring
//                    verification because nobody could pass it.
//   EMAIL_FROM       "шукайпес <dog@your-domain>" — the sending
//                    domain must be verified in Resend (SPF + DKIM),
//                    which is why registration needs the real domain
//                    and cannot go out from vercel.app. Parsed and
//                    re-formatted by lib/mailFrom.ts on the way out:
//                    a non-ASCII name is RFC 2047-encoded, stray
//                    quotes are dropped, and a value that cannot be
//                    parsed is named in the boot log (routes/auth.ts).
//
// EVERY failure is a return value, never a throw. Registration must
// complete even when the mail bounces; the person can ask for a resend.

import type { FastifyBaseLogger } from 'fastify';
import { formatFrom, parseFrom } from '../lib/mailFrom.js';

// Overridable so an end-to-end check can point it at a local capture
// and read the links out of the mails it would have sent.
const RESEND_API = process.env.RESEND_API_URL?.trim() || 'https://api.resend.com/emails';
const SEND_TIMEOUT_MS = 10_000;

type Log = Pick<FastifyBaseLogger, 'info' | 'warn'>;

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export type SendResult = { sent: true; id: string | null } | { sent: false; reason: string };

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendEmail(mail: Mail, log: Log): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  const parsed = parseFrom(process.env.EMAIL_FROM);
  if (!key || !parsed) return { sent: false, reason: 'unconfigured' };
  const from = formatFrom(parsed);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
      signal: ctl.signal,
    });
    const json = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (!res.ok) {
      // The recipient address is a person's e-mail; log the host only.
      log.warn(
        { kind: 'email_send', status: res.status, message: json?.message, domain: mail.to.split('@')[1] },
        '[email] resend rejected the call',
      );
      return { sent: false, reason: `http ${res.status}` };
    }
    log.info({ kind: 'email_send', id: json?.id ?? null, domain: mail.to.split('@')[1] }, '[email] sent');
    return { sent: true, id: json?.id ?? null };
  } catch (err) {
    log.warn({ kind: 'email_send', err: (err as Error).message }, '[email] send threw');
    return { sent: false, reason: (err as Error).name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}
