// MAKE ADS FETCHABLE AGAIN, so the base can be refreshed in place.
//
// `olx.ts` skips any URL already present in `scrape_log` (seenUrls). That
// is what stops the scraper re-reading the same ad every hour, and it is
// also what freezes the base: a pet ingested before `raw_body` existed
// never gains a body, however many ticks run, because its ad is never
// fetched again. Deleting the ledger row un-freezes exactly that ad.
//
// THE DEFAULT IS ROWS ATTACHED TO AN ACTIVE PET, and production is what
// taught me that. The first version of this script cleared every
// body-less row, which read as "the narrow scope" until the numbers came
// back:
//
//     WILL CLEAR: 12067 row(s)
//       … pointing at an active pet:        226
//       … pointing at no pet (skipped ad): 11780
//
// Those 11,780 are ads the pipeline already looked at and rejected —
// rehoming posts, wrong city, titles that are not a lost pet. Re-opening
// one does not produce a pet; it produces the same rejection again. And
// most of them are decided from the LISTING TITLE, before `fetchText` is
// ever called (olx.ts:214), so re-opening them is not even a re-fetch —
// it is the same verdict recomputed, thousands of times, for nothing.
//
// 226 is the number that matters: pets on the map today whose ad text we
// do not hold. That is the refresh.
//
// Rows that already carry their text are never cleared under any scope —
// clearing one trades text we hold for a request that may come back 404
// if the owner has since taken the listing down.
//
//   (default)      body-less rows attached to an ACTIVE pet
//   --orphans      also rows attached to no pet (the rejected ads)
//   --all          also rows that already have a body (full re-derive:
//                  pins, photos and parse from scratch)
//
// The two wider scopes exist for a deliberate full refresh and should be
// typed on purpose, never inherited from a default.
//
// WHAT HAPPENS NEXT, and why nothing goes missing in between: the next
// ingest ticks re-fetch those ads and write bodies. A pet whose ad is
// still live gains its body and KEEPS ITS ROW — upsert dedupes it to the
// existing pet and the log row is written with that same id, so no
// duplicate appears and nothing is renumbered. A pet whose ad is gone
// simply never comes back, and `expire:no-post` is the pass that clears
// those out afterwards. The map stays populated throughout.
//
// This DELETES ledger rows, which is not the reversible form — but a
// scrape_log row is re-derivable by fetching the ad again, and it holds
// no user data. `lost_dogs` and `sightings` are untouched: the FK from
// scrape_log is ON DELETE SET NULL in the other direction, so no pet and
// no sighting can be reached from here.
//
// Dry run by default. Nothing is written without --apply.
//
// Usage:
//   local:       pnpm --filter @shukajpes/server reopen:ads
//                pnpm --filter @shukajpes/server reopen:ads --apply
//   production:  fly ssh console -a shukajpes-api -C "node dist/db/reopen-ads.js"
//                fly ssh console -a shukajpes-api -C "node dist/db/reopen-ads.js --apply"
//
//   --orphans     widen to rows attached to no pet (ads already rejected)
//   --all         widen further to rows that already have a body
//   --limit=N     clear at most N rows, so the re-fetch can be spread
//                 across several runs rather than landing in one tick

import 'dotenv/config';
import { eq, inArray, sql } from 'drizzle-orm';
import { pathToFileURL } from 'url';
import { db, schema, pg } from './index.js';

