// CORRECT THE CONFIDENCE LABEL WHERE THE RESOLVER WAS WRONG ABOUT IT,
// moving nothing.
//
// placement_source records how a pin was decided, and rows carry the
// answer the resolver gave on the day they were written. When the
// resolver learns something, the old rows keep the old verdict — which
// would be a footnote, except the map now filters on that column
// (placementConfidence.ts). A pet whose label says «bare» stays hidden
// even once the resolver would call its address properly marked.
//
// The fix that prompted this: a gazetteer entry named «Вулиця Літня»
// swallowed the ad's own «вул.», leaving no marker in front of the match,
// so «Буся» — whose ad reads «приватний сектор,вул.Літня» — was recorded
// as a guess. Nine active pets are in that position.
//
// WHAT THIS WILL AND WILL NOT DO. It re-runs the resolver over each
// pet's ad and re-stamps the label ONLY when the resolver names the same
// place it named before. That keeps the label a true description of the
// coordinate: same street, corrected confidence.
//
// When the resolver now prefers a DIFFERENT place, the coordinate is
// where the old answer put it, and re-stamping would make the column
// lie — so those are printed under their own heading and left alone.
// Moving a pet is resolve-pins' job, with its own dry run.
//
// Coordinates are NEVER touched here. Active rows only.
//
// Dry by default; --apply writes the labels printed.
//
// Usage:
//   fly ssh console -a shukajpes-api -C "node dist/db/relabel-marked.js"
//   fly ssh console -a shukajpes-api -C "node dist/db/relabel-marked.js --apply"

import 'dotenv/config';
import { and, eq, isNotNull, like } from 'drizzle-orm';
import { pathToFileURL } from 'url';
import { db, schema, pg } from './index.js';
import { resolvePlace, type GazetteerPlace } from '../pipeline/resolvePlace.js';

/** The place name a `gazetteer-<tier>:<name>` label carries. */
function labelledPlace(source: string): string {
  return source.replace(/^gazetteer-(marked|bare|fuzzy):/, '');
}

async function main() {
  const apply = process.argv.includes('--apply');

  const pets = await db
    .select({
      id: schema.lostDogs.id,
      name: schema.lostDogs.name,
      descr: schema.lostDogs.lastSeenDescription,
      placementSource: schema.lostDogs.placementSource,
    })
    .from(schema.lostDogs)
    .where(
      and(
        eq(schema.lostDogs.status, 'active'),
        isNotNull(schema.lostDogs.placementSource),
        like(schema.lostDogs.placementSource, 'gazetteer-%'),
      ),
    );

  const places: GazetteerPlace[] = await db
    .select({
      name: schema.kyivGazetteer.nameUk,
      lat: schema.kyivGazetteer.lat,
      lng: schema.kyivGazetteer.lng,
      category: schema.kyivGazetteer.category,
      aliases: schema.kyivGazetteer.aliases,
    })
    .from(schema.kyivGazetteer);

  // A READ THAT RETURNED NOTHING IS NOT A RESULT.
  //
  // An empty gazetteer would make every pet look like "the resolver
  // finds nothing now", and --apply would then quietly do nothing while
  // reporting success. Say which it is.
  if (places.length === 0) {
    console.log('\n!! READ NOTHING — the gazetteer came back empty. Confirm which');
    console.log('   database this is pointed at before reading anything below.');
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

  const promote: { id: string; name: string; from: string; to: string }[] = [];
  const movedOn: string[] = [];
  const unchanged: string[] = [];

  for (const pet of pets) {
    const source = pet.placementSource!;
    const was = labelledPlace(source);
    // Same concatenation the ingest path and resolve-pins use — a
    // different one measured a different population and produced a
    // regression that did not exist.
    const text = `${pet.descr ?? ''}\n${bodies.get(pet.id) ?? ''}`;
    const now = resolvePlace(text, places);

    if (!now || now.name !== was) {
      movedOn.push(
        `${pet.name.padEnd(24)} «${was}» → ${now ? `«${now.name}»` : 'no place named'}`,
      );
      continue;
    }
    const next = `gazetteer-${now.marked ? 'marked' : 'bare'}:${now.name}`;
    if (next === source) {
      unchanged.push(pet.name);
      continue;
    }
    promote.push({ id: pet.id, name: pet.name, from: source, to: next });
  }

  console.log(`\nRE-READING ${pets.length} GAZETTEER-PLACED PETS with the current resolver.\n`);

  console.log(`SAME PLACE, LABEL CHANGES — ${promote.length}:`);
  for (const p of promote) {
    const dir = p.to.startsWith('gazetteer-marked:') ? '↑ marked' : '↓ bare  ';
    console.log(`    ${dir}  ${p.name.padEnd(24)} «${labelledPlace(p.to)}»`);
  }

  console.log(`\n  same place, same label:            ${unchanged.length}`);
  console.log(`  resolver now prefers elsewhere:    ${movedOn.length}   ← NOT relabelled`);
  for (const m of movedOn) console.log(`      ${m}`);
  console.log(
    '\n  Those keep the label describing the coordinate they actually sit on.',
  );
  console.log('  Moving one is resolve-pins\' job, and has its own dry run.');

  if (!apply) {
    console.log('\n✓ dry run. Nothing written. Re-run with --apply to stamp the labels above.');
    await pg.end();
    return;
  }

  for (const p of promote) {
    await db
      .update(schema.lostDogs)
      .set({ placementSource: p.to })
      .where(eq(schema.lostDogs.id, p.id));
  }
  console.log(`\n✓ applied: ${promote.length} labels corrected. No coordinate was touched.`);
  console.log('  Reversal, per pet:');
  for (const p of promote) {
    console.log(
      `    UPDATE lost_dogs SET placement_source = '${p.from.replace(/'/g, "''")}' WHERE id = '${p.id}';`,
    );
  }
  await pg.end();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
