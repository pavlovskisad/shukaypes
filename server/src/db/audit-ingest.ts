// WHAT HAPPENED TO THIS AD, AND WHAT GOT PAST US. Read-only.
//
// Two questions from a manual audit of the live base, and they point in
// opposite directions:
//
//   1. A real lost-pet ad on OLX that we never ingested. Did we see it
//      and reject it, or never see it at all? Those have completely
//      different fixes — a filter rule versus listing coverage — and
//      guessing which is how you fix the wrong one.
//
//   2. Rehoming posts sitting in the base as lost pets. The title filter
//      demonstrably catches «віддам», «шукає дім», «в добрі руки», so
//      whatever got through is shaped differently. Reading the actual
//      rows is the only way to know how.
//
// No network, no writes. Everything here comes from rows we already hold.
//
// Usage:
//   fly ssh console -a shukajpes-api -C "node dist/db/audit-ingest.js --id=ID10hIzS"
//   fly ssh console -a shukajpes-api -C "node dist/db/audit-ingest.js --rehoming"

import 'dotenv/config';
import { eq, sql } from 'drizzle-orm';
import { pathToFileURL } from 'url';
import { db, schema, pg } from './index.js';
import { redactContacts } from '../pipeline/redactContacts.js';

// THIS IS THE ONE TOOL HERE THAT ACTUALLY READS AD TEXT. The others only
// ask whether a body exists; this one scans it for rehoming phrasing,
// because that is the question. So everything it PRINTS goes through
// redactContacts first — the scan happens in memory, the output carries
// a matched keyword and a redacted title and nothing else.
//
// Phrases that mean "I am giving this animal away", as opposed to "I have
// lost it". Deliberately WIDER than pipeline/keywords.ts — the point is to
// find what the narrow production rule missed, so a match here is a
// candidate for a human to read, never an automatic verdict.
const REHOMING_HINTS = [
  'віддам', 'віддаю', 'віддамо', 'отдам', 'отдаю', 'отдадим',
  'в добрі руки', 'в хорошие руки', 'у добрі руки',
  'шукає дім', 'шукає родину', 'ищет дом', 'ищет семью',
  'роздаю', 'раздам', 'в дар', 'даром', 'безкоштовно віддам',
  'пристрою', 'прилаштую', 'пристрой', 'притулок шукає',
];

async function auditOne(idToken: string) {
  // Matched on the OLX id token rather than the whole URL: the same ad is
  // reachable as m.olx.ua and www.olx.ua, with or without a tail of
  // recommendation query parameters, and none of that changes which ad it
  // is.
  const rows = await db
    .select({
      url: schema.scrapeLog.url,
      source: schema.scrapeLog.source,
      title: schema.scrapeLog.title,
      dogId: schema.scrapeLog.dogId,
      action: schema.scrapeLog.ingestAction,
      skipReason: schema.scrapeLog.skipReason,
      confidence: schema.scrapeLog.parseConfidence,
      seenAt: schema.scrapeLog.firstSeenAt,
      hasBody: sql<boolean>`${schema.scrapeLog.rawBody} is not null`,
    })
    .from(schema.scrapeLog)
    .where(sql`${schema.scrapeLog.url} ilike ${'%' + idToken + '%'}`);

  console.log(`\nledger rows matching "${idToken}": ${rows.length}`);

  if (rows.length === 0) {
    console.log(
      `\n  NEVER SEEN. This ad is not in scrape_log at all, so no filter\n` +
        `  rejected it — the scraper never had it to reject. That is a\n` +
        `  DISCOVERY gap: none of the listing queries surfaced this ad on the\n` +
        `  page they read. Changing a keyword rule would do nothing.\n\n` +
        `  Look at LISTING_URLS in pipeline/sources/olx.ts against how this\n` +
        `  ad is titled and categorised.`,
    );
    return;
  }

  for (const r of rows) {
    console.log(`\n  ${r.url}`);
    console.log(`    source     : ${r.source}`);
    console.log(`    title      : ${r.title ? redactContacts(r.title) : '(none stored)'}`);
    console.log(`    action     : ${r.action ?? '(none)'}`);
    console.log(`    skipReason : ${r.skipReason ?? '(none)'}`);
    console.log(`    confidence : ${r.confidence ?? '(none)'}`);
    console.log(`    body stored: ${r.hasBody ? 'yes' : 'no'}`);
    console.log(`    first seen : ${r.seenAt.toISOString()}`);
    if (r.dogId) {
      const [pet] = await db
        .select({ name: schema.lostDogs.name, status: schema.lostDogs.status })
        .from(schema.lostDogs)
        .where(eq(schema.lostDogs.id, r.dogId));
      console.log(`    pet        : ${pet ? `${pet.name} (${pet.status})` : 'row is gone'}`);
    } else {
      console.log(`    pet        : none — this ad never became a pet`);
    }
  }
  console.log(
    `\n  SEEN, so this is a FILTER question, not a discovery one. The\n` +
      `  skipReason above says which gate stopped it.`,
  );
}

