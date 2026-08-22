// PLACE THE PETS NOBODY CAN SEE, from the ad text already stored.
//
// 80 of 176 active pets sat on the fall-through coordinate, filtered
// out of every map query. 69 more reproduce exactly as a jittered
// landmark — the model's nearest guess rather than an address. The
// ingest path now resolves places against kyiv_gazetteer at parse time
// (pipeline/parser.ts); this CLI is the backfill for the rows placed
// before that shipped.
//
// DRY BY DEFAULT. Run without flags and nothing is written: it prints,
// for a human to read, exactly which pets would move and where —
// including the resolved place, its category, and whether the ad marked
// it as an address («вул. …») or only named it bare. `--apply` performs
// exactly the moves the dry run printed, and nothing else.
//
// WHAT --apply WILL NOT TOUCH. Only pets on the exact fall-through
// coordinate move — they are invisible today, so the worst outcome of a
// wrong resolution is a visible pet in the wrong place instead of an
// invisible pet nowhere, and every move is reversible with one UPDATE
// back to the constant. Landmark-guessed pets are measured below but
// never moved: they are already visible, their current pin is somebody's
// best guess, and moving them is a separate decision for a person.
//
// Usage:
//   fly ssh console -a shukajpes-api -C "node dist/db/resolve-pins.js"
//   fly ssh console -a shukajpes-api -C "node dist/db/resolve-pins.js --apply"

import 'dotenv/config';
import { eq, isNotNull } from 'drizzle-orm';
import { pathToFileURL } from 'url';
import { db, schema, pg } from './index.js';
import { resolvePlace, type GazetteerPlace, type ResolvedPlace } from '../pipeline/resolvePlace.js';
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

function placementLabel(hit: ResolvedPlace): string {
  return `${hit.marked ? 'gazetteer-marked' : 'gazetteer-bare'}:${hit.name}`;
}

async function main() {
  const apply = process.argv.includes('--apply');

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
      // The alternate-spelling column that has been sitting unread while
      // twelve Russian-spelled Kyiv places were reported as missing.
      aliases: schema.kyivGazetteer.aliases,
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

  const hidden = pets.filter(isFallback);
  const landmark = pets.filter((p) => !isFallback(p) && landmarkOf(p));

  // ---- THE INVISIBLE PETS: every candidate move, printed in full ----
  //
  // No sampling here. This list is what a person reads before --apply,
  // so it has to be the whole list.
  console.log(`\nTHE ${hidden.length} INVISIBLE PETS — every move ${apply ? 'being applied' : 'the apply would make'}:\n`);

  const moves: { id: string; name: string; hit: ResolvedPlace }[] = [];
  let none = 0;
  let noText = 0;
  for (const pet of hidden) {
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
    moves.push({ id: pet.id, name: pet.name, hit });
    console.log(
      `    ${pet.name.padEnd(24)} → «${hit.name}» (${hit.category}${hit.marked ? ', marked' : ', bare'})`,
    );
  }

  const marked = moves.filter((m) => m.hit.marked).length;
  console.log(`\n  would move:               ${moves.length} of ${hidden.length}`);
  console.log(`    … from a marked address: ${marked}   ← high confidence`);
  console.log(`    … from a bare name:      ${moves.length - marked}   ← read the list above`);
  console.log(`  no place named in the ad: ${none}`);
  console.log(`  no ad text stored:        ${noText}`);

  // ---- THE LANDMARK-GUESSED PETS: measured, never moved ----
  console.log(`\nTHE ${landmark.length} LANDMARK-GUESSED PETS — measured only, never moved by this CLI:\n`);
  let lmPlaced = 0;
  const lmSample: string[] = [];
  for (const pet of landmark) {
    const text = `${pet.desc ?? ''}\n${bodies.get(pet.id) ?? ''}`.trim();
    if (!text) continue;
    const hit = resolvePlace(text, places);
    if (!hit) continue;
    lmPlaced++;
    if (lmSample.length < 12) {
      const moved = haversineM(pet.lat, pet.lng, hit.lat, hit.lng);
      lmSample.push(
        `    ${pet.name.padEnd(24)} → «${hit.name}»${hit.marked ? ' [marked]' : ''}  would move ${(moved / 1000).toFixed(1)}km`,
      );
    }
  }
  console.log(`  the resolver finds a place for ${lmPlaced} of ${landmark.length}`);
  for (const s of lmSample) console.log(s);

  if (!apply) {
    console.log(
      `\n  A pet "moving" means the ad names a place we hold coordinates for.` +
        `\n  It does not mean those coordinates are right — read the list.` +
        `\n  Every move is reversible: the previous coordinate of every pet` +
        `\n  above is exactly the fall-through (${FALLBACK.lat}, ${FALLBACK.lng}).` +
        `\n\n✓ dry run. Nothing written, no requests made. Re-run with --apply to move them.`,
    );
    await pg.end();
    return;
  }

  // ---- APPLY: exactly the moves printed above ----
  let applied = 0;
  for (const m of moves) {
    // Same spread-the-centroid jitter ingest uses, seeded by the pet id
    // so a re-run keeps every pet at the same point.
    const pin = jitterAround(m.hit.lat, m.hit.lng, m.id, JITTER_M);
    await db
      .update(schema.lostDogs)
      .set({
        lastSeenLat: pin.lat,
        lastSeenLng: pin.lng,
        placementSource: placementLabel(m.hit),
      })
      .where(eq(schema.lostDogs.id, m.id));
    applied++;
  }
  console.log(
    `\n✓ applied: ${applied} pets moved off the fall-through and onto the map.` +
      `\n  Reversal, should any move read wrong tomorrow:` +
      `\n    UPDATE lost_dogs SET last_seen_lat = ${FALLBACK.lat}, last_seen_lng = ${FALLBACK.lng},` +
      `\n      placement_source = 'fall-through' WHERE id = '<id>';`,
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
