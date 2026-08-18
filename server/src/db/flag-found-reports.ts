// MARK THE PETS THAT ARE FOUND STRAYS, NOT SEARCHES.
//
// Migration 0035 adds `is_found_report` defaulting to false, which leaves
// every existing row saying "this is a search". For the ones that are
// actually «песик (знайдений)» — somebody has the animal and wants its
// owner — that is wrong, and it is wrong in a way the walker sees: the
// app asks them to comb the streets for a dog already indoors.
//
// This is the pass that fixes those rows, and it is SEPARATE from the
// migration on purpose. Migrations run automatically on every deploy
// (Dockerfile CMD), so a migration that decided which pets vanish from
// somebody's map would be a write nobody read a dry run of. This is that
// dry run.
//
// The judgement comes from the stored LISTING TITLE, via exactly the same
// looksLikeFoundReport() the ingest now uses — one rule, so a row flagged
// here and a row flagged at ingest can never disagree.
//
// Reversible in the obvious way: UPDATE lost_dogs SET is_found_report =
// false. Nothing is deleted and no pet is expired; they simply stop
// appearing under «загублені».
//
// Usage:
//   fly ssh console -a shukajpes-api -C "node dist/db/flag-found-reports.js"
//   fly ssh console -a shukajpes-api -C "node dist/db/flag-found-reports.js --apply"

import 'dotenv/config';
import { eq, sql } from 'drizzle-orm';
import { pathToFileURL } from 'url';
import { db, schema, pg } from './index.js';
import { looksLikeFoundReport } from '../pipeline/keywords.js';
import { redactContacts } from '../pipeline/redactContacts.js';

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(apply ? '▶ APPLY — writes are real' : '▶ dry run — pass --apply to write');

  const pets = await db
    .select({
      id: schema.lostDogs.id,
      name: schema.lostDogs.name,
      already: schema.lostDogs.isFoundReport,
    })
    .from(schema.lostDogs)
    .where(eq(schema.lostDogs.status, 'active'));

  if (pets.length === 0) {
    console.log('\n!! NO ACTIVE PETS. This read nothing — check which database.');
    await pg.end();
    return;
  }

  // Titles from the ledger. Earliest row wins: it is the ad the pet was
  // first ingested from, and a later repost's title can describe the same
  // animal differently.
  const logs = await db
    .select({
      dogId: schema.scrapeLog.dogId,
      title: schema.scrapeLog.title,
      at: schema.scrapeLog.firstSeenAt,
    })
    .from(schema.scrapeLog)
    .orderBy(schema.scrapeLog.firstSeenAt);
  const titleByDog = new Map<string, string>();
  for (const l of logs) {
    if (l.dogId && l.title && !titleByDog.has(l.dogId)) titleByDog.set(l.dogId, l.title);
  }

  const withTitle = pets.filter((p) => titleByDog.has(p.id));
  if (withTitle.length === 0) {
    // A check that read nothing must never be reported as a check that
    // found nothing.
    console.log('\n!! NOT ONE active pet has a stored listing title. This scan read');
    console.log('   nothing, so "0 to flag" would mean nothing at all.');
    await pg.end();
    return;
  }

  const flagged = withTitle.filter(
    (p) => !p.already && looksLikeFoundReport(titleByDog.get(p.id)!),
  );
  const alreadyFlagged = pets.filter((p) => p.already).length;

  console.log(`\nactive pets:              ${pets.length}`);
  console.log(`  … with a stored title:  ${withTitle.length}`);
  console.log(`  … already flagged:      ${alreadyFlagged}`);
  console.log(`\nWILL FLAG AS FOUND REPORTS: ${flagged.length}`);
  for (const p of flagged) {
    // Titles are listing titles, but they are still somebody's text.
    console.log(`  ${p.name.padEnd(24)} ${redactContacts(titleByDog.get(p.id)!).slice(0, 64)}`);
  }

  console.log(
    `\n  These stop appearing under «загублені». They are NOT expired and NOT\n` +
      `  deleted — the rows stay, ready for a screen of their own, and one\n` +
      `  UPDATE puts any of them back.`,
  );

  if (!apply) {
    console.log('\n✓ dry run, nothing written.');
    console.log(`  --apply would set is_found_report = true on ${flagged.length} row(s).`);
    await pg.end();
    return;
  }

  for (const p of flagged) {
    await db
      .update(schema.lostDogs)
      .set({ isFoundReport: true })
      .where(eq(schema.lostDogs.id, p.id));
  }

  console.log(`\n  ${flagged.length} flagged as found reports`);
  console.log('  reversible: UPDATE lost_dogs SET is_found_report = false WHERE id IN (…)');
  console.log(
    `\n  ${pets.length - alreadyFlagged - flagged.length} active pet(s) remain as searches.`,
  );
  console.log('\n✓ done.');
  await pg.end();
}

const isEntry = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isEntry) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
