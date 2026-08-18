// MAKE ADS FETCHABLE AGAIN, so the base can be refreshed in place.
//
// `olx.ts` skips any URL already present in `scrape_log` (seenUrls). That
// is what stops the scraper re-reading the same ad every hour, and it is
// also what freezes the base: a pet ingested before `raw_body` existed
// never gains a body, however many ticks run, because its ad is never
// fetched again. Deleting the ledger row un-freezes exactly that ad.
//
// DEFAULT IS THE NARROW ONE, and the narrow one is almost always right.
// Only rows with NO stored body are cleared. Rows that already carry
// their ad text need no re-fetch at all — clearing them would throw away
// text we hold in exchange for a request that might come back 404 if the
// owner has since taken the listing down. `--all` exists for a genuine
// full refresh (pins, photos and parse re-derived from scratch) and
// should be a deliberate choice, not a default.
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
//   --all         also clear rows that already have a body (full refresh)
//   --limit N     clear at most N rows, so the re-fetch can be spread
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
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1] ?? '', 10) : null;
  if (limitArg && (!Number.isFinite(limit) || (limit as number) < 1)) {
    console.error('--limit= needs a positive integer');
    process.exit(1);
  }

  console.log(apply ? '▶ APPLY — writes are real' : '▶ dry run — pass --apply to write');
  console.log(all ? '  scope: ALL ledger rows (full refresh)' : '  scope: rows with NO stored body');

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

  if (limit) candidates = candidates.slice(0, limit);

  const attachedToActive = candidates.filter((r) => r.petStatus === 'active').length;
  const attachedToNothing = candidates.filter((r) => r.dogId === null).length;

  console.log(`\nWILL CLEAR: ${candidates.length} row(s)`);
  console.log(`  … pointing at an active pet:      ${attachedToActive}`);
  console.log(`  … pointing at no pet (skipped ad): ${attachedToNothing}`);
  if (skippedExpired > 0) {
    console.log(`  (${skippedExpired} row(s) left alone — their pet is already expired)`);
  }
  if (limit && beforeExpiredFilter - skippedExpired > candidates.length) {
    // Never let a bound look like completeness.
    console.log(
      `\n!! CAPPED BY --limit=${limit}. ${beforeExpiredFilter - skippedExpired - candidates.length} ` +
        `eligible row(s) were NOT cleared.\n   Re-run to continue; this is not the whole set.`,
    );
  }

  console.log(
    `\n  → the next ingest ticks will fetch about ${candidates.length} ad page(s).\n` +
      `    OLX answers roughly every other request and the scraper retries\n` +
      `    immediately, so budget ~2 requests per ad.`,
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
