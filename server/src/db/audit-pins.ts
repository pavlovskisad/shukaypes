// DOES THE PIN AGREE WITH THE AD? Read-only.
//
// Reported from the map: an ad saying «Софіївська Борщагівка» showed up
// in the city centre. That is wrong twice — Sofiivska Borshchahivka is a
// village west of Kyiv, not a district of it — and it is the kind of
// wrong nobody can see from inside the pipeline, because every stage
// reports success. The parser returns a coordinate, the bbox check
// passes because the coordinate is genuinely in Kyiv, and the pet lands
// on the map looking exactly like a real one.
//
// HOW A PET ENDS UP IN THE CENTRE. Two coordinates, twenty-two metres
// apart:
//
//   50.4501, 30.5234   the parser's fall-through, filtered from the map
//   50.4503, 30.5234   LANDMARKS 'Maidan / Хрещатик', not filtered
//
// A pet the parser cannot place gets the first and is correctly hidden.
// A pet the MODEL places on Maidan — the natural answer to "somewhere in
// Kyiv" — gets the second, escapes the fall-through filter because it is
// not an exact match, and is then scattered by jitterAround(…, 120) into
// a ring around Khreshchatyk.
//
// AND THE STREET INDEX IS NOT CONSULTED. parser.ts asks the model to
// infer lat/lng from a hardcoded list of ~41 landmarks. kyiv_gazetteer —
// thousands of real Kyiv streets, seeded for this — is read only by
// questPlaces. So «вул. Зодчих» has to become one of 41 guesses.
//
// WHAT THIS DOES. For every active pet with a stored ad, find the place
// names the OWNER wrote, look them up in the gazetteer, and measure how
// far that is from where we put the pin. A pet whose ad names a street
// three kilometres from its pin is a pet nobody will find.
//
// Deliberately independent of the parser: it matches text against the
// gazetteer directly rather than re-running the parser's own logic. A
// check that reproduces the thing it is checking cannot fail.
//
// Prints pet names, place names and distances. No ad text, so nothing
// here can carry a contact.
//
// Usage:
//   fly ssh console -a shukajpes-api -C "node dist/db/audit-pins.js"
//   fly ssh console -a shukajpes-api -C "node dist/db/audit-pins.js --km=1"

import 'dotenv/config';
import { eq, isNotNull } from 'drizzle-orm';
import { pathToFileURL } from 'url';
import { db, schema, pg } from './index.js';

// The centre pile: Maidan, and the jitter radius the upsert scatters by.
const MAIDAN = { lat: 50.4503, lng: 30.5234 };
const JITTER_M = 120;
// A shade over the jitter radius — anything inside this ring around
// Maidan is a pet that was placed on the landmark, not one that happens
// to be lost on Khreshchatyk.
const CENTRE_RING_M = 160;

// Short names match everything. «Лісова» is a metro station, a street and
// a word; six characters is where a match starts meaning something.
const MIN_PLACE_CHARS = 6;

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/['’ʼ`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

async function main() {
  const kmArg = process.argv.find((a) => a.startsWith('--km='));
  const thresholdM = (kmArg ? Number(kmArg.split('=')[1]) || 2 : 2) * 1000;

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

  if (pets.length === 0) {
    console.log('!! NO ACTIVE PETS. This read nothing — confirm which database.');
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

  const places = (
    await db
      .select({
        name: schema.kyivGazetteer.nameUk,
        lat: schema.kyivGazetteer.lat,
        lng: schema.kyivGazetteer.lng,
      })
      .from(schema.kyivGazetteer)
  )
    .map((p) => ({ ...p, key: norm(p.name) }))
    .filter((p) => p.key.length >= MIN_PLACE_CHARS);

  if (places.length === 0) {
    console.log('\n!! THE GAZETTEER IS EMPTY. Nothing can be compared against it, so');
    console.log('   "no mismatches" below would mean nothing at all. Seed it first.');
    await pg.end();
    return;
  }

  console.log(`\nactive pets: ${pets.length}   gazetteer places: ${places.length}`);

  // THE CENTRE PILE, which needs no text at all to detect.
  const centre = pets.filter((p) => haversineM(p.lat, p.lng, MAIDAN.lat, MAIDAN.lng) <= CENTRE_RING_M);
  console.log(
    `\nPINNED ON MAIDAN (within ${CENTRE_RING_M}m, jitter is ${JITTER_M}m): ${centre.length}`,
  );
  for (const p of centre.slice(0, 15)) {
    console.log(`  ${p.name.padEnd(28)} ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`);
  }
  if (centre.length > 15) console.log(`  … and ${centre.length - 15} more`);
  if (centre.length > 0) {
    console.log(
      `\n  These are pets the model placed on the landmark rather than on a\n` +
        `  street. They are 22m from the fall-through coordinate the map\n` +
        `  filters out, which is why they are visible at all.`,
    );
  }

  // THE COMPARISON PROPER: what the owner wrote vs where we put them.
  let checked = 0;
  let noPlace = 0;
  const far: { name: string; place: string; m: number }[] = [];

  for (const pet of pets) {
    const text = `${pet.desc ?? ''}\n${bodies.get(pet.id) ?? ''}`.trim();
    if (!text) continue;
    checked++;
    const hay = norm(text);

    // Longest match wins: «борщагівська» beats «садова», and the more
    // specific name is the one the owner meant.
    let best: { name: string; lat: number; lng: number } | null = null;
    for (const p of places) {
      if (!hay.includes(p.key)) continue;
      if (!best || p.key.length > norm(best.name).length) best = p;
    }
    if (!best) {
      noPlace++;
      continue;
    }

    const m = haversineM(pet.lat, pet.lng, best.lat, best.lng);
    if (m > thresholdM) far.push({ name: pet.name, place: best.name, m });
  }

  console.log(`\nPETS WHOSE AD NAMES A PLACE: ${checked - noPlace} of ${checked} with text`);
  console.log(`  … no gazetteer place named:  ${noPlace}`);
  console.log(`\nPIN MORE THAN ${(thresholdM / 1000).toFixed(1)}km FROM THE PLACE THE AD NAMES: ${far.length}\n`);

  for (const f of far.sort((a, b) => b.m - a.m).slice(0, 25)) {
    console.log(
      `  ${f.name.padEnd(26)} ad says «${f.place}»`.padEnd(70) +
        ` ${(f.m / 1000).toFixed(1)}km away`,
    );
  }
  if (far.length > 25) console.log(`  … and ${far.length - 25} more`);

  console.log(
    `\n  A match is the longest gazetteer name appearing in the ad, so it is` +
      `\n  suggestive rather than proof — an ad can name the street somebody` +
      `\n  was walking on, not where the animal went missing. Read a few before` +
      `\n  treating the count as a defect rate.` +
      `\n\n✓ read-only, nothing written, no ad text printed.`,
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
