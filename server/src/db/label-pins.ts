// COMPLETE THE PLACEMENT LEDGER, moving nothing.
//
// Migration 0037 gave every pin a placement_source, but only rows
// written since then carry one — the rest are null, which is honest
// ("placed before the column existed") and useless to an audit. This
// stamps the null rows by the same recomputation audit-pins used to
// prove placement the hard way:
//
//   exact fall-through coordinate        → 'fall-through'
//   reproduces jitterAround(landmark)    → 'model-landmark:<name>'
//   anything else                        → 'model-geo'
//
// Coordinates are NEVER touched. Active rows only: an expired pet's
// pin is out of every query the app makes, and its label can stay
// null-honest.
//
// Dry by default; --apply writes the labels printed.
//
// Usage:
//   fly ssh console -a shukajpes-api -C "node dist/db/label-pins.js"
//   fly ssh console -a shukajpes-api -C "node dist/db/label-pins.js --apply"

import 'dotenv/config';
import { and, eq, isNull } from 'drizzle-orm';
import { pathToFileURL } from 'url';
import { db, schema, pg } from './index.js';
import { LANDMARKS, jitterAround } from '../pipeline/landmarks.js';

const FALLBACK = { lat: 50.4501, lng: 30.5234 };
const JITTER_M = 120;

async function main() {
  const apply = process.argv.includes('--apply');

  const pets = await db
    .select({
      id: schema.lostDogs.id,
      lat: schema.lostDogs.lastSeenLat,
      lng: schema.lostDogs.lastSeenLng,
    })
    .from(schema.lostDogs)
    .where(and(eq(schema.lostDogs.status, 'active'), isNull(schema.lostDogs.placementSource)));

  if (pets.length === 0) {
    console.log('\n!! READ NOTHING — no active rows with a null placement_source.');
    console.log('   Either the ledger is already complete, or this ran against the wrong database.');
    await pg.end();
    return;
  }

  const labelOf = (p: { id: string; lat: number; lng: number }): string => {
    if (Math.abs(p.lat - FALLBACK.lat) < 1e-9 && Math.abs(p.lng - FALLBACK.lng) < 1e-9) {
      return 'fall-through';
    }
    for (const lm of LANDMARKS) {
      const j = jitterAround(lm.lat, lm.lng, p.id, JITTER_M);
      if (Math.abs(j.lat - p.lat) < 1e-9 && Math.abs(j.lng - p.lng) < 1e-9) {
        return `model-landmark:${lm.name}`;
      }
    }
    return 'model-geo';
  };

  const byLabel = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const p of pets) {
    const label = labelOf(p);
    labels.set(p.id, label);
    byLabel.set(label, (byLabel.get(label) ?? 0) + 1);
  }

  console.log(`\n${pets.length} active pets with no placement label. ${apply ? 'Writing' : 'Would write'}:\n`);
  for (const [label, count] of [...byLabel.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(count).padStart(4)}  ${label}`);
  }

  if (!apply) {
    console.log('\n✓ dry run. Coordinates are never touched either way. Re-run with --apply to stamp them.');
    await pg.end();
    return;
  }

  let applied = 0;
  for (const [id, label] of labels) {
    await db
      .update(schema.lostDogs)
      .set({ placementSource: label })
      .where(eq(schema.lostDogs.id, id));
    applied++;
  }
  console.log(`\n✓ applied: ${applied} rows labelled. No coordinate changed.`);
  await pg.end();
}

const isEntry = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isEntry) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
