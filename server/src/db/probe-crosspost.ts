// PICK A PHRASE WE COULD LOOK FOR ELSEWHERE ON THE INTERNET.
//
// THE IDEA BEING TESTED, which is the owner's: a person writing about
// their missing animal writes it once and pastes it everywhere. OLX
// masks the phone number on its own page; a Telegram channel or a forum
// does not. If the same text is findable somewhere that never masked it,
// the number is readable there — published by the owner, in the clear,
// for exactly the purpose of being rung about their pet.
//
// This does not do the searching. It chooses what to search for, which
// is the part that needs care, and prints it for a human to run.
//
// WHAT MAKES A PHRASE USABLE, and every rule here is a way of not
// causing harm rather than a way of getting a hit:
//
//   NO DIGITS.       A sentence with numbers in it is a date, an address
//                    or the remains of a phone number. Searching those
//                    puts fragments of somebody's contact into a query
//                    log at a company neither we nor they chose.
//   LONG ENOUGH.     Under ~40 characters it is boilerplate —
//                    «допоможіть знайти», «винагорода» — and boilerplate
//                    matches strangers. The census found two unrelated
//                    pets whose descriptions overlap 80%, which is that
//                    risk arriving unprompted.
//   ONE SENTENCE.    Enough to be distinctive, short enough that a
//                    repost that gained a line still contains it.
//
// A WRONG MATCH IS WORSE THAN NO MATCH. It does not leave us without a
// number, it attaches the WRONG person's number to a pet, and a walker
// rings a stranger about an animal they never lost. Everything above is
// in service of that, and it is why the phrase is printed for a human
// rather than fed into anything automatically.
//
// Redacted on the way out regardless, and masked ads only — those are
// the pets where finding the original elsewhere would actually pay.
//
// Usage:
//   fly ssh console -a shukajpes-api -C "node dist/db/probe-crosspost.js"
//   fly ssh console -a shukajpes-api -C "node dist/db/probe-crosspost.js --count=6"

import 'dotenv/config';
import { eq, isNotNull } from 'drizzle-orm';
import { pathToFileURL } from 'url';
import { db, schema, pg } from './index.js';
import {
  looksLikeSourceMaskedContact,
  redactContacts,
} from '../pipeline/redactContacts.js';

const MIN_PHRASE = 40;
const MAX_PHRASE = 140;
const MIN_WORDS = 6;

function searchablePhrase(body: string): string | null {
  const candidates = body
    .split(/[\n.!?]+/)
    .map((s) => s.trim())
    .filter(
      (s) =>
        s.length >= MIN_PHRASE &&
        s.length <= MAX_PHRASE &&
        !/\d/.test(s) &&
        s.split(/\s+/).length >= MIN_WORDS,
    );
  if (candidates.length === 0) return null;
  // Longest wins: more words is more distinctive, which is the whole
  // defence against matching a stranger's ad.
  return candidates.sort((a, b) => b.length - a.length)[0]!;
}

async function main() {
  const raw = process.argv.find((a) => a.startsWith('--count='));
  const count = raw ? Number(raw.split('=')[1]) : 4;

  const rows = await db
    .select({
      body: schema.scrapeLog.rawBody,
      dogId: schema.scrapeLog.dogId,
      name: schema.lostDogs.name,
      status: schema.lostDogs.status,
    })
    .from(schema.scrapeLog)
    .innerJoin(schema.lostDogs, eq(schema.scrapeLog.dogId, schema.lostDogs.id))
    .where(isNotNull(schema.scrapeLog.rawBody));

  if (rows.length === 0) {
    console.log('!! NOT ONE stored body. This read nothing — confirm which database.');
    await pg.end();
    return;
  }

  const masked = rows.filter((r) => r.status === 'active' && looksLikeSourceMaskedContact(r.body!));

  console.log(`\nactive pets whose ad carries OLX's mask: ${masked.length}`);

  const picked: { name: string; phrase: string }[] = [];
  let noPhrase = 0;
  for (const r of masked) {
    const phrase = searchablePhrase(r.body!);
    if (!phrase) {
      noPhrase++;
      continue;
    }
    if (picked.length < count) picked.push({ name: r.name, phrase: redactContacts(phrase) });
  }

  console.log(`  … with a usable search phrase:        ${masked.length - noPhrase}`);
  console.log(`  … too short, or all digits:           ${noPhrase}`);

  if (picked.length === 0) {
    console.log('\n!! NO PHRASE PASSED THE RULES. Not "no cross-posts" — nothing was');
    console.log('   even eligible to look for. Do not read this as a negative result.');
    await pg.end();
    return;
  }

  console.log(`\nPHRASES TO SEARCH FOR (${picked.length}) — exact-phrase, quoted:\n`);
  for (const p of picked) {
    console.log(`  ${p.name}`);
    console.log(`    "${p.phrase}"\n`);
  }

  console.log(
    `  A hit means the same post exists somewhere that did not mask the` +
      `\n  number. A near-hit means nothing — two lost-pet ads share a lot of` +
      `\n  wording, and the wrong number attached to a pet is worse than none.` +
      `\n\n✓ read-only, nothing written, no contact printed.`,
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
