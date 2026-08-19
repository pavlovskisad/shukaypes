// BRING BACK THE PETS WE EXPIRED WHILE THEIR OWNERS WERE STILL LOOKING.
//
// «Льоля» was ingested 21 April and expired by the staleness sweep on age
// alone. Her ad was still serving four months later — the owner had been
// renewing a live listing while we quietly took her off the map. Nobody
// told them. Nobody could have known.
//
// Age is a proxy for "the search is over". A listing the owner is still
// maintaining is evidence that it is not, and it is a question we can
// simply ask. So: for every expired pet that came from a scraped ad,
// fetch the ad. If it still answers, the search is still running.
//
// THREE OUTCOMES, kept apart for the same reason backfill:ad-bodies does:
//
//   200        → the search is live. Revive, and stamp ad_alive_at so the
//                daily sweep stands down instead of expiring it again
//                tomorrow. Without that stamp this whole pass lasts one
//                day.
//   404 / 410  → the listing is gone. Stays expired, and gets marked
//                'ad-gone' so we never re-fetch it.
//   anything   → left exactly as it is. A 403 that survived its retries
//   else         says nothing about whether the ad exists, and a pet
//                revived on a timeout is a pet put back on no evidence.
//
// TWO GUARDS, both learned from rows already in this database.
//
// Pets expired for being in the WRONG CITY are never revived. A Kharkiv
// dog whose ad is perfectly alive would come straight back onto the Kyiv
// map, and expire:out-of-area exists precisely because nothing downstream
// catches that. Judged with the same detectOtherCity() that gate uses.
//
// Rows already marked 'ad-gone' are skipped without a request — we asked
// today and OLX said no.
//
// Dry run by default; the dry run makes NO requests unless --sample.
//
// Usage:
//   fly ssh console -a shukajpes-api -C "node dist/db/revive-live-ads.js"
//   fly ssh console -a shukajpes-api -C "node dist/db/revive-live-ads.js --sample=5"
//   fly ssh console -a shukajpes-api -C "node dist/db/revive-live-ads.js --apply"

import 'dotenv/config';
import { and, eq, sql } from 'drizzle-orm';
import { pathToFileURL } from 'url';
import { db, schema, pg } from './index.js';
import { scrapeFetch } from '../lib/scrapeFetch.js';
import { detectOtherCity } from '../pipeline/outOfArea.js';
import { redactContacts } from '../pipeline/redactContacts.js';
import { AD_GONE } from './backfill-ad-bodies.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36';

const DEFAULT_DELAY_MS = 1500;

