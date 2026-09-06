// Daily janitor for spent tokens and eaten bones.
//
// WHY THIS EXISTS. Measured on production, 2026-09-05:
//
//   tokens       129 MB   540,520 rows   531,595 already collected
//   food_items    46 MB   230,142 rows   227,736 already consumed
//
// 175 MB of a 500 MB tier, 98% of it spent. Nothing had ever deleted a
// row from either table since the first spawn in April, because nothing
// was written to. May alone added 226,309 tokens.
//
// AND NOTHING READS THEM. Every query against these two tables in the
// codebase — all sixteen, checked one by one — filters `collected_at IS
// NULL` / `consumed_at IS NULL`. The single exception is the by-id
// lookup behind the double-collect guard (routes/tokens.ts,
// routes/food.ts), which needs a spent row only for as long as a client
// might retry a collect it already made. Days, not months.
//
// SCORES DO NOT LIVE HERE, which is what makes this safe. A player's
// lifetime totals are counters on `users` (total_tokens, points) and
// companion XP, all incremented inside the collect transaction. Delete
// every spent row and every profile reads exactly the same number. The
// «bones eaten» stat is counted from collect_events — a different table,
// deliberately NOT touched by this sweep for that reason.
//
// The one behaviour change: collecting an already-pruned token answers
// 404 «token not found» rather than 409 «already collected». Both refuse;
// the retention window keeps it unreachable in practice.
//
// WHAT THIS IS NOT. It does not make the map faster — the planner never
// reads spent rows (migration 0038 covers that separately), and it does
// not shrink the database file. Postgres marks the tuples dead and
// reuses the space for new rows; the reported size only drops after a
// VACUUM FULL, which takes an exclusive lock and belongs in a chosen
// window, not in a cron. What this buys is that the pile stops growing.

import type { FastifyBaseLogger } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { balance } from '../config/balance.js';
import { runCronTick } from './cronUtils.js';

// Delete in bounded batches rather than one statement. 531k rows in a
// single DELETE is a long transaction and a WAL burst on a small shared
// instance; a few thousand at a time is invisible. The cap means a tick
// can never run away — a backlog just takes a few days to drain, which
// is fine for rows nobody reads.
async function sweep(
  table: 'tokens' | 'food_items',
  spentColumn: 'collected_at' | 'consumed_at',
  retentionMs: number,
  batchSize: number,
  maxBatches: number,
): Promise<{ deleted: number; drained: boolean }> {
  let deleted = 0;
  for (let i = 0; i < maxBatches; i++) {
    // ctid, so the delete finds its rows by physical address and does not
    // re-plan a growing NOT IN on every pass.
    //
    // RETURNING is not decoration. A bare DELETE hands postgres-js an
    // empty array, so `res.length` is 0 however many rows went — the loop
    // would read that as "drained" and stop after one batch, quietly
    // deleting 5,000 rows a day and reporting nothing. Ask for a row back
    // per deletion and the count is real.
    const res = await db.execute(sql`
      DELETE FROM ${sql.identifier(table)}
      WHERE ctid IN (
        SELECT ctid FROM ${sql.identifier(table)}
        WHERE ${sql.identifier(spentColumn)} IS NOT NULL
          AND ${sql.identifier(spentColumn)}
              < NOW() - (${retentionMs}::bigint * INTERVAL '1 millisecond')
        LIMIT ${batchSize}
      )
      RETURNING ctid
    `);
    const n = res.length ?? 0;
    deleted += n;
    if (n < batchSize) return { deleted, drained: true };
  }
  return { deleted, drained: false };
}

export async function runSpentItemCleanupTick(log: FastifyBaseLogger): Promise<void> {
  const c = balance.spentItemCleanup;

  const tokens = await sweep(
    'tokens', 'collected_at', c.retentionMs, c.batchSize, c.maxBatchesPerTick,
  );
  const food = await sweep(
    'food_items', 'consumed_at', c.retentionMs, c.batchSize, c.maxBatchesPerTick,
  );

  // A tick that hit its batch cap has a backlog behind it. Say so, or the
  // first person to look at a table that is still enormous has no way to
  // tell a sweep that is working through it from one that is stuck.
  log.info(
    {
      kind: 'spent_item_cleanup',
      tokens_deleted: tokens.deleted,
      food_deleted: food.deleted,
      backlog: !tokens.drained || !food.drained,
    },
    `[spentItemCleanup] removed ${tokens.deleted} tokens, ${food.deleted} food`,
  );
}

export function startSpentItemCleanupCron(
  log: FastifyBaseLogger,
  intervalMs: number = balance.spentItemCleanup.intervalMs,
) {
  // Once on boot then on the interval — the shape lostDogCleanup settled
  // on after discovering a 24h cron never fires on a service that
  // redeploys several times a day.
  void runCronTick('spentItemCleanup', () => runSpentItemCleanupTick(log), log);
  const id = setInterval(() => {
    void runCronTick('spentItemCleanup', () => runSpentItemCleanupTick(log), log);
  }, intervalMs);
  id.unref?.();
  return () => clearInterval(id);
}
