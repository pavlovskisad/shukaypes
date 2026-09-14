// The happiness index (D-74): whose dog lives the happiest life.
//
// An honest, all-time, time-weighted average of the happiness meter
// over the seconds the person was actually with the dog. The two
// totals (happiness × seconds, and seconds) are summed by the decay
// cron (services/decay.ts) for rows polled within the online window;
// this file only reads them. The index is the ratio, 0–100, and it
// moves with how a person plays: a long good walk lifts it, a week of
// grumpy sessions drags it down. Nothing here is a snapshot at logout
// — the 15s poll is the snapshot, and a closed tab counts nothing.
//
// A dog ranks only after minActiveS of counted time (balance): three
// perfect minutes on a fresh account are not a life.
//
// BOTS ARE A FICTION HERE, like their level (services/botAvatars.ts):
// they have no meter, so each gets a stable index seeded by its
// number with a slow daily drift so the board breathes, and a fake
// active time that clears the guard. Swap for the real thing if bots
// ever get a meter.

import { sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { balance } from '../config/balance.js';
import { BOT_ROSTER, botAvatarUrl, botEntry } from './botAvatars.js';
import { ownerAvatars, ownerNames } from './territory.js';

export interface HappinessEntry {
  userId: string;
  // The dog's name, or the nickname when there is no pet (D-73).
  name: string;
  // The nickname when `name` is the dog's; null for bots and petless.
  owner: string | null;
  bot: boolean;
  avatarUrl: string | null;
  // 0–100, rounded.
  index: number;
  // Seconds of counted life, for «N год разом» beside the index.
  activeS: number;
}

const BOT_PREFIX = 'bot:';
const DAY_MS = 86_400_000;

// A bot's index for today: 55–95 by seed, ±4 drifting over ~a week.
export function botHappiness(i: number, now = Date.now()): { index: number; activeS: number } {
  const base = 55 + ((i * 37) % 41);
  const day = Math.floor(now / DAY_MS);
  const drift = Math.round(4 * Math.sin(day / 3 + i));
  const index = Math.max(0, Math.min(100, base + drift));
  // Days "together" grow one a day from a per-bot start, in hours.
  const activeS = (12 + ((i * 5) % 40) + (day % 7)) * 3600;
  return { index, activeS };
}

function botEntries(now: number): HappinessEntry[] {
  return BOT_ROSTER.map((_, i) => {
    const { index, activeS } = botHappiness(i, now);
    return {
      userId: `${BOT_PREFIX}${i}`,
      name: botEntry(i).name,
      owner: null,
      bot: true,
      avatarUrl: botAvatarUrl(i),
      index,
      activeS,
    };
  });
}

// The board: people past the guard plus every bot, by index, best first.
export async function happinessLeaderboard(limit = 10, now = Date.now()): Promise<HappinessEntry[]> {
  const min = balance.happinessIndex.minActiveS;
  const rows = await db
    .select({
      userId: schema.companionState.userId,
      w: schema.companionState.happyWeightS,
      a: schema.companionState.activeS,
    })
    .from(schema.companionState)
    .where(sql`${schema.companionState.activeS} >= ${min} AND ${schema.companionState.userId} NOT LIKE ${BOT_PREFIX + '%'}`)
    .orderBy(sql`${schema.companionState.happyWeightS} / ${schema.companionState.activeS} DESC`)
    .limit(limit);
  const ids = rows.map((r) => r.userId);
  const [names, avatars] = await Promise.all([ownerNames(ids), ownerAvatars(ids)]);
  const people: HappinessEntry[] = rows.map((r) => ({
    userId: r.userId,
    name: names.get(r.userId)?.name ?? 'сусід',
    owner: names.get(r.userId)?.owner ?? null,
    bot: false,
    avatarUrl: avatars.get(r.userId) ?? null,
    index: Math.round(r.w / r.a),
    activeS: Math.round(r.a),
  }));
  return [...people, ...botEntries(now)]
    .sort((x, y) => y.index - x.index || y.activeS - x.activeS)
    .slice(0, limit);
}

// Where the caller stands: their index (null until past the guard),
// their counted time, and their rank on the board if they are on it.
export async function happinessStanding(
  userId: string,
  board: HappinessEntry[],
): Promise<{ index: number | null; activeS: number; rank: number | null }> {
  const idx = board.findIndex((e) => e.userId === userId);
  const [row] = await db
    .select({ w: schema.companionState.happyWeightS, a: schema.companionState.activeS })
    .from(schema.companionState)
    .where(sql`${schema.companionState.userId} = ${userId}`)
    .limit(1);
  const activeS = Math.round(row?.a ?? 0);
  const index =
    row && row.a >= balance.happinessIndex.minActiveS ? Math.round(row.w / row.a) : null;
  return { index, activeS, rank: idx >= 0 ? idx + 1 : null };
}
