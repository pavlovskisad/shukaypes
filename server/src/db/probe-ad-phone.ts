// CAN WE READ THE OWNER'S PHONE NUMBER AT ALL? A read-only probe.
//
// OLX prints the number masked — «т.05*******62» — and reveals it when a
// human taps. So the bodies we store carry the mask, which means the
// app's contacts-after-sighting promise currently delivers asterisks. The
// owner asked whether the real number can be shown in-app; this answers
// whether that is even mechanically possible before anybody builds it.
//
// IT REPORTS STRUCTURE, NEVER VALUES. If it finds something phone-shaped
// it prints the SHAPE — which key, how long, where it came from — and
// masks the digits. A diagnostic that spills contact details into a log
// line has created the exposure it was investigating, and these logs are
// read over somebody's shoulder in a terminal.
//
// One ad per run, no writes, no loops. HANDOFF §5 records ~23 hand-probes
// against OLX as a mistake worth remembering; this is deliberately the
// smallest thing that can answer the question.
//
// WHAT IT CANNOT TELL YOU, and this is the part for a human: whether
// using the answer is a good idea. Revealing on tap is a deliberate
// anti-scraping measure, and routing around it at ingest is a different
// act from reading a page that is already public. That is the owner's
// call and their relationship with OLX, not a thing a script decides.
//
// Usage:
//   fly ssh console -a shukajpes-api -C "node dist/db/probe-ad-phone.js"
//   fly ssh console -a shukajpes-api -C "node dist/db/probe-ad-phone.js --url=https://..."

import 'dotenv/config';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { pathToFileURL } from 'url';
import { db, schema, pg } from './index.js';
import { scrapeFetch } from '../lib/scrapeFetch.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36';

/** Digits become •, so a finding can be reported without being disclosed. */
function shape(value: string): string {
  return value.replace(/\d/g, '•');
}

async function main() {
  const urlArg = process.argv.find((a) => a.startsWith('--url='));
  let url = urlArg?.split('=')[1] ?? null;

  if (!url) {
    // Any live ad of an active pet will do — we are asking about OLX's
    // page structure, not about this particular animal.
    const [row] = await db
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
      .limit(1);
    url = row?.url ?? null;
  }

  if (!url) {
    console.log('!! no candidate ad found — nothing was probed, which is not');
    console.log('   the same as "no phone available". Pass --url= explicitly.');
    await pg.end();
    return;
  }

  console.log(`probing ONE ad: ${url}\n`);

  const res = await scrapeFetch(url, {
    headers: { 'user-agent': UA, 'accept-language': 'uk-UA,uk;q=0.9,en;q=0.6' },
    retryOnBlock: true,
  });

  if (!res.ok) {
    // Loudly, because a refused probe says nothing about phones.
    console.log(`!! HTTP ${res.status} after ${res.attempts} attempt(s).`);
    console.log('   This probe READ NOTHING. It is not evidence either way.');
    await pg.end();
    return;
  }

  const html = res.body;
  console.log(`page: ${html.length} chars\n`);

  // 1. Is a masked number present, and in what form?
  const masked = html.match(/[\d+][\d\s\-()]*\*{2,}[\d\s\-()]*\d/g) ?? [];
  console.log(`masked numbers in the HTML: ${masked.length}`);
  for (const m of [...new Set(masked)].slice(0, 5)) {
    console.log(`   shape: ${shape(m).slice(0, 40)}`);
  }

  // 2. Is a FULL number sitting in the markup anyway? If the page already
  //    ships it, there is nothing to route around and the answer is easy.
  const full = html.match(/(?:\+?38)?0\d{9}\b/g) ?? [];
  const uniqueFull = [...new Set(full)];
  console.log(`\nunmasked 12/10-digit numbers already in the page: ${uniqueFull.length}`);
  for (const f of uniqueFull.slice(0, 5)) console.log(`   shape: ${shape(f)}`);

  // 3. What would a reveal call even look like? Report the KEYS that
  //    mention a phone and any same-origin path that does, so a human can
  //    judge. No values.
  const keys = [...new Set(html.match(/"[A-Za-z_]*[Pp]hone[A-Za-z_]*"/g) ?? [])];
  console.log(`\nphone-ish JSON keys present: ${keys.length}`);
  for (const k of keys.slice(0, 12)) console.log(`   ${k}`);

  const paths = [...new Set(html.match(/\/api\/[A-Za-z0-9/_{}$.-]*phone[A-Za-z0-9/_{}$.-]*/gi) ?? [])];
  console.log(`\napi paths mentioning phone: ${paths.length}`);
  for (const p of paths.slice(0, 8)) console.log(`   ${p}`);

  // 4. Does the page carry an offer id? Any reveal endpoint would key on
  //    one, and its absence would end the question.
  const ids = [...new Set(html.match(/"id":\s*"?\d{6,}"?/g) ?? [])].slice(0, 3);
  console.log(`\nnumeric ids present: ${ids.length ? ids.map(shape).join(', ') : 'none found'}`);

  console.log(
    `\n---\nWhat this does NOT settle: whether calling any such endpoint is\n` +
      `appropriate. Revealing on tap is an anti-scraping measure, and\n` +
      `routing around it at ingest is a different act from reading a public\n` +
      `page. That is a decision for a person.`,
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
