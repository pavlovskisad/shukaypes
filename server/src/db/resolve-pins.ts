// WOULD THE GAZETTEER RESCUE THE PETS NOBODY CAN SEE? Dry run only.
//
// 80 of 176 active pets sit on the fall-through coordinate and are
// filtered out of every map query. 69 more reproduce exactly as a
// jittered landmark, which is the model's nearest guess rather than an
// address. That is 85% of the map placed by something other than what
// the owner wrote.
//
// The proposed fix is to resolve the place from the ad text against
// kyiv_gazetteer, which already holds 16,917 real Kyiv places and which
// no part of the ingest path reads. Before changing how pets are placed
// — a change that moves pins on a live map — the honest question is
// whether it would work at all.
//
// So: run the resolver over the stored ad text of exactly those pets and
// count how many get a place. NOTHING IS WRITTEN. No network either;
// every pet in scope already has its ad text stored.
//
// WHAT A HIGH NUMBER WOULD MEAN, and what it would not. It would mean
// the text names a place we hold coordinates for — not that those
// coordinates are right. A resolver that confidently picks the wrong
// «Садова» sends a walker to the wrong end of the city, which is worse
// than the honest fall-through it replaced, because the map looks
// correct. That is why marked and bare are counted apart here, and why
// the sample prints both for reading rather than a single rate.
//
// Usage:
//   fly ssh console -a shukajpes-api -C "node dist/db/resolve-pins.js"

import 'dotenv/config';
import { eq, isNotNull } from 'drizzle-orm';
import { pathToFileURL } from 'url';
import { db, schema, pg } from './index.js';
import { resolvePlace, type GazetteerPlace } from '../pipeline/resolvePlace.js';
import { LANDMARKS, jitterAround } from '../pipeline/landmarks.js';

const FALLBACK = { lat: 50.4501, lng: 30.5234 };
const JITTER_M = 120;

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

async function main() {
  const pets = await db
    .select({
      id: schema.lostDogs.id,
      name: schema.lostDogs.name,
      lat: schema.lostDogs.lastSeenLat,
      lng: schema.lostDogs.lastSeenLng,
      desc: schema.lostDogs.lastSeenDescription,
    })
    .from(schema.lostDogs)
    .where(eq(schema.lostDogs.status, 'active'));

  const places: GazetteerPlace[] = await db
    .select({
      name: schema.kyivGazetteer.nameUk,
      lat: schema.kyivGazetteer.lat,
      lng: schema.kyivGazetteer.lng,
      category: schema.kyivGazetteer.category,
    })
    .from(schema.kyivGazetteer);

  if (pets.length === 0 || places.length === 0) {
    console.log('\n!! READ NOTHING — pets or gazetteer came back empty. Confirm which');
    console.log('   database before reading anything below as a result.');
    await pg.end();
    return;
  }

  const bodies = new Map<string, string>();
  for (const r of await db
    .select({ dogId: schema.scrapeLog.dogId, body: schema.scrapeLog.rawBody })
    .from(schema.scrapeLog)
    .where(isNotNull(schema.scrapeLog.rawBody))) {
    if (r.dogId && !bodies.has(r.dogId)) bodies.set(r.dogId, r.body!);
  }

  const isFallback = (p: { lat: number; lng: number }) =>
    Math.abs(p.lat - FALLBACK.lat) < 1e-9 && Math.abs(p.lng - FALLBACK.lng) < 1e-9;
  const landmarkOf = (p: { id: string; lat: number; lng: number }) => {
    for (const lm of LANDMARKS) {
      const j = jitterAround(lm.lat, lm.lng, p.id, JITTER_M);
      if (Math.abs(j.lat - p.lat) < 1e-9 && Math.abs(j.lng - p.lng) < 1e-9) return lm;
    }
    return null;
  };

  const groups = {
    hidden: pets.filter(isFallback),
    landmark: pets.filter((p) => !isFallback(p) && landmarkOf(p)),
  };

  for (const [label, rows] of Object.entries(groups)) {
    const heading =
      label === 'hidden'
        ? `THE ${rows.length} INVISIBLE PETS — would the gazetteer place them?`
        : `THE ${rows.length} LANDMARK-GUESSED PETS — would it place them better?`;
    console.log(`\n${heading}\n`);

    let marked = 0;
    let bare = 0;
    let none = 0;
    let noText = 0;
    const sample: string[] = [];

    for (const pet of rows) {
      const text = `${pet.desc ?? ''}\n${bodies.get(pet.id) ?? ''}`.trim();
      if (!text) {
        noText++;
        continue;
      }
      const hit = resolvePlace(text, places);
      if (!hit) {
        none++;
        continue;
      }
      if (hit.marked) marked++;
      else bare++;

      if (sample.length < 12) {
        // For the landmark group, how far the resolver would MOVE the
        // pet is the number that matters — a 200m correction is noise,
        // a 6km one is the difference between finding an animal and not.
        const moved = label === 'landmark' ? haversineM(pet.lat, pet.lng, hit.lat, hit.lng) : 0;
        sample.push(
          `    ${pet.name.padEnd(24)} → «${hit.name}»${hit.marked ? ' [marked]' : ''}` +
            (label === 'landmark' ? `  moves ${(moved / 1000).toFixed(1)}km` : ''),
        );
      }
    }

    const placed = marked + bare;
    console.log(`  would be placed:        ${placed} of ${rows.length}`);
    console.log(`    … from a marked address: ${marked}   ← high confidence`);
    console.log(`    … from a bare name:      ${bare}   ← needs the eye`);
    console.log(`  no place named in the ad: ${none}`);
    console.log(`  no ad text stored:        ${noText}`);
    if (sample.length > 0) {
      console.log('');
      for (const s of sample) console.log(s);
    }
  }

  console.log(
    `\n  A pet being "placed" means the ad names a place we hold coordinates` +
      `\n  for. It does not mean those coordinates are right. A resolver that` +
      `\n  confidently picks the wrong «Садова» sends somebody to the wrong end` +
      `\n  of the city, which is worse than the fall-through it replaced —` +
      `\n  because that map looks correct.` +
      `\n\n✓ dry run. Nothing written, no requests made.`,
  );
  await pg.end();
}

const isEntry = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isEntry) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
