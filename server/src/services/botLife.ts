// A bot's life by the player's rules (D-76).
//
// Until now a bot was a user row, a spot in presence and territory
// marks: no companion, no hunger, no happiness, nothing to eat, and a
// made-up level and happiness index on its card. That made the bots
// scenery, and it made every balance question unanswerable except by
// one person walking one dog. Now each bot has a companion row and
// lives by the same crons and the same writes a person's dog does:
//
//   · ONLINE is a session. The walker sim already goes offline and
//     comes back (bots.ts); while it is online the cron touches the
//     same `last_poll_at` the app's /state poll touches, so the decay
//     cron drains its happiness and counts its time toward the
//     happiness index (D-75) exactly as for a person — and freezes it
//     while it is away.
//   · FOOD AND PAWS spawn around it through the same spawn functions
//     a person's map sync calls (services/spawn.ts), on the same
//     cadence, with the hotspots near it standing in for the parks a
//     phone would have sent.
//   · It PICKS UP what it walks past through services/collect.ts — the
//     transaction a tap makes — within the same reach a person has
//     (balance.collectMaxDistanceM), so hunger, happiness, XP and
//     level are earned, not invented.
//   · MARKING costs it what it costs a person (placeMark charges the
//     companion) and is refused for the same reasons: grumpy, hungry.
//
// What stays closed to a bot: quests and lore (paid model calls that
// mean nothing without a person reading them), pokes and chat.
//
// Everything here is batched per cron tick — one query for every
// online bot's paws, one for its bones — because the multiplayer tick
// already runs a second on one shared vCPU and thirty bots must not
// turn it into thirty round trips.

import { and, inArray, isNull, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { balance } from '../config/balance.js';
import { distanceMeters, type LatLng } from '../utils/geo.js';
import { ensureFoodForUser, ensureTokensForUser } from './spawn.js';
import { collectTokenTx, eatFoodTx } from './collect.js';

export interface BotWalker {
  id: string;
  name: string;
  pos: LatLng;
}

// What a tick did, for the log line and, later, the report.
export interface BotTickStats {
  paws: number;
  bones: number;
}

// Give every bot a companion row, once. The dog's name is the roster
// name; hunger and happiness start where a person's do.
export async function ensureBotCompanions(bots: BotWalker[]): Promise<void> {
  if (!bots.length) return;
  await db
    .insert(schema.companionState)
    .values(
      bots.map((b) => ({
        userId: b.id,
        name: b.name,
        hunger: balance.hunger.start,
        happiness: balance.happiness.start,
      })),
    )
    .onConflictDoNothing();
}

// "The person is with the dog" for every online bot — the same touch
// /state makes for a person, in one statement. Coming back after a
// gap restarts the decay clock, so the dog wakes as it was left.
export async function touchBotsOnline(ids: string[]): Promise<void> {
  if (!ids.length) return;
  // Query builder rather than a raw ANY(): postgres-js binds a JS array
  // as a record, and `::text[]` cannot cast that.
  const win = balance.happinessIndex.onlineWindowMs;
  await db
    .update(schema.companionState)
    .set({
      lastPollAt: sql`NOW()`,
      lastDecayAt: sql`CASE WHEN ${schema.companionState.lastPollAt} IS NULL OR ${schema.companionState.lastPollAt} < NOW() - (${win}::int * interval '1 millisecond') THEN NOW() ELSE ${schema.companionState.lastDecayAt} END`,
    })
    .where(inArray(schema.companionState.userId, ids));
}

// The spawn a person's sync would make, for one bot. Callers stagger
// this across ticks so it lands about as often as a phone's 15s sync
// with the spawn cooldown applied.
export async function botSync(bot: BotWalker, parks: LatLng[]): Promise<void> {
  await Promise.all([
    ensureTokensForUser(bot.id, bot.pos, parks),
    ensureFoodForUser(bot.id, bot.pos, parks),
  ]);
}

// Pick up every paw and eat every bone within reach, for all the
// online bots at once. Two reads, then one transaction per item —
// the same transaction a tap makes.
export async function botForage(bots: BotWalker[]): Promise<BotTickStats> {
  const stats: BotTickStats = { paws: 0, bones: 0 };
  if (!bots.length) return stats;
  const ids = bots.map((b) => b.id);
  const byId = new Map(bots.map((b) => [b.id, b]));
  const reach = balance.collectMaxDistanceM;

  const [tokens, food] = await Promise.all([
    db
      .select({ id: schema.tokens.id, ownerId: schema.tokens.ownerId, lat: schema.tokens.lat, lng: schema.tokens.lng, value: schema.tokens.value })
      .from(schema.tokens)
      .where(and(inArray(schema.tokens.ownerId, ids), isNull(schema.tokens.collectedAt))),
    db
      .select({ id: schema.foodItems.id, ownerId: schema.foodItems.ownerId, lat: schema.foodItems.lat, lng: schema.foodItems.lng })
      .from(schema.foodItems)
      .where(and(inArray(schema.foodItems.ownerId, ids), isNull(schema.foodItems.consumedAt))),
  ]);

  for (const t of tokens) {
    const b = byId.get(t.ownerId);
    if (!b || distanceMeters(b.pos, { lat: t.lat, lng: t.lng }) > reach) continue;
    await collectTokenTx(b.id, t.id, t.value, b.pos);
    stats.paws++;
  }
  for (const f of food) {
    const b = byId.get(f.ownerId);
    if (!b || distanceMeters(b.pos, { lat: f.lat, lng: f.lng }) > reach) continue;
    await eatFoodTx(b.id, f.id, b.pos);
    stats.bones++;
  }
  return stats;
}

// The mark gate a person's dog gets (territory.markIfDue), read for
// many bots in one query: grumpy or hungry dogs do not mark. Returns
// the reason per bot that may not, and nothing for bots that may.
export async function botMarkRefusals(ids: string[]): Promise<Map<string, 'grumpy' | 'hungry'>> {
  const out = new Map<string, 'grumpy' | 'hungry'>();
  if (!ids.length) return out;
  const rows = await db
    .select({ id: schema.companionState.userId, hunger: schema.companionState.hunger, happiness: schema.companionState.happiness })
    .from(schema.companionState)
    .where(inArray(schema.companionState.userId, ids));
  for (const r of rows) {
    if (r.happiness < balance.territory.minHappiness) out.set(r.id, 'grumpy');
    else if (r.hunger < balance.territory.minHunger) out.set(r.id, 'hungry');
  }
  return out;
}
