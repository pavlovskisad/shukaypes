// FETCH THE ADS WE ALREADY HAVE THE URLS FOR.
//
// Every pet ingested before 17 Aug has no stored ad text, so the app
// tells its walker "we don't have the full text of this one" — which is
// our database's problem leaking into somebody's search. This fills them
// in, and expires the ones whose ad has gone.
//
// WHY NOT THE OBVIOUS THING, which was the plan until the numbers came
// back. The first design cleared `scrape_log` so the scraper would
// rediscover those ads on its next tick. That only works if the ad still
// appears on a listing page we poll — and it no longer does. OLX listing
// URLs are now sorted `created_at:desc` (the fix for a scraper that had
// saturated its own relevance-ordered page one and stopped producing
// anything at all), so page one shows the ~40 NEWEST ads per query. An ad
// from six weeks ago will never be on it again. Deleting its ledger row
// would have been a no-op repeated eleven thousand times.
//
// There was never a need to rediscover anything. `scrape_log.url` is the
// ad's address and we have kept it all along. Fetch it directly: ~226
// requests instead of twelve thousand, no listing pages, no dedupe
// interaction, no duplicate pets, no renumbering, sightings untouched.
//
// THREE OUTCOMES, AND KEEPING THEM APART IS THE WHOLE SAFETY PROPERTY:
//
//   200        → store the body. The pet keeps its row and gains its text.
//   404 / 410  → the listing is gone, which for a lost-pet ad usually
//                means the pet was found. Recorded as skip_reason
//                'ad-gone'. NOT expired here — expire:no-post does the
//                writing, after a human has read the dry run.
//   anything   → left completely alone and counted. A 403 that survived
//   else         its retries, a timeout, a parse failure: these say
//                nothing about whether the ad exists, and treating one as
//                'ad-gone' would expire a pet whose owner is still
//                looking. Silence is not evidence.
//
// Politeness delay goes BETWEEN ads, never inside the retry. The retry in
// scrapeFetch works precisely because it reuses the warm connection with
// no gap; adding a delay there silently disables it (HANDOFF §0.1b).
//
// Dry run by default, and the dry run makes NO requests — it lists the
// work. `--sample=N` fetches N of them and prints the outcomes without
// writing, so the shape of the answer is cheap to see before committing
// to the whole run.
//
// Usage:
//   local:       pnpm --filter @shukajpes/server backfill:ad-bodies
//                pnpm --filter @shukajpes/server backfill:ad-bodies --sample=5
//                pnpm --filter @shukajpes/server backfill:ad-bodies --apply
//   production:  fly ssh console -a shukajpes-api -C "node dist/db/backfill-ad-bodies.js"
//                fly ssh console -a shukajpes-api -C "node dist/db/backfill-ad-bodies.js --apply"
//
//   --repair     target bodies stored WITH CSS in them (pre-<style>-strip)
//                and overwrite, instead of targeting missing ones
//   --sample=N   dry run, but really fetch N ads and report (no writes)
//   --limit=N    cap how many are fetched in an --apply run
//   --delay=MS   between ads (default 1500)

import 'dotenv/config';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { pathToFileURL } from 'url';
import { db, schema, pg } from './index.js';
import { scrapeFetch } from '../lib/scrapeFetch.js';
import { extractAdBody } from '../pipeline/sources/adHtml.js';
import { capBody } from '../pipeline/adBody.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36';

// Marks a ledger row whose ad OLX no longer serves. expire:no-post reads
// this, so the string is load-bearing across two files.
export const AD_GONE = 'ad-gone';

const DEFAULT_DELAY_MS = 1500;

