// TAKE ONE PET DOWN, NOW.
//
// This app republishes real people's lost-pet posts, and their photos, to
// strangers. Until now there was no way to remove a single one. If an
// owner wrote and asked — because the pet was found, because the post had
// their phone number in it, because they simply changed their mind — the
// only tools were a bulk cleaner with its own rules or a hand-written
// UPDATE against production. Neither is something you want to be
// composing for the first time while somebody is waiting for an answer.
//
// So: one pet, by id, dry run first.
//
// STATUS = 'expired', NEVER A DELETE. Sightings cascade from lost_dogs,
// and every one of them is a real person who walked a real street and
// wrote down what they saw. Expiring hides the pet from every query the
// app makes — /dogs/nearby, /sync/map, the carousel, supersniff — and is
// one UPDATE away from reversible if the request turns out to be somebody
// else's. Deleting is not.
//
// THE PHOTO IS THE ONE IRREVERSIBLE PART, and it is opt-in. `--photo`
// nulls photo_url as well, for the case where the objection is to the
// image itself. The URL is not recoverable afterwards — it came from a
// scrape and we do not keep a copy — so it is a separate flag and the dry
// run says so plainly.
//
// The dry run prints who the pet is, where it is, how many sightings hang
// off it, and where it came from. That last one matters: a takedown
// request should be checkable against the source post before anything is
// written.
//
// Usage:
//   pnpm --filter @shukajpes/server expire:pet -- --id=<id>
//   pnpm --filter @shukajpes/server expire:pet -- --id=<id> --apply
//   pnpm --filter @shukajpes/server expire:pet -- --id=<id> --apply --photo
//   pnpm --filter @shukajpes/server expire:pet -- --id=<id> --apply --restore
//
//   production:
//     fly ssh console -a shukajpes-api -C "node dist/db/expire-pet.js --id=<id>"
//     fly ssh console -a shukajpes-api -C "node dist/db/expire-pet.js --id=<id> --apply"

import 'dotenv/config';
import { eq, sql } from 'drizzle-orm';
import { pathToFileURL } from 'url';
import { db, schema, pg } from './index.js';

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

async function main() {
  const id = arg('id');
  const apply = process.argv.includes('--apply');
  const alsoPhoto = process.argv.includes('--photo');
  // The undo. Same script on purpose: the person reaching for it is
  // usually the person who just ran the takedown and wants it back, and
  // making them find a different tool at that moment is unkind.
  const restore = process.argv.includes('--restore');

  if (!id) {
    console.error('usage: expire:pet --id=<lost_dogs.id> [--apply] [--photo] [--restore]');
    process.exit(1);
  }
  if (restore && alsoPhoto) {
    // Saying no rather than half-doing it: the URL is gone, and a
    // "restore" that silently leaves the pet photoless would be a lie.
    console.error('--restore cannot bring a photo back; the URL was not kept. Drop --photo.');
    process.exit(1);
  }

  const [pet] = await db
    .select({
      id: schema.lostDogs.id,
      name: schema.lostDogs.name,
      species: schema.lostDogs.species,
      status: schema.lostDogs.status,
      lat: schema.lostDogs.lastSeenLat,
      lng: schema.lostDogs.lastSeenLng,
      photoUrl: schema.lostDogs.photoUrl,
      source: schema.lostDogs.source,
      createdAt: schema.lostDogs.createdAt,
    })
    .from(schema.lostDogs)
    .where(eq(schema.lostDogs.id, id))
    .limit(1);

  if (!pet) {
    // Loud, and a non-zero exit. A takedown that quietly matched nothing
    // is the worst outcome here — somebody would report it as done.
    console.error(`✗ no pet with id "${id}". Nothing was changed.`);
    process.exit(1);
  }

  // Context a human needs before authorising this, in one place.
  const [counts] = await db
    .select({
      sightings: sql<number>`(select count(*)::int from ${schema.sightings} where ${schema.sightings.dogId} = ${id})`,
      searches: sql<number>`(select count(*)::int from ${schema.searchResults} where ${schema.searchResults.dogId} = ${id})`,
    })
    .from(schema.lostDogs)
    .where(eq(schema.lostDogs.id, id))
    .limit(1);

  const [src] = await db
    .select({ url: schema.scrapeLog.url, title: schema.scrapeLog.title })
    .from(schema.scrapeLog)
    .where(eq(schema.scrapeLog.dogId, id))
    .limit(1);

  console.log(apply ? '▶ APPLY — writes are real' : '▶ dry run — pass --apply to write');
  console.log('');
  console.log(`  id        ${pet.id}`);
  console.log(`  name      ${pet.name} (${pet.species})`);
  console.log(`  status    ${pet.status}`);
  console.log(`  position  ${pet.lat}, ${pet.lng}`);
  console.log(`  photo     ${pet.photoUrl ?? '(none)'}`);
  console.log(`  source    ${pet.source ?? '(in-app report)'}`);
  console.log(`  posted    ${src?.url ?? '(no permalink)'}`);
  if (src?.title) console.log(`  title     ${src.title.slice(0, 120)}`);
  console.log(`  sightings ${counts?.sightings ?? 0} (kept — they are other people's reports)`);
  console.log(`  searches  ${counts?.searches ?? 0} (kept)`);
  console.log('');

  const target = restore ? 'active' : 'expired';
  if (pet.status === target && !alsoPhoto) {
    console.log(`nothing to do — already ${target}.`);
    await pg.end();
    return;
  }

  console.log(`  would set status: ${pet.status} → ${target}`);
  if (alsoPhoto) {
    console.log('  would set photo_url → null  ** NOT REVERSIBLE — the URL is not kept **');
  }
  console.log('');

  if (!apply) {
    console.log('dry run only. Re-run with --apply once a human has read the above.');
    await pg.end();
    return;
  }

  await db
    .update(schema.lostDogs)
    .set({
      status: target,
      ...(alsoPhoto ? { photoUrl: null } : {}),
    })
    .where(eq(schema.lostDogs.id, id));

  console.log(`✓ ${restore ? 'restored' : 'expired'} ${pet.name} (${id})`);
  if (alsoPhoto) console.log('✓ photo url cleared');
  if (!restore) {
    console.log('');
    console.log(`undo:  expire:pet --id=${id} --apply --restore`);
  }
  await pg.end();
}

const isEntry = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isEntry) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
