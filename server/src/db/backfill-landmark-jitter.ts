// One-shot pass to scatter existing lostDogs that the parser placed
// on a landmark fall-through coord. Run after the upsert.ts change
// landed — those new pets jitter at insert time, but everything
// already in the DB still stacks at the bare landmark pixel.
//
// Idempotent: it only updates rows whose coords STILL exactly match
// a landmark (jittered rows from a previous run are off the grid
// and won't match again). Seed for each row is its id, identical to
// the live upsert path, so a row that was already jittered by the
// new upsert code would land on the same point this script would
// pick anyway.
//
// Usage:
//   local:      pnpm --filter @shukajpes/server backfill:landmarks
//   production: fly ssh console -a shukajpes-api -C "node dist/db/backfill-landmark-jitter.js"

import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { pathToFileURL } from 'url';
import { db, schema, pg } from './index.js';
import { LANDMARKS, jitterAround } from '../pipeline/landmarks.js';

async function main() {
  const all = await db
    .select({
      id: schema.lostDogs.id,
      lat: schema.lostDogs.lastSeenLat,
      lng: schema.lostDogs.lastSeenLng,
      name: schema.lostDogs.name,
    })
    .from(schema.lostDogs);
  console.log(`▶ ${all.length} rows total`);

  let touched = 0;
  for (const row of all) {
    const lm = LANDMARKS.find(
      (l) => Math.abs(l.lat - row.lat) < 1e-5 && Math.abs(l.lng - row.lng) < 1e-5,
    );
    if (!lm) continue;
    const pin = jitterAround(lm.lat, lm.lng, row.id, 120);
    await db
      .update(schema.lostDogs)
      .set({ lastSeenLat: pin.lat, lastSeenLng: pin.lng })
      .where(eq(schema.lostDogs.id, row.id));
    touched++;
    console.log(
      `  ${row.name} @ ${lm.name} → ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}`,
    );
  }
  console.log(`✓ scattered ${touched} pets across ${LANDMARKS.length} landmarks`);
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