interface Target {
  url: string;
  dogId: string;
  petName: string;
}

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

  // Active pets whose ledger row carries a URL but no body, and which
  // have not already been marked gone by a previous run. Only http(s)
  // rows: a Telegram-sourced row's "url" is a message link, not an ad
  // page, and fetching it would prove nothing.
  // --repair swaps the target from "has no body" to "has a body full of
  // stylesheet", so a corpus stored before the <style> strip can be
  // corrected without clearing anything first. Matching the RULE SHAPE
  // (.css-xxxx{) rather than a bare class prefix, so an ad that merely
  // mentions css in prose is not re-fetched.
  const repair = process.argv.includes('--repair');
  const bodyPredicate = repair
    ? sql`${schema.scrapeLog.rawBody} ~ '\\.css-[a-z0-9]+[[:space:]]*\\{'`
    : isNull(schema.scrapeLog.rawBody);

  const rows = await db
    .select({
      url: schema.scrapeLog.url,
      dogId: schema.scrapeLog.dogId,
      petName: schema.lostDogs.name,
    })
    .from(schema.scrapeLog)
    .innerJoin(schema.lostDogs, eq(schema.scrapeLog.dogId, schema.lostDogs.id))
    .where(
      and(
        eq(schema.lostDogs.status, 'active'),
        bodyPredicate,
        sql`${schema.scrapeLog.url} like 'http%'`,
        sql`(${schema.scrapeLog.skipReason} is null or ${schema.scrapeLog.skipReason} <> ${AD_GONE})`,
      ),
    );

  // A pet with two body-less rows would otherwise be fetched twice.
  const byDog = new Map<string, Target>();
  for (const r of rows) {
    if (!r.dogId || byDog.has(r.dogId)) continue;
    byDog.set(r.dogId, { url: r.url, dogId: r.dogId, petName: r.petName });
  }
  let targets = [...byDog.values()];

  console.log(
    `\nactive pets ${repair ? 'whose stored body is polluted with CSS' : 'with a fetchable ad URL and no stored body'}: ${targets.length}`,
  );

  if (targets.length === 0) {
    // A check that read nothing must never be reported as a check that
    // found nothing.
    console.log('\n!! NOTHING TO DO — which is either a finished backfill or the wrong');
    console.log('   database. Confirm which before reading this as success.');
    await pg.end();
    return;
  }

  if (!apply && sample === 0) {
    console.log('\n  Sample of what would be fetched:');
    for (const t of targets.slice(0, 10)) {
      console.log(`    ${t.petName.padEnd(22)} ${t.url}`);
    }
    if (targets.length > 10) console.log(`    … and ${targets.length - 10} more`);
    console.log(
      `\n✓ dry run, no requests made and nothing written.` +
        `\n  --sample=5 fetches five of them and reports, still without writing.` +
        `\n  --apply fetches all ${targets.length} (~${targets.length * 2} requests with retries).`,
    );
    await pg.end();
    return;
  }

  if (!apply) targets = targets.slice(0, sample);
  else if (limit) targets = targets.slice(0, limit);

  const write = apply;
  console.log(
    write
      ? `\nfetching ${targets.length} ad(s), ${delayMs}ms apart…\n`
      : `\nfetching ${targets.length} ad(s) as a sample — NOTHING will be written\n`,
  );

  let stored = 0;
  let gone = 0;
  let inconclusive = 0;
  const inconclusiveReasons = new Map<string, number>();

  for (const [i, t] of targets.entries()) {
    // Between ads, never inside the retry — see the header.
    if (i > 0 && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

    let res;
    try {
      res = await scrapeFetch(t.url, {
        headers: { 'user-agent': UA, 'accept-language': 'uk-UA,uk;q=0.9,en;q=0.6' },
        retryOnBlock: true,
      });
    } catch (err) {
      inconclusive++;
      const key = `threw: ${(err as Error).message.slice(0, 60)}`;
      inconclusiveReasons.set(key, (inconclusiveReasons.get(key) ?? 0) + 1);
      console.log(`  ?  ${t.petName.padEnd(22)} ${key}`);
      continue;
    }

    if (res.status === 404 || res.status === 410) {
      gone++;
      console.log(`  ✗  ${t.petName.padEnd(22)} ${res.status} — ad is gone`);
      if (write) {
        await db
          .update(schema.scrapeLog)
          .set({ skipReason: AD_GONE })
          .where(eq(schema.scrapeLog.url, t.url));
      }
      continue;
    }

    if (!res.ok) {
      // 403 after three attempts, a 5xx, anything else. Says nothing
      // about whether the ad exists.
      inconclusive++;
      const key = `HTTP ${res.status}`;
      inconclusiveReasons.set(key, (inconclusiveReasons.get(key) ?? 0) + 1);
      console.log(`  ?  ${t.petName.padEnd(22)} ${key} after ${res.attempts} attempt(s)`);
      continue;
    }

    const { text } = extractAdBody(res.body);
    if (!text || text.length < 40) {
      // Served a page, but not one we can read — a layout change, or an
      // interstitial. Not evidence the ad is gone.
      inconclusive++;
      const key = 'page served but body unreadable';
      inconclusiveReasons.set(key, (inconclusiveReasons.get(key) ?? 0) + 1);
      console.log(`  ?  ${t.petName.padEnd(22)} ${key} (${text.length} chars)`);
      continue;
    }

    stored++;
    console.log(`  ✓  ${t.petName.padEnd(22)} ${text.length} chars`);
    if (write) {
      await db
        .update(schema.scrapeLog)
        .set({ rawBody: capBody(text) })
        .where(eq(schema.scrapeLog.url, t.url));
    }
  }

  console.log(`\n  stored:       ${stored}`);
  console.log(`  ad gone:      ${gone}${write ? " (marked, NOT expired)" : ''}`);
  console.log(`  inconclusive: ${inconclusive}`);
  for (const [reason, n] of [...inconclusiveReasons].sort((a, b) => b[1] - a[1])) {
    console.log(`     ${String(n).padStart(4)}  ${reason}`);
  }

  if (inconclusive > 0) {
    console.log(
      `\n!! ${inconclusive} ad(s) gave no answer. They are UNCHANGED and will be retried by\n` +
        `   the next run. They are not 'gone' — do not read the expiry pass as complete\n` +
        `   while this number is above zero.`,
    );
  }

  if (!write) {
    console.log('\n✓ sample only, nothing written.');
    await pg.end();
    return;
  }

  if (limit && byDog.size > targets.length) {
    console.log(
      `\n!! CAPPED BY --limit. ${byDog.size - targets.length} pet(s) were not fetched. Re-run to continue.`,
    );
  }

  console.log(
    `\n  Next: expire:no-post — it expires the '${AD_GONE}' rows, dry run first.`,
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