function numArg(flag: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (!raw) return fallback;
  const n = Number(raw.split('=')[1]);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`${flag}= needs a non-negative number`);
    process.exit(1);
  }
  return n;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const sample = numArg('--sample', 0);
  const limit = numArg('--limit', 0);
  const delayMs = numArg('--delay', DEFAULT_DELAY_MS);

  console.log(apply ? '▶ APPLY — writes are real' : '▶ dry run — pass --apply to write');

  const rows = await db
    .select({
      dogId: schema.lostDogs.id,
      name: schema.lostDogs.name,
      lastSeenAt: schema.lostDogs.lastSeenAt,
      description: schema.lostDogs.lastSeenDescription,
      isFound: schema.lostDogs.isFoundReport,
      url: schema.scrapeLog.url,
      title: schema.scrapeLog.title,
    })
    .from(schema.lostDogs)
    .innerJoin(schema.scrapeLog, eq(schema.scrapeLog.dogId, schema.lostDogs.id))
    .where(
      and(
        eq(schema.lostDogs.status, 'expired'),
        sql`${schema.scrapeLog.url} like 'http%'`,
        sql`(${schema.scrapeLog.skipReason} is null or ${schema.scrapeLog.skipReason} <> ${AD_GONE})`,
      ),
    );

  // One request per pet, not per ledger row.
  const byDog = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!byDog.has(r.dogId)) byDog.set(r.dogId, r);
  let targets = [...byDog.values()];

  const beforeGuards = targets.length;

  // GUARD 1 — never revive a pet that belongs to another city. Its ad may
  // be perfectly alive; that does not make it a Kyiv search.
  const otherCity: string[] = [];
  targets = targets.filter((t) => {
    const hit =
      (t.title ? detectOtherCity(t.title) : null) ??
      (t.description ? detectOtherCity(t.description) : null);
    if (hit) {
      otherCity.push(`${t.name} — ${hit.city}`);
      return false;
    }
    return true;
  });

  // GUARD 2 — found strays are not searches, so reviving one puts a
  // misleading card back rather than a missing pet.
  const foundReports = targets.filter((t) => t.isFound).length;
  targets = targets.filter((t) => !t.isFound);

  console.log(`\nexpired pets with a fetchable ad URL: ${beforeGuards}`);
  console.log(`  … skipped, another city named:      ${otherCity.length}`);
  for (const o of otherCity.slice(0, 10)) console.log(`        ${o}`);
  console.log(`  … skipped, found strays:            ${foundReports}`);
  console.log(`  … to check:                         ${targets.length}`);

  if (targets.length === 0) {
    console.log('\n!! NOTHING TO CHECK. That is either a clean base or the wrong');
    console.log('   database — confirm which before reading it as good news.');
    await pg.end();
    return;
  }

  if (!apply && sample === 0) {
    const days = (d: Date) => Math.floor((Date.now() - d.getTime()) / 86_400_000);
    console.log('\n  Sample of what would be checked:');
    for (const t of targets.slice(0, 10)) {
      console.log(
        `    ${t.name.padEnd(22)} expired, last seen ${String(days(t.lastSeenAt)).padStart(4)}d ago`,
      );
    }
    if (targets.length > 10) console.log(`    … and ${targets.length - 10} more`);
    console.log(
      `\n✓ dry run, no requests made and nothing written.` +
        `\n  --sample=5 fetches five and reports, still without writing.` +
        `\n  --apply checks all ${targets.length} (~${targets.length * 2} requests with retries).`,
    );
    await pg.end();
    return;
  }

  if (!apply) targets = targets.slice(0, sample);
  else if (limit) targets = targets.slice(0, limit);

  console.log(
    apply
      ? `\nchecking ${targets.length} ad(s), ${delayMs}ms apart…\n`
      : `\nchecking ${targets.length} ad(s) as a sample — NOTHING will be written\n`,
  );

  let alive = 0;
  let gone = 0;
  let inconclusive = 0;

  for (const [i, t] of targets.entries()) {
    if (i > 0 && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

    let res;
    try {
      res = await scrapeFetch(t.url, {
        headers: { 'user-agent': UA, 'accept-language': 'uk-UA,uk;q=0.9,en;q=0.6' },
        retryOnBlock: true,
      });
    } catch (err) {
      inconclusive++;
      console.log(`  ?  ${t.name.padEnd(22)} threw: ${(err as Error).message.slice(0, 50)}`);
      continue;
    }

    if (res.status === 404 || res.status === 410) {
      gone++;
      console.log(`  ✗  ${t.name.padEnd(22)} ${res.status} — ad gone, stays expired`);
      if (apply) {
        await db
          .update(schema.scrapeLog)
          .set({ skipReason: AD_GONE })
          .where(eq(schema.scrapeLog.url, t.url));
      }
      continue;
    }

    if (!res.ok) {
      inconclusive++;
      console.log(`  ?  ${t.name.padEnd(22)} HTTP ${res.status} after ${res.attempts} — unchanged`);
      continue;
    }

    alive++;
    console.log(
      `  ✓  ${t.name.padEnd(22)} ad still live — ${redactContacts(t.title ?? '').slice(0, 44)}`,
    );
    if (apply) {
      // The stamp matters as much as the revive: without it the daily
      // sweep expires this pet again tomorrow on the same age rule.
      await db
        .update(schema.scrapeLog)
        .set({ adAliveAt: new Date() })
        .where(eq(schema.scrapeLog.url, t.url));
      await db
        .update(schema.lostDogs)
        .set({ status: 'active' })
        .where(eq(schema.lostDogs.id, t.dogId));
    }
  }

  console.log(`\n  ad still live (revive): ${alive}`);
  console.log(`  ad gone (stays expired): ${gone}`);
  console.log(`  inconclusive (untouched): ${inconclusive}`);

  if (inconclusive > 0) {
    console.log(
      `\n!! ${inconclusive} gave no answer and were left exactly as they were. They are\n` +
        `   not evidence of anything — re-run to retry them.`,
    );
  }

  if (!apply) {
    console.log('\n✓ sample only, nothing written.');
    await pg.end();
    return;
  }

  console.log(`\n  ${alive} pet(s) back on the map, with ad_alive_at stamped so the`);
  console.log('  daily sweep does not undo it.');
  console.log("  reversible: UPDATE lost_dogs SET status = 'expired' WHERE id IN (…)");
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
