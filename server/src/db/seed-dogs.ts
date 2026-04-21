// Idempotent seed of ~18 plausible lost dogs spread across Kyiv so the
// companion has something real to talk about before the scraper pipeline lands.
// Safe to re-run — rows are keyed by deterministic IDs and inserted with
// ON CONFLICT DO NOTHING. `last_seen_at` is computed at run-time so the
// stories stay fresh on every run.
//
// Usage:
//   local:      pnpm --filter @shukajpes/server db:seed-dogs
//   production: exposed via seedOnBootIfEmpty(), called from src/index.ts
//   one-shot:   fly ssh console -a shukajpes-api -C "node dist/db/seed-dogs.js"

import 'dotenv/config';
import { eq, sql } from 'drizzle-orm';
import { pathToFileURL } from 'url';
import type { FastifyBaseLogger } from 'fastify';
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

// Coordinates anchored to known Kyiv districts/landmarks, kept ~1–2 km off any
// exact address so the seed doesn't pretend to own a specific building.
const SEED: SeedDog[] = [
  // right bank — центр
  {
    id: 'seed-dog-ulia-maidan',
    name: 'Уля',
    breed: 'mixed / дворняга',
    emoji: '🐕',
    lat: 50.4503,
    lng: 30.5234,
    daysAgo: 1,
    description: 'small black mix, nursing mother, last seen around Maidan underpass',
    urgency: 'urgent',
    radius: 700,
  },
  {
    id: 'seed-dog-druzhok-palats',
    name: 'Дружок',
    breed: 'pug',
    emoji: '🐕',
    lat: 50.4360,
    lng: 30.5212,
    daysAgo: 1,
    description: 'fawn pug, breathing issues, needs daily meds — urgent',
    urgency: 'urgent',
    radius: 500,
  },
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
  // right bank — північ
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
    id: 'seed-dog-zefir-nyvky',
    name: 'Зефір',
    breed: 'samoyed',
    emoji: '🐕',
    lat: 50.4603,
    lng: 30.4022,
    daysAgo: 2,
    description: 'pure white fluff, friendly, squeezed out of the yard on Nyvky',
    urgency: 'medium',
    radius: 600,
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
    id: 'seed-dog-shrek-sviatoshyn',
    name: 'Шрек',
    breed: 'boxer',
    emoji: '🐕',
    lat: 50.4576,
    lng: 30.3739,
    daysAgo: 4,
    description: 'fawn boxer, big but very scared, will not approach humans easily',
    urgency: 'medium',
    radius: 700,
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
  // right bank — захід / південь
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
    id: 'seed-dog-dexter-kpi',
    name: 'Декстер',
    breed: 'standard poodle',
    emoji: '🐩',
    lat: 50.4480,
    lng: 30.4577,
    daysAgo: 3,
    description: 'grey poodle, gentle senior, last seen near KPI campus',
    urgency: 'medium',
    radius: 500,
  },
  {
    id: 'seed-dog-bagira-demiivka',
    name: 'Багіра',
    breed: 'black mix',
    emoji: '🐕',
    lat: 50.4045,
    lng: 30.5197,
    daysAgo: 2,
    description: 'all black, no collar, medium-sized, skittish',
    urgency: 'medium',
    radius: 600,
  },
  {
    id: 'seed-dog-snupi-holosiivo',
    name: 'Снупі',
    breed: 'beagle mix',
    emoji: '🐶',
    lat: 50.3806,
    lng: 30.4894,
    daysAgo: 4,
    description: 'tri-color, floppy ears, likely ran into Holosiivskyi park',
    urgency: 'medium',
    radius: 800,
  },
  // left bank
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
  {
    id: 'seed-dog-archi-pozniaky',
    name: 'Арчі',
    breed: 'beagle',
    emoji: '🐶',
    lat: 50.4026,
    lng: 30.6366,
    daysAgo: 1,
    description: 'classic tri beagle, nose to the ground, ignores recall',
    urgency: 'urgent',
    radius: 600,
  },
  {
    id: 'seed-dog-knopka-kharkivskyi',
    name: 'Кнопка',
    breed: 'small mix / той-тер',
    emoji: '🐕',
    lat: 50.4083,
    lng: 30.6605,
    daysAgo: 1,
    description: 'tiny, kids crying at home — family dog, please help bring home',
    urgency: 'urgent',
    radius: 500,
  },
  {
    id: 'seed-dog-loki-osokorky',
    name: 'Локі',
    breed: 'alaskan malamute',
    emoji: '🐺',
    lat: 50.4009,
    lng: 30.6143,
    daysAgo: 5,
    description: 'large grey-black, broke harness, strong dog but good with kids',
    urgency: 'medium',
    radius: 800,
  },
];

export async function seedLostDogs(): Promise<{ inserted: number; skipped: number; total: number }> {
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

  const totals = await db.select({ total: sql<number>`count(*)::int` }).from(schema.lostDogs);
  const total = totals[0]?.total ?? 0;
  return { inserted, skipped, total };
}

// Boot-time seed hook: only inserts if the DB has zero seed rows. Real scraped
// and in-app reports never interact with this — we filter strictly by
// source = 'seed'. Failure is logged and swallowed so a transient DB hiccup
// can't brick server startup.
export async function seedOnBootIfEmpty(
  log: Pick<FastifyBaseLogger, 'info' | 'warn'>,
): Promise<void> {
  try {
    const existing = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.lostDogs)
      .where(eq(schema.lostDogs.source, 'seed'));
    const existingCount = existing[0]?.n ?? 0;
    if (existingCount > 0) {
      log.info({ seedRows: existingCount }, 'seed-dogs: existing seed rows present, skipping');
      return;
    }
    const res = await seedLostDogs();
    log.info(res, 'seed-dogs: applied on boot');
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'seed-dogs boot attempt failed — continuing without seed');
  }
}

// CLI entry — only runs when invoked directly, never on import.
const argv1 = process.argv[1];
const isCli = !!argv1 && import.meta.url === pathToFileURL(argv1).href;
if (isCli) {
  seedLostDogs()
    .then((res) => {
      // eslint-disable-next-line no-console
      console.log(`seed-dogs: inserted ${res.inserted}, skipped ${res.skipped}, total ${res.total}`);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('seed-dogs failed:', err);
      process.exitCode = 1;
    })
    .finally(() => pg.end());
}