async function auditRehoming() {
  const pets = await db
    .select({
      id: schema.lostDogs.id,
      name: schema.lostDogs.name,
      urgency: schema.lostDogs.urgency,
      source: schema.lostDogs.source,
    })
    .from(schema.lostDogs)
    .where(eq(schema.lostDogs.status, 'active'));

  const logs = await db
    .select({
      dogId: schema.scrapeLog.dogId,
      title: schema.scrapeLog.title,
      body: schema.scrapeLog.rawBody,
    })
    .from(schema.scrapeLog);

  const byDog = new Map<string, { title: string | null; body: string | null }>();
  for (const l of logs) {
    if (!l.dogId) continue;
    const prev = byDog.get(l.dogId);
    // Prefer the row that actually has text.
    if (!prev || (!prev.body && l.body)) byDog.set(l.dogId, { title: l.title, body: l.body });
  }

  console.log(`\nactive pets: ${pets.length}`);

  const flagged: Array<{ name: string; where: string; hint: string; title: string }> = [];
  let withText = 0;
  for (const p of pets) {
    const rec = byDog.get(p.id);
    const title = rec?.title ?? '';
    const body = rec?.body ?? '';
    if (title || body) withText++;
    const hay = `${title}\n${body}`.toLowerCase();
    const hit = REHOMING_HINTS.find((h) => hay.includes(h));
    if (hit) {
      flagged.push({
        name: p.name,
        where: title.toLowerCase().includes(hit) ? 'TITLE' : 'body',
        hint: hit,
        // Redacted before it can reach a terminal.
        title: redactContacts(title).slice(0, 60),
      });
    }
  }

  if (withText === 0) {
    // A check that read nothing must never be reported as a check that
    // found nothing.
    console.log('\n!! NOT ONE active pet has stored title or body text. This scan read');
    console.log('   nothing, so "0 flagged" below would mean nothing.');
    return;
  }

  console.log(`  … with stored title or body: ${withText}`);
  console.log(`\nlooks like rehoming: ${flagged.length}`);
  for (const f of flagged) {
    console.log(`  [${f.where}] ${f.name.padEnd(22)} «${f.hint}»  ${f.title}`);
  }

  console.log(
    `\n  A hit in the TITLE means the production filter should have caught it\n` +
      `  and did not — check pipeline/keywords.ts against that exact phrasing.\n` +
      `  A hit only in the BODY means the title looked like a lost pet and the\n` +
      `  parser's own rehoming classification is what missed it.\n` +
      `  Neither is a verdict. Read them before changing any rule.`,
  );
}

