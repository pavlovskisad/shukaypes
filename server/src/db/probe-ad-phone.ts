// CAN WE READ THE OWNER'S PHONE NUMBER AT ALL? A read-only probe.
//
// OLX prints the number masked — «т.05*******62» — and reveals it when a
// human taps. So the bodies we store carry the mask, which means the
// app's contacts-after-sighting promise currently delivers asterisks. The
// owner asked whether the real number can be shown in-app; this answers
// whether that is even mechanically possible before anybody builds it.
//
// IT REPORTS STRUCTURE, NEVER VALUES. Every digit it prints is replaced
// with a bullet. Findings are described by SHAPE and by WHERE — which
// JSON key, which surrounding markup — so the diagnostic cannot become
// the exposure it went looking for. These logs get read over somebody's
// shoulder in a terminal.
//
// THE DECISIVE TEST IS THE PREFIX/SUFFIX MATCH, and it needs no values.
// OLX's mask leaves a few digits either side («05*******62»). If a full
// number elsewhere in the page starts with that prefix AND ends with that
// suffix, it is the same number — the masked one, printed in the clear
// somewhere the masking does not cover. That is a boolean, and a boolean
// is all anybody needs to decide.
//
// The first version of this probe reported only that "an unmasked
// 10-digit number exists", which was not evidence: an ad id, a timestamp
// fragment or a delivery code is also ten digits. Reading that as a phone
// number would have been the friendly assumption, not a measurement.
//
// A few ads per run, no writes, no loop beyond the cap. HANDOFF §5
// records ~23 hand-probes against OLX as a mistake worth remembering, so
// --ads is capped hard and spaced.
//
// WHAT IT CANNOT TELL YOU, and this is the part for a human: whether
// using the answer is a good idea. If the number turns out to be behind a
// reveal call rather than in the page, fetching it is routing around a
// deliberate anti-scraping measure — a different act from reading a page
// that is already public. That is the owner's call.
//
// Usage:
//   fly ssh console -a shukajpes-api -C "node dist/db/probe-ad-phone.js"
//   fly ssh console -a shukajpes-api -C "node dist/db/probe-ad-phone.js --ads=5"
//   fly ssh console -a shukajpes-api -C "node dist/db/probe-ad-phone.js --url=https://..."

import 'dotenv/config';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { pathToFileURL } from 'url';
import { db, schema, pg } from './index.js';
import { scrapeFetch } from '../lib/scrapeFetch.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36';

const MAX_ADS = 6;
const DELAY_MS = 1500;

/** Digits become •, so a finding can be reported without being disclosed. */
function shape(value: string): string {
  return value.replace(/\d/g, '•');
}

