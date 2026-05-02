// Search-zone expansion cron. Active lost pets get a wider walking
// circle as time passes — the longer the post sits unresolved, the
// further the pet has likely wandered. Same cron shape as decay.ts.
// SQL-only update so we don't pay round-trips per row.

import type { FastifyBaseLogger } from 'fastify';
import { sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { balance } from '../config/balance.js';
import { runCronTick } from './cronUtils.js';

export async function runZoneExpansionTick(): Promise<void> {
  const { baseRadiusM, growthPerDayM, maxRadiusM } = balance.zoneExpansion;
  // Compute days_since_seen in SQL, derive a target radius, take
  // GREATEST(current, target) so manual edits / wider parser values
  // never shrink — and LEAST(max, ...) for the safety cap.
  await db.execute(sql`
    UPDATE ${schema.lostDogs} AS d
    SET search_zone_radius_m = LEAST(
      ${maxRadiusM}::int,
      GREATEST(
        d.search_zone_radius_m,
        (${baseRadiusM} + FLOOR(EXTRACT(EPOCH FROM (NOW() - d.last_seen_at)) / 86400) * ${growthPerDayM})::int
      )
    )
    WHERE d.status = 'active'
  `);
}

export function startZoneExpansionCron(
  log: FastifyBaseLogger,
  intervalMs: number = balance.zoneExpansion.intervalMs,
): () => void {
  // Run once on boot so a cold start gets caught up immediately,
  // then on the interval. Mirrors the decay cron pattern.
  void runCronTick('zone-expansion', runZoneExpansionTick, log);
  const id = setInterval(() => {
    void runCronTick('zone-expansion', runZoneExpansionTick, log);
  }, intervalMs);
  id.unref?.();
  return () => clearInterval(id);
}
