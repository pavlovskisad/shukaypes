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
// Usage:
//   local:       pnpm --filter @shukajpes/server clean:lost-dogs
//                pnpm --filter @shukajpes/server clean:lost-dogs --apply
//   production:  fly ssh console -a shukajpes-api -C "node dist/db/clean-lost-dogs.js"
//                fly ssh console -a shukajpes-api -C "node dist/db/clean-lost-dogs.js --apply"

import 'dotenv/config';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { pathToFileURL } from 'url';
import { db, schema, pg } from './index.js';
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

interface Row {
  id: string;
  name: string;
  photoUrl: string | null;
  urgency: string;
  sourceUrl: string | null;
}

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(apply ? '▶ APPLY — writes are real' : '▶ dry run — pass --apply to write');

  // Only scraped pets. A pet somebody reported in the app has no source
  // page to check and no CDN to expire, and second-guessing a human's
  // own report is not this script's job.
  const rows: Row[] = await db
    .select({
      id: schema.lostDogs.id,
      name: schema.lostDogs.name,
      photoUrl: schema.lostDogs.photoUrl,
      urgency: schema.lostDogs.urgency,
      sourceUrl: sql<string | null>`(
        SELECT url FROM ${schema.scrapeLog}
        WHERE ${schema.scrapeLog}.dog_id = ${schema.lostDogs}.id
        ORDER BY ${schema.scrapeLog}.created_at ASC
        LIMIT 1
      )`,
    })
    .from(schema.lostDogs)
    .where(and(eq(schema.lostDogs.status, 'active'), eq(schema.lostDogs.source, 'scrape')));

  console.log(`  ${rows.length} active scraped pets\n`);

  const deadPhoto: Row[] = [];
  const wrongCity: { row: Row; hint: string }[] = [];
  const sourceGone: Row[] = [];
  const unverifiable: Row[] = [];

  for (const row of rows) {
    if (row.photoUrl) {
      const res = await get(row.photoUrl, false);
      if (!res.ok) deadPhoto.push(row);
      await sleep(REQUEST_GAP_MS);
    }

    if (!row.sourceUrl) {
      // No permalink means no page to ask, so there is nothing this
      // script can honestly conclude about the pet's city.
      unverifiable.push(row);
      continue;
    }

    const page = await get(row.sourceUrl, true);
    await sleep(REQUEST_GAP_MS);
    if (!page.ok) {
      if (page.status === 404 || page.status === 410) sourceGone.push(row);
      else unverifiable.push(row);
      continue;
    }
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

  console.log(`dead photos: ${deadPhoto.length}`);
  for (const r of deadPhoto) console.log(`   ${pad(r.name, 22)} ${r.photoUrl}`);
  console.log(`\nnot in kyiv: ${wrongCity.length}`);
  for (const w of wrongCity) console.log(`   ${pad(w.row.name, 22)} ${w.hint}  ${w.row.sourceUrl}`);
  console.log(`\nsource ad gone (REPORT ONLY, not touched): ${sourceGone.length}`);
  for (const r of sourceGone) console.log(`   ${pad(r.name, 22)} ${r.sourceUrl}`);
  console.log(`\nno permalink / unreachable, city unknown: ${unverifiable.length}`);

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
