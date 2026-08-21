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
import { LANDMARKS, jitterAround } from '../pipeline/landmarks.js';

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

// Words an owner puts in front of a place when they mean a place. The
// text is normalised before this runs, so «вул.» has already become
// «вул» and the dots cannot be relied on.
const MARKERS =
  /(вул|вулиц|просп|проспект|бульвар|площ|провул|мкр|масив|район|селищ|село|смт|метро|станц|ж\s?м|жм)\s*$/;

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

  // THE CENTRE PILE — and the split inside it is the whole point.
  //
  // The first version of this counted a 160m ring around Maidan and
  // called them all "placed on the landmark". Wrong: nearly every one
  // was sitting on the fall-through coordinate itself, 22m away, which
  // BOTH map queries filter exactly. Those pets are not misplaced in the
  // centre — they are invisible, which is a different and larger problem.
  //
  // So separate the two, because the fixes have nothing in common:
  //
  //   HIDDEN   exactly the fall-through. Filtered from every map query,
  //            so the walker never sees them. A pet in this bucket is
  //            one nobody can be asked to look for.
  //   VISIBLE  near Maidan but NOT the fall-through — the model named
  //            the landmark, or the jitter moved it off the exact point.
  //            These DO render, in the wrong place, which is what
  //            somebody looking at the map actually reports.
  const FALLBACK = { lat: 50.4501, lng: 30.5234 };
  const isFallback = (p: { lat: number; lng: number }) =>
    Math.abs(p.lat - FALLBACK.lat) < 1e-9 && Math.abs(p.lng - FALLBACK.lng) < 1e-9;

  const hidden = pets.filter(isFallback);
  const nearCentre = pets.filter(
    (p) => !isFallback(p) && haversineM(p.lat, p.lng, MAIDAN.lat, MAIDAN.lng) <= CENTRE_RING_M,
  );

  console.log(
    `\nON THE FALL-THROUGH COORDINATE — filtered from every map query: ${hidden.length}` +
      ` of ${pets.length}`,
  );
  console.log(
    `  The pet is active, the walker cannot see it, and nothing reports this.`,
  );

  console.log(
    `\nNEAR MAIDAN BUT VISIBLE (within ${CENTRE_RING_M}m, jitter is ${JITTER_M}m): ${nearCentre.length}`,
  );
  for (const p of nearCentre.slice(0, 15)) {
    console.log(`  ${p.name.padEnd(28)} ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`);
  }
  if (nearCentre.length > 15) console.log(`  … and ${nearCentre.length - 15} more`);
  if (nearCentre.length > 0) {
    console.log(
      `\n  These render on the map, in the middle of Khreshchatyk. This is the\n` +
        `  bucket somebody looking at the map would report.`,
    );
  }

  // PLACED ON A LANDMARK, PROVEN RATHER THAN GUESSED AT.
  //
  // The Maidan ring above found nothing, which only ruled out ONE of the
  // 41 landmarks. A pet dropped on Arsenalna or KPI looks perfectly
  // plausible on the map and is just as much a guess — the model picked
  // the nearest name it had, not the address the owner wrote.
  //
  // A distance ring cannot tell those apart from a pet genuinely lost by
  // the KPI gates. But jitterAround is DETERMINISTIC — same landmark,
  // same pet id, same 120m — so the pin can simply be recomputed. If it
  // reproduces to the metre, that pet was placed on that landmark and
  // scattered. There is no false positive to argue about.
  const landmarked = new Map<string, number>();
  let landmarkedTotal = 0;
  for (const pet of pets) {
    for (const lm of LANDMARKS) {
      const j = jitterAround(lm.lat, lm.lng, pet.id, JITTER_M);
      if (Math.abs(j.lat - pet.lat) < 1e-9 && Math.abs(j.lng - pet.lng) < 1e-9) {
        landmarked.set(lm.name, (landmarked.get(lm.name) ?? 0) + 1);
        landmarkedTotal++;
        break;
      }
    }
  }

  console.log(
    `\nPLACED ON A LANDMARK AND SCATTERED — pin reproduces exactly: ${landmarkedTotal} of ${pets.length}`,
  );
  for (const [name, n] of [...landmarked].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${String(n).padStart(4)}  ${name}`);
  }
  if (landmarkedTotal > 0) {
    console.log(
      `\n  These are visible on the map and look like ordinary pins. They are\n` +
        `  the model's nearest guess from a list of ${LANDMARKS.length}, not the address the\n` +
        `  owner wrote — accurate to a district at best.`,
    );
  }

  // WHAT THE GAZETTEER ACTUALLY HOLDS.
  //
  // "Should we improve the gazetteer" is answerable, and the answer is
  // not obvious: every place named in the mismatch list — Софіївська
  // Борщагівка, Васильків, Зазим'я, Бортничі, Виноградар — was matched
  // FROM this table, so it already contains them. A table that already
  // holds the answers is not the thing to expand first.
  const byCategory = new Map<string, number>();
  for (const c of await db
    .select({ category: schema.kyivGazetteer.category })
    .from(schema.kyivGazetteer)) {
    byCategory.set(c.category, (byCategory.get(c.category) ?? 0) + 1);
  }
  console.log('\nWHAT THE GAZETTEER HOLDS:');
  for (const [cat, n] of [...byCategory].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(6)}  ${cat}`);
  }

  // THE COMPARISON PROPER: what the owner wrote vs where we put them.
  let checked = 0;
  let noPlace = 0;
  const far: { name: string; place: string; m: number; marked: boolean }[] = [];

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
    if (m > thresholdM) {
      // «Собачка» is a Kyiv street AND the word for a small dog, and the
      // first run of this matched four pets on it. «Садова», «Перемога»,
      // «Дніпро» are the same trap. A bare name in a lost-pet ad is more
      // likely to be prose than an address.
      //
      // So ask whether the owner MARKED it as a place — вул., проспект,
      // район, масив, село. A marked match is evidence; a bare one is a
      // lead. Kept apart rather than filtered, because throwing away the
      // bare ones would hide real addresses written casually.
      const key = norm(best.name);
      const at = hay.indexOf(key);
      const before = hay.slice(Math.max(0, at - 22), at);
      const marked = MARKERS.test(before);
      far.push({ name: pet.name, place: best.name, m, marked });
    }
  }

  console.log(`\nPETS WHOSE AD NAMES A PLACE: ${checked - noPlace} of ${checked} with text`);
  console.log(`  … no gazetteer place named:  ${noPlace}`);
  const marked = far.filter((f) => f.marked);
  const bare = far.filter((f) => !f.marked);

  console.log(
    `\nPIN MORE THAN ${(thresholdM / 1000).toFixed(1)}km FROM THE PLACE THE AD NAMES: ${far.length}`,
  );
  console.log(`  … the owner marked it as a place (вул/район/село): ${marked.length}  ← evidence`);
  console.log(`  … a bare name, could be prose:                     ${bare.length}  ← leads\n`);

  const show = (rows: typeof far, label: string) => {
    if (rows.length === 0) return;
    console.log(`  ${label}`);
    for (const f of rows.sort((a, b) => b.m - a.m).slice(0, 20)) {
      console.log(
        `    ${f.name.padEnd(26)} ad says «${f.place}»`.padEnd(70) +
          ` ${(f.m / 1000).toFixed(1)}km away`,
      );
    }
    if (rows.length > 20) console.log(`    … and ${rows.length - 20} more`);
    console.log('');
  };
  show(marked, 'MARKED AS A PLACE:');
  show(bare, 'BARE NAME — read before believing:');

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
