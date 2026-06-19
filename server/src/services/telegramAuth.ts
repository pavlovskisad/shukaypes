// Telegram Mini App initData validation.
//
// When our PWA runs inside Telegram, `Telegram.WebApp.initData` is a
// URL-encoded query string containing the user's identity, signed by
// Telegram with our bot's token via HMAC-SHA256. The protocol is
// documented at https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
//
// Algorithm:
//   1. Parse initData as URL-encoded key/value pairs.
//   2. Pull out the `hash` field (the signature we must verify).
//   3. Sort remaining keys, join as `key=value` lines separated by \n.
//   4. Compute secret_key = HMAC-SHA256(bot_token, key='WebAppData').
//   5. Compute check_hash = HMAC-SHA256(data_check_string, key=secret_key).
//   6. Compare check_hash (hex) to the hash from step 2.
//   7. Reject if `auth_date` is older than INIT_DATA_MAX_AGE_S to stop
//      stolen-initData replay.

import crypto from 'crypto';

const INIT_DATA_MAX_AGE_S = 24 * 60 * 60; // 1 day; Telegram refreshes on launch

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
}

export interface ValidatedInitData {
  user: TelegramUser;
  authDate: Date;
}

export function validateInitData(initDataRaw: string): ValidatedInitData | null {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    // Allow boot without a bot token; just refuse any Telegram auth
    // attempt. Web/device-id flow is unaffected.
    return null;
  }
  try {
    const params = new URLSearchParams(initDataRaw);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');

    // Sort + join: 'auth_date=...\nquery_id=...\nuser=...'
    const dataCheckString = Array.from(params.entries())
      .map(([k, v]) => [k, v])
      .sort((a, b) => a[0]!.localeCompare(b[0]!))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();
    const computedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');
    if (computedHash !== hash) return null;

    const authDateStr = params.get('auth_date');
    const authDateSec = authDateStr ? Number(authDateStr) : 0;
    if (!Number.isFinite(authDateSec) || authDateSec <= 0) return null;
    const ageS = Math.floor(Date.now() / 1000) - authDateSec;
    if (ageS > INIT_DATA_MAX_AGE_S) return null;

    const userJson = params.get('user');
    if (!userJson) return null;
    const user = JSON.parse(userJson) as TelegramUser;
    if (!user.id || typeof user.id !== 'number') return null;

    return { user, authDate: new Date(authDateSec * 1000) };
  } catch {
    return null;
  }
}
