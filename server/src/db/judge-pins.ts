// ASK THE JUDGE ABOUT THE PETS ALREADY IN THE TABLE.
//
// pipeline/placementJudge.ts runs at ingest, so it only ever sees what
// arrives next. The rows already here were placed before it existed:
// measured, 44 active pets carry a bare or fuzzy label, and the bar
// hides every one of them because nothing vouches for the match.
//
// This asks about each of them. It NEVER MOVES A PET — the coordinate
// the resolver chose stays exactly where it is, and only the label
// changes, from «not judged» to «judged and kept» or «judged and
// refused». What that changes is visibility, which is the whole point:
// a kept row starts being shown, a refused one stays hidden and now says
// why.
//
// Dry by default, and the dry run prints the model's own one-line reason
// for every verdict, because a human should be able to read WHY a pet is
// about to be shown or hidden before it happens. The measured run over
// production rejected 10 of 44, including «Борік», whose «Вул. Ракетна»
// came from «ракетної атаки».
//
// Costs money — one model call per pet. The measured run was $0.19 for
// 44. --limit exists so a first pass can be smaller than the whole table.
//
// Usage:
//   fly ssh console -a shukajpes-api -C "node dist/db/judge-pins.js"
//   fly ssh console -a shukajpes-api -C "node dist/db/judge-pins.js --apply"
//   fly ssh console -a shukajpes-api -C "node dist/db/judge-pins.js --limit=10"

import 'dotenv/config';
import { and, eq, isNotNull, or, like } from 'drizzle-orm';
import { pathToFileURL } from 'url';
import { db, schema, pg } from './index.js';
import {
  judgePlacement,
  placeNameOf,
  JUDGE_MODEL,
  JUDGED_PREFIX,
  REJECTED_PREFIX,
} from '../pipeline/placementJudge.js';
import { redactContacts } from '../pipeline/redactContacts.js';

async function main() {
  const apply = process.argv.includes('--apply');
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : Infinity;

  const pets = await db
    .select({
      id: schema.lostDogs.id,
      name: schema.lostDogs.name,
      lat: schema.lostDogs.lastSeenLat,
      lng: schema.lostDogs.lastSeenLng,
      descr: schema.lostDogs.lastSeenDescription,
      placementSource: schema.lostDogs.placementSource,
    })
    .from(schema.lostDogs)
    .where(
      and(
        eq(schema.lostDogs.status, 'active'),
        eq(schema.lostDogs.isFoundReport, false),
        or(
          like(schema.lostDogs.placementSource, 'gazetteer-bare:%'),
          like(schema.lostDogs.placementSource, 'gazetteer-fuzzy:%'),
        ),
      ),
    );

  // A READ THAT RETURNED NOTHING IS NOT A CLEAN TABLE.
  if (pets.length === 0) {
    console.log('\n!! NO BARE OR FUZZY PLACEMENTS FOUND — either they have all been');
    console.log('   judged already, or this read found nothing. Check the ledger');
    console.log("   before reading that as 'nothing left to do'.");
    await pg.end();
    return;
  }

  const bodies = new Map<string, string>();
  for (const r of await db
    .select({
      dogId: schema.scrapeLog.dogId,
      title: schema.scrapeLog.title,
      body: schema.scrapeLog.rawBody,
    })
    .from(schema.scrapeLog)
    .where(isNotNull(schema.scrapeLog.dogId))) {
    if (r.dogId && !bodies.has(r.dogId)) {
      bodies.set(r.dogId, [r.title, r.body].filter(Boolean).join('\n'));
    }
  }

  const todo = pets.slice(0, limit);
  console.log(
    `\n${apply ? '▶ APPLY — labels will be written' : '▶ dry run — pass --apply to write'}`,
  );
  console.log(`asking ${JUDGE_MODEL} about ${todo.length} of ${pets.length} unjudged placements.\n`);

  const kept: typeof todo = [];
  const rejected: typeof todo = [];
  const unanswered: typeof todo = [];
  const reasons = new Map<string, string>();

  for (const pet of todo) {
    const place = placeNameOf(pet.placementSource!);
    const adText = `${bodies.get(pet.id) ?? ''}\n${pet.descr ?? ''}`;
    const verdict = await judgePlacement({
      adText,
      placeName: place,
      lat: pet.lat,
      lng: pet.lng,
    });
    if (!verdict) {
      unanswered.push(pet);
      continue;
    }
    // The model quotes the ad back in its reason, so it goes through the
    // same redaction as every other place this codebase prints ad text.
    reasons.set(pet.id, redactContacts(verdict.reason));
    (verdict.keep ? kept : rejected).push(pet);
  }

  const show = (items: typeof todo, heading: string) => {
    console.log(`\n${heading} — ${items.length}:`);
    for (const p of items) {
      const place = placeNameOf(p.placementSource!);
      console.log(
        `    ${(p.name ?? '?').slice(0, 20).padEnd(21)}→ ${place.slice(0, 24).padEnd(25)} ${(reasons.get(p.id) ?? '').slice(0, 78)}`,
      );
    }
  };

  show(kept, 'KEPT — the ad supports the pin, and these become visible');
  show(rejected, 'REFUSED — the ad does not support the pin; these stay hidden');

  if (unanswered.length > 0) {
    console.log(`\n!! NO ANSWER for ${unanswered.length} — these were NOT judged and are`);
    console.log('   left exactly as they were. A judge that could not be asked is');
    console.log('   not a judge that said keep.');
    for (const p of unanswered) console.log(`    ${p.name}`);
  }

  if (!apply) {
    console.log('\n✓ dry run, nothing written.');
    console.log(`  --apply would relabel ${kept.length + rejected.length} row(s). No coordinate moves.`);
    await pg.end();
    return;
  }

  for (const p of kept) {
    await db
      .update(schema.lostDogs)
      .set({ placementSource: `${JUDGED_PREFIX}${placeNameOf(p.placementSource!)}` })
      .where(eq(schema.lostDogs.id, p.id));
  }
  for (const p of rejected) {
    await db
      .update(schema.lostDogs)
      .set({ placementSource: `${REJECTED_PREFIX}${placeNameOf(p.placementSource!)}` })
      .where(eq(schema.lostDogs.id, p.id));
  }
  console.log(`\n✓ applied: ${kept.length} shown, ${rejected.length} kept hidden. No coordinate moved.`);
  console.log('  Reversal, per pet:');
  for (const p of [...kept, ...rejected]) {
    console.log(
      `    UPDATE lost_dogs SET placement_source = '${p.placementSource!.replace(/'/g, "''")}' WHERE id = '${p.id}';`,
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
