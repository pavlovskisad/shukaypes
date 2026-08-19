// TAKE OLX'S FURNITURE OUT OF THE ADS WE ALREADY STORED.
//
// Every stored body opens with the page's own section labels —
// «Повідомлення», then «Опис» — before it reaches a word the owner
// wrote. They came in with the text because cheerio's .text() cannot
// tell a heading from a sentence, and nobody saw them until PostModal
// put the body on a screen. It is the same class of bug as the
// stylesheet leak: invisible while the column was only ever written.
//
// NO NETWORK. This is a text transform over rows we already hold, using
// exactly the rule the extractor now applies at ingest
// (stripSectionLabelLines) — so a body cleaned here and a body stored
// tomorrow cannot end up shaped differently.
//
// NOT REVERSIBLE, and treated that way. The labels are being deleted
// from the stored copy; there is no column keeping the original. That is
// fine — they are two words of OLX chrome, reproducible by re-fetching
// the ad — but it is why the dry run prints exactly what would come off
// each row and why nothing runs without --apply.
//
// WHAT IT PRINTS. Only the removed text and a pet name. The removed text
// is a section label by construction, and the whole point of the rule is
// that it never matches anything else — but it goes through
// redactContacts anyway, because a printer that assumes its input is
// safe is how contacts end up in a transcript.
//
// Usage:
//   fly ssh console -a shukajpes-api -C "node dist/db/clean-ad-bodies.js"
//   fly ssh console -a shukajpes-api -C "node dist/db/clean-ad-bodies.js --apply"

import 'dotenv/config';
import { eq, isNotNull } from 'drizzle-orm';
import { pathToFileURL } from 'url';
import { db, schema, pg } from './index.js';
import { stripSectionLabelLines } from '../pipeline/sources/adHtml.js';
import { redactContacts } from '../pipeline/redactContacts.js';

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(apply ? '▶ APPLY — writes are real' : '▶ dry run — pass --apply to write');

  const rows = await db
    .select({
      url: schema.scrapeLog.url,
      dogId: schema.scrapeLog.dogId,
      body: schema.scrapeLog.rawBody,
    })
    .from(schema.scrapeLog)
    .where(isNotNull(schema.scrapeLog.rawBody));

  if (rows.length === 0) {
    // A check that read nothing must never be reported as a check that
    // found nothing.
    console.log('\n!! NOT ONE stored body. This read nothing — confirm which database');
    console.log('   before taking "no labels found" as good news.');
    await pg.end();
    return;
  }

  const names = new Map<string, string>();
  for (const d of await db
    .select({ id: schema.lostDogs.id, name: schema.lostDogs.name })
    .from(schema.lostDogs)) {
    names.set(d.id, d.name);
  }

  const dirty: { url: string; name: string; removed: string; before: number; after: number }[] = [];

  for (const r of rows) {
    const before = r.body!;
    const after = stripSectionLabelLines(before);
    if (after === before) continue;

    // The difference, line by line, so the dry run shows what leaves
    // rather than asking anyone to trust a count.
    const keep = new Set(after.split('\n'));
    const removed = before
      .split('\n')
      .filter((l) => l.trim() !== '' && !keep.has(l) && !keep.has(l.trimStart()))
      .map((l) => l.trim())
      .join(' | ');

    dirty.push({
      url: r.url,
      name: (r.dogId && names.get(r.dogId)) || '—',
      removed,
      before: before.length,
      after: after.length,
    });
  }

  console.log(`\nstored bodies:            ${rows.length}`);
  console.log(`  … carrying labels:      ${dirty.length}`);
  console.log(`  … already clean:        ${rows.length - dirty.length}`);

  // WHAT THE STRIP DOES NOT REACH.
  //
  // The line rule only fires on a line that IS a label. A label welded
  // to the front of the description («Опис Пропав кіт…») or sitting
  // mid-sentence is left alone on purpose — that is the guard that stops
  // this pass eating somebody's words. But "left alone on purpose" and
  // "not there" look identical in a diff of what was removed, and the
  // first run showed only «Повідомлення» coming off, from every row,
  // while «Опис» was reported as present by the person reading the app.
  //
  // So count what SURVIVES, per label. A number here is the difference
  // between "we handled it" and "we handled one of them".
  console.log('\nstill present after the strip (anywhere in the text):');
  const survivors = new Map<string, string[]>();
  for (const label of ['Повідомлення', 'Опис', 'Сообщение', 'Описание']) {
    const hits = rows.map((r) => stripSectionLabelLines(r.body!)).filter((t) => t.includes(label));
    survivors.set(label, hits);
    console.log(`  ${label.padEnd(14)} ${String(hits.length).padStart(4)} / ${rows.length}`);
  }

  // WHERE a survivor sits decides what to do about it, and the two cases
  // want OPPOSITE treatment: a label at the start of a line is furniture
  // the rule declined to take (some boundary it does not yet know), while
  // a label inside a sentence is the owner's own word and must be left
  // alone forever. A count cannot tell them apart. This prints the
  // neighbourhood so a human can.
  //
  // ⏎ marks a newline, so "line start" is visible rather than inferred.
  // Redacted, like everything else this file prints.
  for (const [label, hits] of survivors) {
    if (hits.length === 0) continue;
    console.log(`\n  where «${label}» still sits (${Math.min(hits.length, 10)} of ${hits.length}):`);
    for (const text of hits.slice(0, 10)) {
      const at = text.indexOf(label);
      const window = text.slice(Math.max(0, at - 14), at + label.length + 26);
      const atLineStart = at === 0 || text[at - 1] === '\n';
      console.log(
        `    ${atLineStart ? 'LINE START' : 'mid-text  '}  …${redactContacts(window).replace(/\n/g, '⏎')}…`,
      );
    }
  }

  if (dirty.length === 0) {
    console.log('\n✓ nothing to clean.');
    await pg.end();
    return;
  }

  const chars = dirty.reduce((n, d) => n + (d.before - d.after), 0);
  console.log(`\nWHAT COMES OFF (${chars} chars across ${dirty.length} bodies):\n`);
  for (const d of dirty.slice(0, 25)) {
    console.log(`  ${d.name.padEnd(24)} −${String(d.before - d.after).padStart(3)}  ${redactContacts(d.removed).slice(0, 60)}`);
  }
  if (dirty.length > 25) console.log(`  … and ${dirty.length - 25} more`);

  if (!apply) {
    console.log('\n✓ dry run, nothing written.');
    console.log(`  --apply rewrites ${dirty.length} stored body/bodies. Read the list above first —`);
    console.log('  the original text is not kept anywhere, so this one does not undo.');
    await pg.end();
    return;
  }

  for (const d of dirty) {
    const row = rows.find((r) => r.url === d.url)!;
    await db
      .update(schema.scrapeLog)
      .set({ rawBody: stripSectionLabelLines(row.body!) })
      .where(eq(schema.scrapeLog.url, d.url));
  }

  console.log(`\n  ${dirty.length} body/bodies cleaned, ${chars} chars of OLX chrome removed.`);
  console.log('  New ads arrive clean — the extractor applies the same rule at ingest.');
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
