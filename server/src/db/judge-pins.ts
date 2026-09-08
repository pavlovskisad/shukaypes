// ASK THE JUDGE ABOUT THE PETS ALREADY IN THE TABLE.
//
// pipeline/placementJudge.ts runs at ingest, so it only ever sees what
// arrives next. The rows already here were placed before it existed:
// measured, 44 active pets carried a bare or fuzzy label, and the bar
// hid every one of them because nothing vouched for the match.
//
// This asks about each of them. It NEVER MOVES A PET — the coordinate
// the resolver chose stays exactly where it is, and only the label
// changes, from «not judged» to «judged and kept» or «judged and
// refused». What that changes is visibility, which is the point: a kept
// row starts being shown, a refused one stays hidden and now says why.
//
// TWO PHASES, AND THE SECOND ONE NEVER ASKS THE MODEL.
//
// The first version judged again inside --apply, and the counts moved
// between the two runs: the dry run a human read said 32 kept and 12
// refused, the apply wrote 33 and 11. «Муха» flipped. The model is not
// perfectly deterministic, and "the dry run gets read before the apply"
// means nothing if the apply then writes something else.
//
// So the dry run WRITES A PLAN — every verdict, with the label it was
// judged against — and --apply reads that file and does exactly what it
// says. No model calls, no cost, no drift. A row whose label changed
// since the plan was written is skipped and named, because the verdict
// in hand was about a placement that no longer exists.
//
// Dry by default, printing the model's own one-line reason for every
// verdict, because a human should be able to read WHY a pet is about to
// be shown or hidden before it happens.
//
// Costs money in the DRY phase only — one model call per pet, measured
// at $0.19 for 44. --limit exists so a first pass can be smaller.
//
// Usage:
//   fly ssh console -a shukajpes-api -C "node dist/db/judge-pins.js"
//   fly ssh console -a shukajpes-api -C "node dist/db/judge-pins.js --apply"
//   fly ssh console -a shukajpes-api -C "node dist/db/judge-pins.js --limit=10"

import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
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

// Where the dry run leaves its plan for --apply to pick up. /tmp is
// right: a plan is only meaningful for as long as the labels it was
// judged against are current, and a machine restart is a good reason to
// look again.
const DEFAULT_PLAN_PATH = '/tmp/judge-pins-plan.json';

interface PlanEntry {
  id: string;
  name: string;
  /** The label at the moment of judging — apply refuses if it moved. */
  judgedAgainst: string;
  keep: boolean;
  reason: string;
}

interface Plan {
  model: string;
  writtenAt: string;
  entries: PlanEntry[];
}

function planPathFrom(argv: string[]): string {
  const arg = argv.find((a) => a.startsWith('--plan='));
  return arg ? arg.slice('--plan='.length) : DEFAULT_PLAN_PATH;
}

