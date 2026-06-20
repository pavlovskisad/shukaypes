// Daily janitor for the lostDogs table. Two passes — both mark
// status='expired' rather than DELETE so an oversweep is recoverable
// (a one-liner UPDATE flips them back to 'active').
//
// 1. Low-confidence sweep
//    Rows ingested with parse_confidence below
//    balance.lostDogCleanup.lowConfidenceThreshold AND untouched
//    longer than lowConfidenceGraceMs. The bot ingest already
//    refuses < 0.5 at insert time, but the threshold here is set
//    a notch higher (0.6) so anything that just barely passed but
//    nobody engaged with auto-cleans.
//
// 2. Stale-active sweep
//    Rows with last_seen_at older than staleAfterMs and no sighting
//    in the last sightingsGraceMs. Most lost-pet posts are either
//    resolved (and the OP doesn't update) or fade naturally —
//    keeping 6-month-old pins on the map adds clutter, not value.
//
// We log per-sweep counts so the daily run is observable in fly logs.

import type { FastifyBaseLogger } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { balance } from '../config/balance.js';
import { runCronTick } from './cronUtils.js';

export async function runLostDogCleanupTick(log: FastifyBaseLogger): Promise<void> {
  const c = balance.lostDogCleanup;

  // Low-confidence sweep. Joins lostDogs ↔ scrape_log on dog_id so
  // we only act on bot/scrape-ingested rows (admin sideloads have
  // no scrape_log row and stay put).
  const lowConfRes = await db.execute(sql`
    UPDATE lost_dogs
    SET status = 'expired'
    WHERE status = 'active'
      AND id IN (
        SELECT sl.dog_id
        FROM scrape_log sl
        WHERE sl.dog_id IS NOT NULL
          AND sl.parse_confidence IS NOT NULL
          AND sl.parse_confidence < ${c.lowConfidenceThreshold}
          AND sl.first_seen_at < NOW() - (${c.lowConfidenceGraceMs}::bigint * INTERVAL '1 millisecond')
      )
      AND NOT EXISTS (
        SELECT 1 FROM sightings s
        WHERE s.dog_id = lost_dogs.id
          AND s.created_at > NOW() - (${c.lowConfidenceGraceMs}::bigint * INTERVAL '1 millisecond')
      )
    RETURNING id
  `);

  // Stale-active sweep. Pure age + no-recent-sighting check.
  const staleRes = await db.execute(sql`
    UPDATE lost_dogs
    SET status = 'expired'
    WHERE status = 'active'
      AND last_seen_at < NOW() - (${c.staleAfterMs}::bigint * INTERVAL '1 millisecond')
      AND NOT EXISTS (
        SELECT 1 FROM sightings s
        WHERE s.dog_id = lost_dogs.id
          AND s.created_at > NOW() - (${c.sightingsGraceMs}::bigint * INTERVAL '1 millisecond')
      )
    RETURNING id
  `);

  log.info(
    {
      kind: 'lost_dog_cleanup',
      low_confidence_expired: lowConfRes.length,
      stale_expired: staleRes.length,
    },
    '[lostDogCleanup] daily sweep',
  );
}

export function startLostDogCleanupCron(
  log: FastifyBaseLogger,
  intervalMs: number = balance.lostDogCleanup.intervalMs,
) {
  const id = setInterval(() => {
    void runCronTick('lostDogCleanup', () => runLostDogCleanupTick(log), log);
  }, intervalMs);
  id.unref?.();
  return () => clearInterval(id);
}
