// Idempotent seed of 8 plausible lost dogs spread across Kyiv districts so the
// companion has something real to talk about before the scraper pipeline lands.
// Safe to re-run: rows are keyed by deterministic IDs, inserted with
// ON CONFLICT DO NOTHING. Times are computed at run-time so the "last seen" feels
// recent on every fresh DB.
//
// Run locally:   pnpm --filter @shukajpes/server exec tsx src/db/seed-dogs.ts
// Run on fly:    fly ssh console -a shukajpes-api -C "node dist/db/seed-dogs.js"

import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db, schema, pg } from './index.js';

interface SeedDog {
  id: string;
  name: string;
  breed: string;
  emoji: string;
  lat: number;
  lng: number;
  daysAgo: number;
  description: string;
  urgency: 'urgent' | 'medium' | 'resolved';
  radius: number;
}

// Coordinates anchored to known Kyiv districts. Kept ~1-2km off any exact
// landmark so the seed doesn't pretend to own a specific address.
const SEED: SeedDog[] = [
  {
    id: 'seed-dog-busynka-podil',
    name: 'Бусинка',
    breed: 'mixed / дворняга',
    emoji: '🐕',
    lat: 50.4612,
    lng: 30.5172,
    daysAgo: 1,
    description: 'small tan mix, red collar, ran off near Kontraktova',
    urgency: 'urgent',
    radius: 600,
  },
  {
    id: 'seed-dog-rex-pechersk',
    name: 'Рекс',
    breed: 'german shepherd',
    emoji: '🐕‍🦺',
    lat: 50.4363,
    lng: 30.5421,
    daysAgo: 2,
    description: 'adult male, limps on left back paw, responds to whistle',
    urgency: 'urgent',
    radius: 800,
  },
  {
    id: 'seed-dog-milo-obolon',
    name: 'Майло',
    breed: 'jack russell',
    emoji: '🐶',
    lat: 50.5094,
    lng: 30.4981,
    daysAgo: 3,
    description: 'white with brown ears, slipped leash on Obolonska embankment',
    urgency: 'medium',
    radius: 500,
  },
  {
    id: 'seed-dog-lora-troieshchyna',
    name: 'Лора',
    breed: 'labrador',
    emoji: '🦮',
    lat: 50.5167,
    lng: 30.6083,
    daysAgo: 4,
    description: 'yellow lab, very friendly, no collar, answers to name',
    urgency: 'medium',
    radius: 700,
  },
  {
    id: 'seed-dog-baron-solomianka',
    name: 'Барон',
    breed: 'husky',
    emoji: '🐺',
    lat: 50.4365,
    lng: 30.4608,
    daysAgo: 5,
    description: 'grey-white husky, blue eyes, escaped from yard on Kadetskyi',
    urgency: 'medium',
    radius: 600,
  },
  {
    id: 'seed-dog-tosia-lukianivka',
    name: 'Тося',
    breed: 'shiba inu',
    emoji: '🦊',
    lat: 50.4641,
    lng: 30.4702,
    daysAgo: 2,
    description: 'small reddish, chip number on tag, shy around strangers',
    urgency: 'urgent',
    radius: 500,
  },
  {
    id: 'seed-dog-havrik-vynohradar',
    name: 'Гаврік',
    breed: 'cocker spaniel',
    emoji: '🐕',
    lat: 50.4829,
    lng: 30.4102,
    daysAgo: 6,
    description: 'black curly ears, older dog, may be hiding in bushes',
    urgency: 'medium',
    radius: 700,
  },
  {
    id: 'seed-dog-charlie-darnytsia',
    name: 'Чарлі',
    breed: 'border collie',
    emoji: '🐕',
    lat: 50.4361,
    lng: 30.6377,
    daysAgo: 3,
    description: 'black-white, whistle-trained, last seen near Livoberezhna',
    urgency: 'medium',
    radius: 600,
  },
];

async function run() {
  const now = Date.now();
  let inserted = 0;
  let skipped = 0;

  for (const d of SEED) {
    const lastSeenAt = new Date(now - d.daysAgo * 24 * 60 * 60 * 1000);
    const res = await db
      .insert(schema.lostDogs)
      .values({
        id: d.id,
        name: d.name,
        breed: d.breed,
        emoji: d.emoji,
        lastSeenLat: d.lat,
        lastSeenLng: d.lng,
        lastSeenAt,
        lastSeenDescription: d.description,
        urgency: d.urgency,
        searchZoneRadiusM: d.radius,
        rewardPoints: d.urgency === 'urgent' ? 200 : 100,
        source: 'seed',
        status: 'active',
      })
      .onConflictDoNothing({ target: schema.lostDogs.id })
      .returning({ id: schema.lostDogs.id });
    if (res.length > 0) inserted++;
    else skipped++;
  }

  const totals = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.lostDogs);
  const total = totals[0]?.total ?? 0;

  // eslint-disable-next-line no-console
  console.log(`seed-dogs: inserted ${inserted}, skipped ${skipped}, total in lost_dogs: ${total}`);
  await pg.end();
}

run().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error('seed-dogs failed:', err);
  await pg.end();
  process.exit(1);
});