async function runApply(planPath: string): Promise<void> {
  if (!existsSync(planPath)) {
    console.log(`\n!! NO PLAN AT ${planPath}`);
    console.log('   --apply writes what a dry run decided, and there is no dry run to');
    console.log('   read. Run this without --apply first, read the verdicts, then');
    console.log('   apply. Nothing was written.');
    return;
  }
  const plan = JSON.parse(readFileSync(planPath, 'utf8')) as Plan;
  console.log(`\n▶ APPLY — executing the plan from ${planPath}`);
  console.log(`  judged by ${plan.model} at ${plan.writtenAt}, ${plan.entries.length} verdict(s).`);
  console.log('  No model is called in this phase.\n');

  const current = new Map<string, string | null>();
  for (const row of await db
    .select({ id: schema.lostDogs.id, placementSource: schema.lostDogs.placementSource })
    .from(schema.lostDogs)) {
    current.set(row.id, row.placementSource);
  }

  let shown = 0;
  let hidden = 0;
  const stale: PlanEntry[] = [];
  const reversals: string[] = [];

  for (const e of plan.entries) {
    // THE VERDICT WAS ABOUT A PARTICULAR PLACEMENT. If the row has been
    // relabelled since — by a re-ingest, by another CLI, by a person —
    // the answer in hand is about something that is no longer there.
    if (current.get(e.id) !== e.judgedAgainst) {
      stale.push(e);
      continue;
    }
    const next = `${e.keep ? JUDGED_PREFIX : REJECTED_PREFIX}${placeNameOf(e.judgedAgainst)}`;
    await db
      .update(schema.lostDogs)
      .set({ placementSource: next })
      .where(eq(schema.lostDogs.id, e.id));
    if (e.keep) shown++;
    else hidden++;
    reversals.push(
      `    UPDATE lost_dogs SET placement_source = '${e.judgedAgainst.replace(/'/g, "''")}' WHERE id = '${e.id}';`,
    );
  }

  console.log(`✓ applied: ${shown} shown, ${hidden} kept hidden. No coordinate moved.`);
  if (stale.length > 0) {
    console.log(`\n!! SKIPPED ${stale.length} — the label moved since the plan was written,`);
    console.log('   so the verdict in hand was about a placement that no longer exists.');
    console.log('   Re-run the dry run to judge these again.');
    for (const e of stale) {
      console.log(`    ${e.name}  plan: «${e.judgedAgainst}»  now: «${current.get(e.id) ?? 'null'}»`);
    }
  }
  console.log('\n  Reversal, per pet:');
  for (const line of reversals) console.log(line);
}

async function runDryRun(planPath: string, limit: number): Promise<void> {
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
  console.log('\n▶ dry run — nothing is written to lost_dogs');
  console.log(`asking ${JUDGE_MODEL} about ${todo.length} of ${pets.length} unjudged placements.\n`);

  const entries: PlanEntry[] = [];
  const unanswered: { name: string }[] = [];

  for (const pet of todo) {
    const judgedAgainst = pet.placementSource!;
    const verdict = await judgePlacement({
      adText: `${bodies.get(pet.id) ?? ''}\n${pet.descr ?? ''}`,
      placeName: placeNameOf(judgedAgainst),
      lat: pet.lat,
      lng: pet.lng,
    });
    if (!verdict) {
      unanswered.push({ name: pet.name });
      continue;
    }
    entries.push({
      id: pet.id,
      name: pet.name,
      judgedAgainst,
      keep: verdict.keep,
      // The model quotes the ad back in its reason, so it goes through
      // the same redaction as every other place this codebase prints ad
      // text.
      reason: redactContacts(verdict.reason),
    });
  }

  const show = (items: PlanEntry[], heading: string) => {
    console.log(`\n${heading} — ${items.length}:`);
    for (const e of items) {
      console.log(
        `    ${(e.name ?? '?').slice(0, 20).padEnd(21)}→ ${placeNameOf(e.judgedAgainst).slice(0, 24).padEnd(25)} ${e.reason.slice(0, 78)}`,
      );
    }
  };
  show(entries.filter((e) => e.keep), 'KEPT — the ad supports the pin, and these become visible');
  show(entries.filter((e) => !e.keep), 'REFUSED — the ad does not support the pin; these stay hidden');

  if (unanswered.length > 0) {
    console.log(`\n!! NO ANSWER for ${unanswered.length} — these were NOT judged, are left`);
    console.log('   exactly as they were, and are absent from the plan. A judge that');
    console.log('   could not be asked is not a judge that said keep.');
    for (const p of unanswered) console.log(`    ${p.name}`);
  }

  const plan: Plan = {
    model: JUDGE_MODEL,
    writtenAt: new Date().toISOString(),
    entries,
  };
  writeFileSync(planPath, JSON.stringify(plan, null, 2));

  console.log(`\n✓ dry run, nothing written to lost_dogs.`);
  console.log(`  Plan saved to ${planPath} — ${entries.length} verdict(s).`);
  console.log('  --apply will write EXACTLY these, without asking the model again.');
}

async function main() {
  const apply = process.argv.includes('--apply');
  const planPath = planPathFrom(process.argv);
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : Infinity;

  if (apply) await runApply(planPath);
  else await runDryRun(planPath, limit);

  await pg.end();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
