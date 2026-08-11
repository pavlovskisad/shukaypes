// SWEEP THE LOST-PET TABLE FOR THINGS THAT SHOULD NEVER HAVE LANDED.
//
// The ingest pipeline has gained guards over time — a Kyiv-only city
// check most recently — but guards only ever apply to what comes next.
// Everything scraped before a guard existed is still sitting in the
// table, and the map draws it. This is the catch-up pass: it re-asks
// today's questions of yesterday's rows.
//
// Three faults, and each one is fixed the smallest way that works:
//
//   dead photo    → photo_url = NULL. The card falls back to the pet's
//                   emoji, which is a fine card. A broken <img> is not.
//                   OLX expires its CDN objects long before it takes
//                   the ad down, so this is the common one.
//
//   wrong city    → status = 'expired'. NOT a delete: sightings cascade
//                   from lost_dogs, and a real person walking a real
//                   street reported those. /dogs/nearby filters on
//                   status = 'active', so expiring takes the pet off the
//                   map completely while keeping every record and
//                   staying one UPDATE away from reversible.
//
//   gone from     → REPORTED ONLY. An OLX 404 usually means the pet went
//   the source      home, which is the best outcome there is — but it can
//                   equally mean we got rate-limited, and expiring live
//                   pets over a transient 429 would be much worse than
//                   leaving a few stale ones up. Read the count, decide
//                   by hand.
//
// Dry run by default. Nothing is written without --apply, and the dry
// run prints exactly what the apply would do.
//
// The COUNTING half of this audit — how many pets the map can draw,
// when each source last produced one, what the invisible ones are made
// of — needs no network at all and is served over HTTP instead:
//
//   GET /admin/lost-dogs/report[?format=text]   (Bearer ADMIN_TOKEN)
//
// Reach for that first. This script is for the half that has to go out
// and ask the internet questions, which takes minutes and cannot run
// inside a request.
//
// Usage:
//   local:       pnpm --filter @shukajpes/server clean:lost-dogs
//                pnpm --filter @shukajpes/server clean:lost-dogs --apply
//   production:  fly ssh console -a shukajpes-api -C "node dist/db/clean-lost-dogs.js"
//                fly ssh console -a shukajpes-api -C "node dist/db/clean-lost-dogs.js --apply"

import 'dotenv/config';
import { and, eq, isNotNull } from 'drizzle-orm';
import { pathToFileURL } from 'url';
import { db, schema, pg } from './index.js';
import {
  buildLostDogsReport,
  formatLostDogsReport,
  loadAuditRows,
  type AuditRow,
} from '../services/lostDogsReport.js';
import { looksNotKyiv } from '../pipeline/sources/olx.js';

// OLX rate-limits an impolite crawler, and being rate-limited here reads
// as "every pet is gone" — the single most destructive way this script
// could be wrong. One request at a time with a gap between them.
const REQUEST_GAP_MS = 400;
const REQUEST_TIMEOUT_MS = 12_000;
// Sent on the ad fetches. The scraper already presents itself this way;
// matching it means we get the same pages it got.
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BLOCK_GIVE_UP = 8;

type Fetched =
  | { ok: true; status: number; body: string }
  | { ok: false; status: number | null; error: string };

