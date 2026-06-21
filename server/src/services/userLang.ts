// Per-user bot language preference. Stored in Redis keyed by the
// Telegram user_id so a one-line /lang command works across DM +
// group context without needing to write to Postgres (we don't even
// have a row for every group member). 60-day TTL — if the user goes
// inactive for that long, falls back to UK default. Renewed on every
// pickLang read so active users never re-default.

import { redis } from '../db/redis.js';
import { DEFAULT_LANG, type Lang } from '../i18n/botMessages.js';

const TTL_SECONDS = 60 * 24 * 60 * 60; // 60 days

function key(userId: number): string {
  return `tg:lang:${userId}`;
}

export async function getUserLang(userId: number | undefined): Promise<Lang> {
  if (!userId) return DEFAULT_LANG;
  try {
    const raw = await redis.get(key(userId));
    if (raw === 'en' || raw === 'uk') {
      // Sliding TTL — every read extends the window.
      await redis.expire(key(userId), TTL_SECONDS).catch(() => {});
      return raw;
    }
  } catch {
    // Redis hiccup → silently fall back. Bot stays up, user just
    // gets UK until Redis is back.
  }
  return DEFAULT_LANG;
}

export async function setUserLang(userId: number, lang: Lang): Promise<void> {
  try {
    await redis.set(key(userId), lang, 'EX', TTL_SECONDS);
  } catch {
    /* swallow — caller still reports success in chat; next read just hits default */
  }
}
