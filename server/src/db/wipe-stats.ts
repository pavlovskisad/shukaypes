// One-off wipe of progression stats so testing starts from a clean
// slate after the economy rebalance. Resets XP, level, points,
// totalTokens, totalDistanceMeters across every user + their
// companion meters back to balance defaults. Leaves immutable
// records (collectEvents, quests, sightings, scrape_log, messages)
// untouched — those are history, not progression.
//
// Usage:
//   local:       pnpm --filter @shukajpes/server wipe:stats
//   production:  fly ssh console -a shukajpes-api -C "node dist/db/wipe-stats.js"

import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { pathToFileURL } from 'url';
import { db, schema, pg } from './index.js';
import { balance } from '../config/balance.js';

async function main() {
  const userCount = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.users);
  console.log(`▶ wiping stats across ${userCount[0]?.n ?? 0} users`);

  await db.execute(sql`
    UPDATE ${schema.users}
    SET points = 0,
        total_tokens = 0,
        total_distance_meters = 0
  `);
  console.log('  users → points / totalTokens / totalDistanceMeters = 0');

  await db.execute(sql`
    UPDATE ${schema.companionState}
    SET xp = 0,
        level = 1,
        hunger = ${balance.hunger.start},
        happiness = ${balance.happiness.start},
        last_decay_at = NOW(),
        last_fed_at = NULL,
        memory_notes = NULL
  `);
  console.log(
    `  companionState → xp 0 / level 1 / hunger ${balance.hunger.start} / happiness ${balance.happiness.start} / memory cleared`,
  );

  // Daily tasks: drop so today's counters start from zero. They're
  // keyed by (userId, date) so simpler to truncate than to update.
  await db.execute(sql`TRUNCATE TABLE ${schema.dailyTasks}`);
  console.log('  dailyTasks → truncated');

  console.log('✓ done.');
}

const isEntry = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isEntry) {
  main()
    .then(() => pg.end())
    .catch((err) => {
      console.error(err);
      pg.end().finally(() => process.exit(1));
    });
}