async function get(url: string, wantBody: boolean): Promise<Fetched> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      // HEAD on the OLX CDN is enough to tell a live object from an
      // expired one, and avoids pulling a photo we are only going to
      // throw away.
      method: wantBody ? 'GET' : 'HEAD',
      redirect: 'follow',
      signal: ctl.signal,
      headers: { 'user-agent': UA, 'accept-language': 'uk,en;q=0.8' },
    });
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    return { ok: true, status: res.status, body: wantBody ? await res.text() : '' };
  } catch (err) {
    return { ok: false, status: null, error: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(apply ? '▶ APPLY — writes are real' : '▶ dry run — pass --apply to write');

  // Everything EXCEPT pets somebody reported in the app — those have no
  // source page to check and no CDN to expire, and second-guessing a
  // human's own report is not this script's job.
  //
  // Matched by excluding 'in_app' rather than by naming the scrapers.
  // lost_dogs.source stores whatever the ingest was called — 'olx',
  // 'telegram:<channel>', 'admin-sideload' — never the literal 'scrape'
  // the column comment implies. The first version of this filtered for
  // ==='scrape', matched nothing, and would have printed "0 active
  // scraped pets" as though that were a clean bill of health. Hence the
  // per-source breakdown below: a filter that quietly matches nothing
  // should be visible, not indistinguishable from a tidy database.
  const rows: AuditRow[] = await loadAuditRows();

  // Permalinks in a second query, joined in memory.
  //
  // This started as a correlated subquery in a raw sql`` fragment and
  // was wrong twice: once on a column that doesn't exist (scrape_log
  // has first_seen_at, not created_at), and once invisibly — drizzle
  // renders interpolated columns UNQUALIFIED inside a raw fragment, so
  // `WHERE scrape_log.dog_id = lost_dogs.id` came out as
  // `WHERE "dog_id" = "id"`. That happens to resolve correctly today
  // only because scrape_log has no `id` column of its own; the day it
  // gains one, the subquery matches nothing and every pet silently
  // looks permalink-less.
  //
  // Two plain queries and a Map are immune to all of that, and at a few
  // hundred rows the cost is nothing.
  const logs = await db
    .select({
      dogId: schema.scrapeLog.dogId,
      url: schema.scrapeLog.url,
      firstSeenAt: schema.scrapeLog.firstSeenAt,
    })
    .from(schema.scrapeLog)
    .where(isNotNull(schema.scrapeLog.dogId));
  const urlByDog = new Map<string, string>();
  for (const l of logs.sort((a, b) => a.firstSeenAt.getTime() - b.firstSeenAt.getTime())) {
    // Earliest wins: the ad we first ingested the pet from.
    if (l.dogId && !urlByDog.has(l.dogId)) urlByDog.set(l.dogId, l.url);
  }
  for (const r of rows) r.sourceUrl = urlByDog.get(r.id) ?? null;

  // The counting half of this audit now lives in services/lostDogsReport
  // so an admin endpoint can serve the same numbers without an SSH
  // session. One renderer, one query, two front doors — the CLI and the
  // endpoint cannot drift into describing the same database differently.
  console.log(formatLostDogsReport(await buildLostDogsReport(rows, Date.now())));

  const deadPhoto: AuditRow[] = [];
  const photoUnchecked: { row: AuditRow; why: string }[] = [];
  const wrongCity: { row: AuditRow; hint: string }[] = [];
  const sourceGone: AuditRow[] = [];
  const noPermalink: AuditRow[] = [];
  const adFetchFailed: { row: AuditRow; why: string }[] = [];
  let adFetched = 0;
  // Give up on the city half after this many 403s in a row.
  let consecutiveBlocks = 0;
  let cityCheckBlocked = false;
  let cityCheckSkipped = 0;

  for (const row of rows) {
    if (row.photoUrl) {
      const res = await get(row.photoUrl, false);
      // ONLY a definitive 404/410 counts as dead.
      //
      // This used to treat any failed request as a dead photo, which is
      // the one genuinely dangerous thing in this script: a CDN 429, a
      // 503, or a timed-out socket would have nulled the photo of a pet
      // whose picture was fine, and the URL is not recoverable
      // afterwards. Rate limiting is exactly the condition a sweep like
      // this provokes, so the failure mode was not hypothetical.
      //
      // Anything that isn't a clear "gone" is reported and left alone.
      if (!res.ok) {
        if (res.status === 404 || res.status === 410) deadPhoto.push(row);
        else photoUnchecked.push({ row, why: res.error });
      }
      await sleep(REQUEST_GAP_MS);
    }

    // "We never had a link" and "we had a link and couldn't load it" are
    // different facts and were being counted as one number. That number
    // came back 253 of 261 and said nothing about which — while
    // "not in kyiv: 0" sat above it looking like a clean bill of health,
    // when what it actually meant was that the check never ran.
    if (!row.sourceUrl) {
      noPermalink.push(row);
      continue;
    }

    // Stop knocking once it's clear nobody is opening the door.
    //
    // OLX is behind CloudFront's WAF, which blocks datacentre IPs — so
    // run from the app host, every one of these 250-odd requests is a
    // guaranteed 403. Hammering a WAF that has already refused us is
    // pointless, takes two minutes, and is exactly the behaviour that
    // gets a block widened rather than lifted. The photo half above
    // still completes: the CDN answers fine, it's only the ad pages
    // that are blocked.
    if (cityCheckBlocked) {
      cityCheckSkipped++;
      continue;
    }

    const page = await get(row.sourceUrl, true);
    await sleep(REQUEST_GAP_MS);
    if (!page.ok) {
      if (page.status === 404 || page.status === 410) sourceGone.push(row);
      else {
        adFetchFailed.push({ row, why: page.error });
        if (page.status === 403) consecutiveBlocks++;
        if (consecutiveBlocks >= BLOCK_GIVE_UP) {
          cityCheckBlocked = true;
          console.log(
            `  … ${BLOCK_GIVE_UP} consecutive 403s — the ad host is blocking this machine.\n` +
              `    Skipping the rest of the city check rather than keep knocking.`,
          );
        }
      }
      continue;
    }
    consecutiveBlocks = 0;
    adFetched++;
    if (looksNotKyiv(page.body)) {
      // Pull the city out of the page for the log — the operator should
      // be able to sanity-check the call without opening every link.
      const m = page.body.match(
        /Харків|Харьков|Львів|Львов|Одес|Дніпро|Днепр|Запоріж|Запорож|Вінниц|Винниц|Полтав|Черкас|Чернігів|Чернигов|Житомир|Миколаїв|Николаев|Херсон|Тернопіль|Тернополь|Ужгород|Івано-Франківськ|Ивано-Франковск|Луцьк|Луцк|Рівне|Ровно|Суми|Сумы|Кропивницьк|Кировоград|Хмельницьк|Хмельницк/i,
      );
      wrongCity.push({ row, hint: m?.[0] ?? '?' });
    }
  }

  const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));

  console.log(`dead photos (404/410 — will be nulled): ${deadPhoto.length}`);
  for (const r of deadPhoto) console.log(`   ${pad(r.name, 22)} ${r.photoUrl}`);
  console.log(`\nphoto check inconclusive (LEFT ALONE): ${photoUnchecked.length}`);
  for (const p of photoUnchecked) console.log(`   ${pad(p.row.name, 22)} ${p.why}`);
  if (photoUnchecked.length > deadPhoto.length) {
    console.log('   ^ more failures than 404s — likely rate limiting, re-run later');
  }
  console.log(`\nnot in kyiv (of ${adFetched} ads actually read): ${wrongCity.length}`);
  for (const w of wrongCity) console.log(`   ${pad(w.row.name, 22)} ${w.hint}  ${w.row.sourceUrl}`);
  console.log(`\nsource ad gone (REPORT ONLY, not touched): ${sourceGone.length}`);
  for (const r of sourceGone) console.log(`   ${pad(r.name, 22)} ${r.sourceUrl}`);
  console.log(`\nno permalink at all, nothing to ask: ${noPermalink.length}`);
  console.log(`ad fetch failed: ${adFetchFailed.length}`);
  const byErr = new Map<string, number>();
  for (const f of adFetchFailed) byErr.set(f.why, (byErr.get(f.why) ?? 0) + 1);
  for (const [why, n] of [...byErr].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`     ${n}\t${why}`);
  }
  // The headline number the operator actually needs: a city check that
  // read nothing is not a city check that found nothing.
  if (cityCheckSkipped > 0) {
    console.log(`not even attempted (gave up after repeated blocks): ${cityCheckSkipped}`);
  }
  if (adFetched === 0) {
    console.log(
      `\n!! THE CITY CHECK READ ZERO ADS — "not in kyiv: 0" above means nothing.\n` +
        `   The ad host blocks this machine (CloudFront WAF blocks datacentre IPs).\n` +
        `   The PHOTO half above is unaffected and complete — the CDN answers fine —\n` +
        `   so --apply from here is safe, it will just have no city work to do.\n` +
        `   For the city half, run from a normal connection:\n` +
        `   DATABASE_URL=<prod url> pnpm --filter @shukajpes/server clean:lost-dogs`,
    );
  } else if (adFetchFailed.length > adFetched) {
    console.log(
      `\n!! more ad fetches failed (${adFetchFailed.length}) than succeeded (${adFetched}).\n` +
        `   Treat the city result as a sample, not a sweep.`,
    );
  }

  if (!apply) {
    console.log('\n✓ dry run, nothing written.');
    return;
  }

  for (const r of deadPhoto) {
    await db
      .update(schema.lostDogs)
      .set({ photoUrl: null })
      .where(and(eq(schema.lostDogs.id, r.id), isNotNull(schema.lostDogs.photoUrl)));
  }
  console.log(`\n  ${deadPhoto.length} photo_url → NULL`);

  for (const w of wrongCity) {
    await db
      .update(schema.lostDogs)
      .set({ status: 'expired' })
      .where(eq(schema.lostDogs.id, w.row.id));
  }
  console.log(`  ${wrongCity.length} status → expired`);
  console.log('\n✓ done.');
}

const isEntry = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isEntry) {
  main()
    .then(() => pg.end())
    .catch((err) => {
      console.error(err);
      pg.end().finally(() => process.exit(1));
    });
}