/** The JSON key or attribute immediately before an offset — the "where". */
function nearestKey(html: string, index: number): string {
  const back = html.slice(Math.max(0, index - 220), index);
  const keys = [...back.matchAll(/"([A-Za-z_][A-Za-z0-9_-]*)"\s*:/g)];
  if (keys.length) return `"${keys[keys.length - 1]![1]}":`;
  const attrs = [...back.matchAll(/([a-zA-Z-]+)=["'][^"']*$/g)];
  if (attrs.length) return `${attrs[attrs.length - 1]![1]}=`;
  const tags = [...back.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)\b/g)];
  return tags.length ? `<${tags[tags.length - 1]![1]}>` : '(bare text)';
}

interface Finding {
  url: string;
  maskedShapes: string[];
  // The question that matters: does a full number in the page reconcile
  // with the mask by prefix and suffix?
  reconciles: boolean;
  // Where the reconciling number sits, if one does.
  where: string | null;
  unmaskedCount: number;
  // Where every unmasked candidate sits, reconciling or not — so a
  // non-match can be recognised as an id rather than a near miss.
  candidateKeys: string[];
}

async function probe(url: string): Promise<Finding | null> {
  const res = await scrapeFetch(url, {
    headers: { 'user-agent': UA, 'accept-language': 'uk-UA,uk;q=0.9,en;q=0.6' },
    retryOnBlock: true,
  });
  if (!res.ok) {
    console.log(`  !! HTTP ${res.status} after ${res.attempts} attempt(s) — READ NOTHING`);
    return null;
  }
  const html = res.body;

  // Masked forms: digits, then 2+ asterisks, then digits.
  const masked = [...html.matchAll(/(\d{1,5})\*{2,}(\d{1,5})/g)];
  // Full Ukrainian mobiles.
  const unmasked = [...html.matchAll(/(?:\+?38)?(0\d{9})\b/g)];

  let reconciles = false;
  let where: string | null = null;
  for (const m of masked) {
    const prefix = m[1]!;
    const suffix = m[2]!;
    for (const u of unmasked) {
      const digits = u[1]!;
      // The mask's visible ends, against the full number's ends. OLX
      // masks from the country code onward, so compare against both the
      // bare 0XXXXXXXXX and the 380XXXXXXXXX form.
      const forms = [digits, `38${digits}`, `+38${digits}`];
      if (forms.some((f) => f.startsWith(prefix) && f.endsWith(suffix))) {
        reconciles = true;
        where = nearestKey(html, u.index ?? 0);
        break;
      }
    }
    if (reconciles) break;
  }

  return {
    url,
    maskedShapes: [...new Set(masked.map((m) => shape(m[0]!)))].slice(0, 3),
    reconciles,
    where,
    unmaskedCount: new Set(unmasked.map((u) => u[1]!)).size,
    candidateKeys: [...new Set(unmasked.map((u) => nearestKey(html, u.index ?? 0)))].slice(0, 6),
  };
}

async function main() {
  const urlArg = process.argv.find((a) => a.startsWith('--url='));
  const adsArg = process.argv.find((a) => a.startsWith('--ads='));
  const wanted = Math.min(adsArg ? Number(adsArg.split('=')[1]) || 1 : 1, MAX_ADS);

  let urls: string[] = [];
  if (urlArg?.split('=')[1]) {
    urls = [urlArg.split('=')[1]!];
  } else {
    const rows = await db
      .select({ url: schema.scrapeLog.url })
      .from(schema.scrapeLog)
      .innerJoin(schema.lostDogs, eq(schema.scrapeLog.dogId, schema.lostDogs.id))
      .where(
        and(
          eq(schema.lostDogs.status, 'active'),
          isNotNull(schema.scrapeLog.rawBody),
          sql`${schema.scrapeLog.url} like 'https://www.olx.ua/%'`,
        ),
      )
      .limit(wanted);
    urls = rows.map((r) => r.url);
  }

  if (urls.length === 0) {
    console.log('!! no candidate ads — nothing was probed, which is NOT the same as');
    console.log('   "no phone available". Pass --url= explicitly.');
    await pg.end();
    return;
  }

  console.log(`probing ${urls.length} ad(s), ${DELAY_MS}ms apart\n`);

  const findings: Finding[] = [];
  for (const [i, url] of urls.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, DELAY_MS));
    console.log(`[${i + 1}/${urls.length}] ${url.slice(0, 88)}`);
    const f = await probe(url);
    if (!f) continue;
    findings.push(f);
    console.log(`     masked shapes : ${f.maskedShapes.join('  ') || 'none'}`);
    console.log(`     full numbers  : ${f.unmaskedCount}`);
    console.log(`     RECONCILES    : ${f.reconciles ? `YES  at ${f.where}` : 'no'}`);
    console.log(`     candidates at : ${f.candidateKeys.join('  ') || '—'}`);
  }

  if (findings.length === 0) {
    console.log('\n!! EVERY fetch failed. This probe read nothing and proves nothing.');
    await pg.end();
    return;
  }

  const yes = findings.filter((f) => f.reconciles).length;
  console.log(`\n─── ${yes} of ${findings.length} ad(s) had a full number matching their own mask ───`);
  if (yes === findings.length) {
    console.log('  The owner\'s number is present in the page OLX already serves us.');
    console.log('  Reading it is parsing a public page, not defeating the reveal.');
  } else if (yes === 0) {
    console.log('  No full number reconciles with the mask. The unmasked digits found');
    console.log('  are something else — ids, codes — and the real number is NOT in the');
    console.log('  page. Getting it would mean calling the reveal endpoint.');
  } else {
    console.log('  MIXED, so do not generalise from either half. Probe more ads before');
    console.log('  building anything on this.');
  }
  console.log(
    `\n  Still a decision for a person: whether using it is appropriate at all.`,
  );

  await pg.end();
}

const isEntry = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isEntry) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
