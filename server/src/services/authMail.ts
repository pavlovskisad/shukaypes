// The two e-mails an account ever receives, in the dog's voice.
//
// Both languages in every mail, Ukrainian first: the app does not
// know a person's UI language at the moment of registration (the
// preference lives in the browser), and a verification link is not the
// place to guess. Short, one link, plain text with an HTML twin that
// is the same words in a button.
//
// APP_URL is the public web app — the domain — and is where the links
// point. The client picks ?verify= / ?reset= out of the URL at module
// init (app/services/account.ts) the same way it picks ?invite=.

import type { Mail } from './email.js';

export function appUrl(): string {
  const raw = process.env.APP_URL?.trim();
  if (raw && raw.length > 0) return raw.replace(/\/+$/, '');
  return 'https://shukaypes.vercel.app';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function wrap(lines: string[], link: string, button: string): string {
  const body = lines.map((l) => `<p style="margin:0 0 12px">${escapeHtml(l)}</p>`).join('');
  return (
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;line-height:1.5;color:#1a1a1a;max-width:520px;margin:0 auto;padding:24px">` +
    body +
    `<p style="margin:20px 0"><a href="${escapeHtml(link)}" style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:12px 20px;border-radius:12px;font-weight:700">${escapeHtml(button)}</a></p>` +
    `<p style="margin:0;color:#777;font-size:13px">${escapeHtml(link)}</p>` +
    `</div>`
  );
}

export function verifyMail(to: string, nickname: string, token: string): Mail {
  const link = `${appUrl()}/?verify=${encodeURIComponent(token)}`;
  const uk = [
    `${nickname}, це шукайпес. *нюх-нюх* — так, це твоя пошта.`,
    'натисни, щоб підтвердити її, і ходімо гуляти. посилання живе добу.',
  ];
  const en = [
    `${nickname}, this is шукайпес. *sniff sniff* — yes, this is your e-mail.`,
    'tap to confirm it and let us go for a walk. the link lives for a day.',
  ];
  const text = [...uk, '', link, '', ...en, '', link].join('\n');
  return {
    to,
    subject: 'шукайпес: підтверди пошту · confirm your e-mail',
    text,
    html: wrap([...uk, '', ...en], link, 'підтвердити · confirm'),
  };
}

export function resetMail(to: string, nickname: string, token: string): Mail {
  const link = `${appUrl()}/?reset=${encodeURIComponent(token)}`;
  const uk = [
    `${nickname}, хтось попросив новий пароль для шукайпес. якщо це не ти — просто не чіпай цей лист.`,
    'посилання живе годину.',
  ];
  const en = [
    `${nickname}, somebody asked for a new шукайпес password. if it was not you, leave this mail alone.`,
    'the link lives for an hour.',
  ];
  const text = [...uk, '', link, '', ...en, '', link].join('\n');
  return {
    to,
    subject: 'шукайпес: новий пароль · new password',
    text,
    html: wrap([...uk, '', ...en], link, 'новий пароль · new password'),
  };
}