interface Row {
  url: string;
  source: string;
  dogId: string | null;
  hasBody: boolean;
  petStatus: string | null;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const all = process.argv.includes('--all');
  // --all implies --orphans: a full re-derive that skipped the rejected
  // ads would not be a full re-derive.
  const orphans = all || process.argv.includes('--orphans');
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1] ?? '', 10) : null;
  if (limitArg && (!Number.isFinite(limit) || (limit as number) < 1)) {
    console.error('--limit= needs a positive integer');
    process.exit(1);
  }

  console.log(apply ? '▶ APPLY — writes are real' : '▶ dry run — pass --apply to write');
  console.log(
    `  scope: ${
      all
        ? 'ALL rows, bodies included (full re-derive)'
        : orphans
          ? 'body-less rows, attached to a pet or not'
          : 'body-less rows attached to an ACTIVE pet'
    }`,
  );

  // Everything, so the report can describe the whole ledger rather than
  // only the slice being cleared. Volumes here are thousands of rows at
  // most, and this is a CLI, not a request path.
  const rows: Row[] = await db
    .select({
      url: schema.scrapeLog.url,
      source: schema.scrapeLog.source,
      dogId: schema.scrapeLog.dogId,
      hasBody: sql<boolean>`${schema.scrapeLog.rawBody} is not null`,
      petStatus: schema.lostDogs.status,
    })
    .from(schema.scrapeLog)
    .leftJoin(schema.lostDogs, eq(schema.scrapeLog.dogId, schema.lostDogs.id));

  if (rows.length === 0) {
    // A check that read nothing must never be reported as a check that
    // found nothing.
    console.log('\n!! THE LEDGER IS EMPTY — zero scrape_log rows.');
    console.log('   That is not "nothing to do": it means either the ledger has already');
    console.log('   been cleared, or this is pointed at the wrong database. Stop and look.');
    await pg.end();
    return;
  }

  const withBody = rows.filter((r) => r.hasBody);
  const withoutBody = rows.filter((r) => !r.hasBody);

  const bySource = new Map<string, { total: number; body: number }>();
  for (const r of rows) {
    const e = bySource.get(r.source) ?? { total: 0, body: 0 };
    e.total++;
    if (r.hasBody) e.body++;
    bySource.set(r.source, e);
  }

  console.log(`\nledger rows:            ${rows.length}`);
  console.log(`  … with a stored body: ${withBody.length}`);
  console.log(`  … without:            ${withoutBody.length}`);
  for (const [source, e] of [...bySource].sort((a, b) => b[1].total - a[1].total)) {
    console.log(`     ${source.padEnd(10)} ${String(e.total).padStart(5)}  (${e.body} with body)`);
  }

  let candidates = all ? rows : withoutBody;

  // A row whose pet is already expired is dead weight: re-fetching its ad
  // buys a body for a pet nothing draws. Skipped so the request burst
  // goes where it does some good.
  const beforeExpiredFilter = candidates.length;
  candidates = candidates.filter((r) => r.petStatus !== 'expired');
  const skippedExpired = beforeExpiredFilter - candidates.length;

  // Rows with no pet behind them are ads the pipeline already rejected.
  // Excluded by default — see the header: re-opening one recomputes the
  // same rejection, and for the title-filtered majority does not even
  // reach the network.
  const beforeOrphanFilter = candidates.length;
  if (!orphans) candidates = candidates.filter((r) => r.dogId !== null);
  const skippedOrphans = beforeOrphanFilter - candidates.length;

  const eligible = candidates.length;
  if (limit) candidates = candidates.slice(0, limit);

  const attachedToActive = candidates.filter((r) => r.petStatus === 'active').length;
  const attachedToNothing = candidates.filter((r) => r.dogId === null).length;

  console.log(`\nWILL CLEAR: ${candidates.length} row(s)`);
  console.log(`  … pointing at an active pet:       ${attachedToActive}`);
  console.log(`  … pointing at no pet (rejected ad): ${attachedToNothing}`);
  if (skippedExpired > 0) {
    console.log(`  (${skippedExpired} row(s) left alone — their pet is already expired)`);
  }
  if (skippedOrphans > 0) {
    console.log(
      `  (${skippedOrphans} row(s) left alone — no pet behind them; --orphans to include)`,
    );
  }
  if (limit && eligible > candidates.length) {
    // Never let a bound look like completeness.
    console.log(
      `\n!! CAPPED BY --limit=${limit}. ${eligible - candidates.length} eligible row(s) were NOT` +
        `\n   cleared. Re-run to continue; this is not the whole set.`,
    );
  }

  // Only rows that reach fetchText cost a request, and a row with a pet
  // behind it did reach it once. The rejected ads mostly did not — their
  // verdict came from the listing title — so counting them as fetches
  // would overstate the burst.
  const willFetch = candidates.filter((r) => r.dogId !== null).length;
  console.log(
    `\n  → the next ingest ticks will fetch about ${willFetch} ad page(s).\n` +
      `    OLX answers roughly every other request and the scraper retries\n` +
      `    immediately, so budget ~2 requests per ad.` +
      (candidates.length > willFetch
        ? `\n    The other ${candidates.length - willFetch} are re-judged from the listing title,\n` +
          `    which costs no extra request.`
        : ''),
  );

  if (!apply) {
    console.log('\n✓ dry run, nothing written.');
    console.log(`  --apply would DELETE ${candidates.length} scrape_log row(s).`);
    console.log('  lost_dogs and sightings are not touched by this script.');
    await pg.end();
    return;
  }

  // Chunked: a single IN () with thousands of members is a query no
  // planner enjoys, and a partial failure should leave a coherent ledger.
  const urls = candidates.map((r) => r.url);
  const CHUNK = 200;
  let deleted = 0;
  for (let i = 0; i < urls.length; i += CHUNK) {
    const slice = urls.slice(i, i + CHUNK);
    await db.delete(schema.scrapeLog).where(inArray(schema.scrapeLog.url, slice));
    deleted += slice.length;
  }

  console.log(`\n  ${deleted} ledger row(s) deleted`);
  console.log('  Those ads are fetchable again on the next tick.');
  console.log("  Follow with expire:no-post ONCE the ticks have run — not before.");
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
