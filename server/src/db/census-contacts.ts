// HOW MUCH OWNER CONTACT DO WE ACTUALLY HOLD? A read-only census.
//
// The question came from a walk: report a sighting, open the ad, still
// see «09******65». Whose mask is that, and how often does a walker who
// has earned the contact get a number they can actually ring?
//
// The mechanism is known — OLX masks on its own page and we store the
// page verbatim, so the digits were never ours — but "how often" is a
// distribution, and this project has a history of confident answers that
// were reasoned instead of counted. So count.
//
// THREE BUCKETS, and they are what a walker experiences:
//
//   readable   a full number, e-mail or handle survives in the body.
//              The walker reports, opens the ad, and can ring somebody.
//   masked     the body carries OLX's own mask and nothing readable.
//              The walker reports, opens the ad, sees stars, and needs
//              the «оригінал» button and one more tap.
//   none       no contact of any kind in the text. The ad is a
//              description; the phone lives in OLX's contact panel,
//              which is not part of the page body at all.
//
// VALUES NEVER LEAVE THIS PROCESS. It prints counts and nothing else —
// no bodies, no fragments, not even a redacted window. A census does not
// need to show you a phone number to tell you how many there are, and
// these logs get read over somebody's shoulder.
//
// Usage:
//   fly ssh console -a shukajpes-api -C "node dist/db/census-contacts.js"

import 'dotenv/config';
import { eq, isNotNull } from 'drizzle-orm';
import { pathToFileURL } from 'url';
import { db, schema, pg } from './index.js';
import {
  looksLikeItHadContacts,
  looksLikeSourceMaskedContact,
} from '../pipeline/redactContacts.js';

async function main() {
  const rows = await db
    .select({
      body: schema.scrapeLog.rawBody,
      dogId: schema.scrapeLog.dogId,
    })
    .from(schema.scrapeLog)
    .where(isNotNull(schema.scrapeLog.rawBody));

  if (rows.length === 0) {
    // A check that read nothing must never be reported as a check that
    // found nothing.
    console.log('!! NOT ONE stored body. This read nothing — confirm which database');
    console.log('   before reading any of these numbers.');
    await pg.end();
    return;
  }

  // Only ACTIVE pets are reachable in the app, so the walker-facing
  // number is the one that counts. The whole corpus is reported beside
  // it so the two cannot be quietly conflated.
  const active = new Set(
    (
      await db
        .select({ id: schema.lostDogs.id })
        .from(schema.lostDogs)
        .where(eq(schema.lostDogs.status, 'active'))
    ).map((d) => d.id),
  );

  const tally = { readable: 0, masked: 0, none: 0 };
  const tallyActive = { readable: 0, masked: 0, none: 0 };

  for (const r of rows) {
    const body = r.body!;
    // Readable wins over masked: an ad can carry both — one number
    // masked in the contact line, another typed out in the description —
    // and if anything is ringable the walker is not stuck.
    const bucket = looksLikeItHadContacts(body)
      ? 'readable'
      : looksLikeSourceMaskedContact(body)
        ? 'masked'
        : 'none';
    tally[bucket]++;
    if (r.dogId && active.has(r.dogId)) tallyActive[bucket]++;
  }

  // DO OWNERS ACTUALLY COPY-PASTE? The premise behind looking for the
  // same text elsewhere on the internet is that a person writing about
  // their missing animal writes it ONCE and pastes it everywhere. If
  // that is true, the copy on a platform that does not mask numbers
  // carries the contact the masked copy hides.
  //
  // The premise is testable without a search engine, on rows we already
  // hold: if people paste verbatim, the same text should already appear
  // at more than one URL in this table.
  //
  // WHAT A POSITIVE RESULT HERE DOES AND DOES NOT MEAN. Our corpus is
  // one source, so a match is one owner reposting on OLX — evidence
  // that the copy-paste HABIT is real, not that it crosses platforms.
  // The cross-platform claim needs a second source in the table before
  // it can be measured at all, and saying otherwise would be exactly the
  // reasoned-instead-of-counted mistake this file exists to avoid.
  //
  // Word-set Jaccard rather than string equality: a repost usually gains
  // «АКТУАЛЬНО» or loses a line, and an exact-match test would score
  // that as unrelated. 202 bodies is 20k comparisons — nothing.
  const norm = (t: string) =>
    new Set(
      t
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2),
    );

  const SIMILAR = 0.8;
  const shaped = rows.map((r) => ({ ...r, words: norm(r.body!) }));
  let pairs = 0;
  let pairsSameDog = 0;
  let pairsContactDiffers = 0;

  for (let i = 0; i < shaped.length; i++) {
    for (let j = i + 1; j < shaped.length; j++) {
      const a = shaped[i]!;
      const b = shaped[j]!;
      if (a.words.size === 0 || b.words.size === 0) continue;
      let shared = 0;
      for (const w of a.words) if (b.words.has(w)) shared++;
      const jaccard = shared / (a.words.size + b.words.size - shared);
      if (jaccard < SIMILAR) continue;
      pairs++;
      if (a.dogId && a.dogId === b.dogId) pairsSameDog++;
      // The payoff case: two copies of one post where ONE of them has a
      // number you could ring. That is the whole idea, demonstrated.
      const readableA = looksLikeItHadContacts(a.body!);
      const readableB = looksLikeItHadContacts(b.body!);
      if (readableA !== readableB) pairsContactDiffers++;
    }
  }

  const pct = (n: number, of: number) => (of === 0 ? '—' : `${Math.round((n / of) * 100)}%`);
  const line = (label: string, n: number, of: number) =>
    `  ${label.padEnd(10)} ${String(n).padStart(4)}  ${pct(n, of).padStart(4)}`;

  const activeTotal = tallyActive.readable + tallyActive.masked + tallyActive.none;

  console.log(`\nSTORED BODIES ON ACTIVE PETS — what a walker can reach: ${activeTotal}`);
  console.log(line('readable', tallyActive.readable, activeTotal));
  console.log(line('masked', tallyActive.masked, activeTotal));
  console.log(line('none', tallyActive.none, activeTotal));

  console.log(`\nWHOLE CORPUS, active and expired: ${rows.length}`);
  console.log(line('readable', tally.readable, rows.length));
  console.log(line('masked', tally.masked, rows.length));
  console.log(line('none', tally.none, rows.length));

  console.log(`\nDUPLICATED TEXT — do owners paste the same post twice?`);
  console.log(`  near-identical pairs (≥${SIMILAR * 100}% word overlap): ${pairs}`);
  console.log(`    … already merged onto one pet:                ${pairsSameDog}`);
  console.log(`    … where one copy has a ringable contact:      ${pairsContactDiffers}`);

  console.log(
    `\n  readable = a walker who reported a sighting can ring somebody.` +
      `\n  masked   = OLX masked it on its own page; the digits were never ours.` +
      `\n  none     = no contact in the ad text at all.` +
      `\n\n  The pair count is WITHIN ONE SOURCE. It can show that reposting is a` +
      `\n  habit; it cannot show that the habit crosses platforms, because there` +
      `\n  is only one platform in this table. That needs a second source before` +
      `\n  it is a question the database can answer.` +
      `\n\n✓ counts only, nothing written and no value printed.`,
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