// IS THE PIPELINE STILL PRODUCING, AND IF NOT, WHERE DOES IT STOP?
//
// The alert says «no new pets for 36.4h» and, in the same breath,
// «olx: 469 found, 0 errors». Those two lines are consistent with two
// completely different worlds:
//
//   QUIET     the 469 are ads we already hold, and Kyiv genuinely did
//             not lose a pet that OLX heard about. Nothing is broken.
//   BLOCKED   new ads ARE arriving and something downstream is refusing
//             every one — a filter, the dedupe, the city gate.
//
// The alert cannot tell them apart, and neither can anybody reading it.
// This can: a scrape_log row is written for EVERY message we look at,
// including the ones we throw away and why. So count rows by the day
// they first appeared, split by what we decided about them.
//
// A day with no new rows at all is the quiet world. A day with new rows
// that all carry a skip_reason is the blocked one, and the reason names
// the culprit.
//
// This distinction has been got wrong here before, in the expensive
// direction: the OLX scraper once reported «discovered 506, skipped 506»
// for days and read as healthy, because every URL it found was already
// known. It had saturated its own listing page and stopped seeing
// anything new. That is exactly the shape this prints.
async function auditRecent(days: number) {
  const rows = await db
    .select({
      day: sql<string>`to_char(${schema.scrapeLog.firstSeenAt}, 'YYYY-MM-DD')`,
      source: sql<string>`split_part(${schema.scrapeLog.source}, ':', 1)`,
      action: schema.scrapeLog.ingestAction,
      reason: schema.scrapeLog.skipReason,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.scrapeLog)
    .where(sql`${schema.scrapeLog.firstSeenAt} > now() - (${days}::int * interval '1 day')`)
    .groupBy(
      sql`to_char(${schema.scrapeLog.firstSeenAt}, 'YYYY-MM-DD')`,
      sql`split_part(${schema.scrapeLog.source}, ':', 1)`,
      schema.scrapeLog.ingestAction,
      schema.scrapeLog.skipReason,
    );

  if (rows.length === 0) {
    console.log(`\n!! NOT ONE ledger row in ${days} days. That is not "a quiet week" —`);
    console.log('   the scraper writes a row for every message it LOOKS at, including');
    console.log('   the ones it rejects. Zero rows means it is not looking.');
    return;
  }

  const byDay = new Map<string, Map<string, number>>();
  const reasons = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.source}/${r.action ?? 'null'}`;
    if (!byDay.has(r.day)) byDay.set(r.day, new Map());
    const d = byDay.get(r.day)!;
    d.set(key, (d.get(key) ?? 0) + r.n);
    if (r.reason) reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + r.n);
  }

  console.log(`\nNEW LEDGER ROWS PER DAY — every message we looked at, last ${days}d\n`);
  for (const day of [...byDay.keys()].sort().reverse()) {
    const d = byDay.get(day)!;
    const total = [...d.values()].reduce((a, b) => a + b, 0);
    const parts = [...d.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k}=${n}`)
      .join('  ');
    console.log(`  ${day}  ${String(total).padStart(4)}   ${parts}`);
  }

  if (reasons.size > 0) {
    console.log('\nWHY THEY WERE THROWN AWAY:');
    for (const [reason, n] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
      console.log(`  ${String(n).padStart(5)}  ${reason}`);
    }
  }

  console.log(
    `\n  A day with NO rows means nothing new was discovered — the quiet world,` +
      `\n  or a scraper that has saturated its own listing page and stopped seeing.` +
      `\n  A day with rows that all carry a reason is the blocked world, and the` +
      `\n  reason above names what did the blocking.`,
  );
}

async function main() {
  const idArg = process.argv.find((a) => a.startsWith('--id='))?.split('=')[1];
  const urlArg = process.argv.find((a) => a.startsWith('--url='))?.split('=')[1];
  const rehoming = process.argv.includes('--rehoming');
  const recentArg = process.argv.find((a) => a === '--recent' || a.startsWith('--recent='));
  const recentDays = recentArg
    ? Number(recentArg.split('=')[1] ?? 7) || 7
    : 0;

  const token = idArg ?? urlArg?.match(/-?(ID[A-Za-z0-9]+)\.html/)?.[1] ?? null;

  if (recentDays > 0) {
    await auditRecent(recentDays);
    await pg.end();
    return;
  }

  if (!token && !rehoming) {
    console.log('pass --id=ID10hIzS, --url=<olx url>, --rehoming, or --recent[=days]');
    await pg.end();
    return;
  }

  if (token) await auditOne(token);
  if (rehoming) await auditRehoming();

  await pg.end();
}

const isEntry = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isEntry) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
