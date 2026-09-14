// The happiness index (D-75): whose dog lives the happiest life.
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
// Bots are on the board on the same terms (D-76): they have a
// companion row, they are polled while online, they eat and get
// grumpy, and their index is the same ratio over the same guard.
// (The first cut gave them a seeded fiction; it went with D-76.)

import { sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { balance } from '../config/balance.js';
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

// The board: every dog past the guard, people and bots alike, by index,
// best first; ties broken by the longer life.
export async function happinessLeaderboard(limit = 10): Promise<HappinessEntry[]> {
  const min = balance.happinessIndex.minActiveS;
  const rows = await db
    .select({
      userId: schema.companionState.userId,
      w: schema.companionState.happyWeightS,
      a: schema.companionState.activeS,
    })
    .from(schema.companionState)
    .where(sql`${schema.companionState.activeS} >= ${min}`)
    .orderBy(sql`${schema.companionState.happyWeightS} / ${schema.companionState.activeS} DESC, ${schema.companionState.activeS} DESC`)
    .limit(limit);
  const ids = rows.map((r) => r.userId);
  const [names, avatars] = await Promise.all([ownerNames(ids), ownerAvatars(ids)]);
  return rows.map((r) => ({
    userId: r.userId,
    name: names.get(r.userId)?.name ?? 'сусід',
    owner: names.get(r.userId)?.owner ?? null,
    bot: r.userId.startsWith('bot:'),
    avatarUrl: avatars.get(r.userId) ?? null,
    index: Math.round(r.w / r.a),
    activeS: Math.round(r.a),
  }));
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
