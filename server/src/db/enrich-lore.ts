// Give the lore corpus its "read more".
//
// seed-lore.ts wrote every kyiv_lore row with one dog-voice sentence and
// a Wikipedia handle IF the OSM object carried a `wikipedia=` tag.
// Measured against the seed's own Overpass population, that is 8% of
// rows; another 1% carry a `wikidata=` tag; the other 90% carry neither.
// So most "read more" taps end in the dog shrugging — and for a third
// of THOSE rows the mapper had written down what the plaque says and
// whom it is for, in tags the seed never read past `name`. This pass
// reads them, in three phases that can run together or apart:
//
//   osm     Re-fetch the Overpass population and store each row's
//           LoreFacts (inscription, description, date, subject,
//           artist… — services/overpass.ts). Only rows with no facts
//           yet; the seed writes facts itself from now on.
//
//   links   For every row without a Wikipedia handle, in order of
//           certainty, first hit wins. Yields below are measured against
//           the September population (2666 rows, 2440 unlinked); the
//           sampled tiers were read match by match:
//             wikidata   `wikidata=` → the entity's own sitelinks.
//                        The mapper said this object IS this entity.
//                        +24 rows.
//             subject    `subject:wikipedia` / `subject:wikidata` → the
//                        article about what the memorial is FOR. The
//                        plaque is not the person, and the writer is
//                        told so; but the person is the story.
//                        +122 rows.
//             title      A name that reads as a person's name
//                        ("Купрін Олександр Іванович") looked up as an
//                        article title, redirects followed. 70 of 120
//                        sampled proper names resolved, all correctly;
//                        ~+316 rows. The guard is that only proper
//                        names are looked up.
//             geosearch  The uk.wikipedia article geotagged within
//                        GEOSEARCH_RADIUS_M, matched by NAME through
//                        services/loreMatch.ts. Fuzzy by construction:
//                        5 of 150 sampled, all plausible; ~+58 rows.
//           Every handle is stamped with its source in wiki_source, so
//           a fuzzier tier can be audited or reverted as a group:
//             UPDATE kyiv_lore SET wikipedia_title = NULL,
//               source_lang = NULL, wiki_source = NULL, detail = NULL,
//               detail_at = NULL WHERE wiki_source = 'geosearch';
//
//   detail  For every row with research — an article, or facts with
//           substance (an inscription, a description, a subject) — and
//           no `detail` yet: have the model write the dog's longer
//           telling (2-4 sentences). Rows whose one-liner was written
//           before they had any research get it rewritten too, and
//           last_rewrote_at moves.
//
// Dry by default. `--apply` writes. The dry run prints one line per row
// with what the apply would do, and the cost it would spend, and is
// meant to be read before the apply — same shape as clean:lost-dogs.
//
// The phases feed each other: links reads the facts osm wrote, detail
// reads both. In a dry run nothing is written, so each phase carries
// its plan forward IN MEMORY and the next phase reads the row as it
// WOULD be. The first production dry run did not, and reported the
// subject tier as 0 and the detail phase as 226 rows for $1.36; the
// apply then found 122 and 1155. A dry run that under-reports is the
// kind of check this project's CLAUDE.md warns about.
//
// Usage:
//   pnpm --filter @shukajpes/server enrich:lore                 # dry, all phases
//   pnpm --filter @shukajpes/server enrich:lore -- --apply
//   pnpm --filter @shukajpes/server enrich:lore -- --only links --apply
//   pnpm --filter @shukajpes/server enrich:lore -- --only detail --limit 50
//   pnpm --filter @shukajpes/server enrich:lore -- --id osm:node:123 --apply
//   production: fly ssh console -a shukajpes-api -C "node dist/db/enrich-lore.js --apply"
//
// Idempotent: osm only touches rows with no facts, links only rows with
// no handle, detail only rows with no detail. A re-run after a crash
// picks up where it stopped.
//
// Cost. osm and links are free (Overpass and Wikimedia, anonymous,
// paced). Detail is one model call per row — see WRITER_MODEL and
// EST_USD_PER_DETAIL; the dry run multiplies that out for you.

import 'dotenv/config';
import { and, eq, isNull, isNotNull, or, sql } from 'drizzle-orm';
import { pathToFileURL } from 'url';
import { db, schema, pg } from './index.js';
import { anthropic } from '../services/anthropic.js';
import { looksLikeProperName, pickGeoMatch } from '../services/loreMatch.js';
import { parseWriter, type Written } from '../services/loreWriter.js';
import {
  factsCarryResearch,
  factsFromTags,
  factsLines,
  fetchLoreElements,
  type LoreFacts,
} from '../services/overpass.js';
import {
  fetchWikidataDesc,
  fetchWikidataLinks,
  fetchWikipediaSummary,
  geosearchWikipedia,
  resolveWikipediaTitle,
  type WikiSummary,
} from '../services/wikiResearch.js';

// How far from the landmark a geotagged article may sit and still be
// offered to the name matcher. Wikipedia geotags are the article's own
// idea of where the thing is — a church tagged at its altar, a plaque
// at the building's entrance — so this is slack for that, not a search
// radius. Past ~150 m the pool starts including the next street.
const GEOSEARCH_RADIUS_M = 150;

// The writer. Not ACTIVE_MODEL: that is Opus, chosen for live wit in a
// conversation the human reads back. This is a batch of a couple of
// thousand short paragraphs, and Sonnet wrote the whole corpus's one-
// liners in the first place. Overridable with --model.
const WRITER_MODEL = 'claude-sonnet-4-6';
// Rough per-row spend at Sonnet prices: ~900 input tokens (research +
// cached system) and ~250 output.
const EST_USD_PER_DETAIL = 0.006;

// Same filter the readers apply: a row whose name has no letters is
// never surfaced, so never worth researching.
const HAS_A_LETTER = sql`name ~ '[[:alpha:]]'`;

type WikiSource = 'wikidata' | 'subject' | 'title' | 'geosearch';

const WRITER_SYSTEM = `you are шукайпес — a dog walking around Kyiv with your human. offline writing task: given a Kyiv place and a research blob, write two things in ukrainian, in your usual dog-voice.

"detail" — what you'd tell the human if they stopped and said "wait, tell me more about this one". two to four short sentences, 30-90 words total — shorter when the research is thin, never padded. pick the most interesting concrete beats in the research: who, when, what happened here, what's odd or lovely about it. lowercase, proper nouns capitalised normally. no markdown, no lists, no emojis, no "wikipedia", no "according to", no "source". one small dog gesture in *asterisks* at most, and not at the start of every sentence.

"story" — ONE sentence, max 25 words, same voice: a small observation, a sniff, a thought. never "this is", never "here we have".

facts come ONLY from the research. never invent names, dates, numbers or events.

the research says how the article relates to the place — read the "article is about" line:
- "this place itself": tell it straight.
- "the person or event this memorial is for": the plaque/monument is not the person. say who they were and why a plaque is here (the inscription usually says); don't describe the person as if they were the object.
- "the nearest article on record, matched by name": it may be the building the plaque hangs on or the ensemble the object is part of — say it that way; don't claim the plaque is the building.
an inscription is public text on a wall; you may paraphrase or quote a phrase of it.

answer with JSON only, no prose around it: {"story": "...", "detail": "..."}`;

interface Args {
  apply: boolean;
  only: 'osm' | 'links' | 'detail' | null;
  limit: number;
  id: string | null;
  model: string;
}

function parseArgs(argv: string[]): Args {
  const flag = (name: string): string | null => {
    const i = argv.indexOf(name);
    return i >= 0 ? (argv[i + 1] ?? null) : null;
  };
  const only = flag('--only');
  if (only && only !== 'osm' && only !== 'links' && only !== 'detail') {
    throw new Error(`--only must be osm, links or detail, got ${only}`);
  }
  return {
    apply: argv.includes('--apply'),
    only: (only as Args['only']) ?? null,
    limit: parseInt(flag('--limit') ?? '0', 10) || 0,
    id: flag('--id'),
    model: flag('--model') ?? WRITER_MODEL,
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- phase: osm ----------------------------------------------------------

// The facts this phase writes (or, dry, would write), by row id, so the
// later phases can see them either way.
type PendingFacts = Map<string, LoreFacts>;

async function phaseOsm(args: Args): Promise<PendingFacts> {
  const pending: PendingFacts = new Map();
  const rows = await db
    .select({ id: schema.kyivLore.id, name: schema.kyivLore.name })
    .from(schema.kyivLore)
    .where(and(isNull(schema.kyivLore.facts), args.id ? eq(schema.kyivLore.id, args.id) : undefined))
    .orderBy(schema.kyivLore.id)
    .limit(args.limit || 100_000);
  console.log(`\n▶ osm — ${rows.length} rows without facts`);
  if (rows.length === 0) return pending;

  const elements = await fetchLoreElements();
  const byId = new Map<string, LoreFacts>();
  for (const el of elements) {
    const f = factsFromTags(el.tags ?? {});
    if (f) byId.set(`osm:${el.type}:${el.id}`, f);
  }
  const found = rows.filter((r) => byId.has(r.id));
  for (const r of found) pending.set(r.id, byId.get(r.id)!);
  const withResearch = found.filter((r) => factsCarryResearch(byId.get(r.id)!));
  console.log(
    `  ${found.length} of ${rows.length} rows carry facts on OSM; ${withResearch.length} of those carry an inscription, description or subject`,
  );
  for (const r of found.slice(0, args.apply ? 0 : 25)) {
    const f = byId.get(r.id)!;
    console.log(`  [dry] ${r.name}: ${Object.keys(f).join('+')}${f.inscription ? ` — "${f.inscription.slice(0, 80)}"` : ''}`);
  }
  if (!args.apply) {
    console.log(`  (dry) would write facts for ${found.length} rows`);
    return pending;
  }
  for (const r of found) {
    await db.update(schema.kyivLore).set({ facts: byId.get(r.id)! }).where(eq(schema.kyivLore.id, r.id));
  }
  console.log(`  ✓ wrote facts for ${found.length} rows`);
  return pending;
}

// ---- phase: links --------------------------------------------------------

interface LinkPlan {
  id: string;
  name: string;
  title: string;
  lang: 'uk' | 'en';
  source: WikiSource;
  // Geosearch only.
  score?: number;
  distM?: number;
}

type PendingLinks = Map<string, LinkPlan>;

async function phaseLinks(args: Args, pendingFacts: PendingFacts): Promise<PendingLinks> {
  const stored = await db
    .select({
      id: schema.kyivLore.id,
      name: schema.kyivLore.name,
      nameEn: schema.kyivLore.nameEn,
      category: schema.kyivLore.category,
      lat: schema.kyivLore.lat,
      lng: schema.kyivLore.lng,
      wikidataId: schema.kyivLore.wikidataId,
      facts: schema.kyivLore.facts,
    })
    .from(schema.kyivLore)
    .where(
      and(
        isNull(schema.kyivLore.wikipediaTitle),
        HAS_A_LETTER,
        args.id ? eq(schema.kyivLore.id, args.id) : undefined,
      ),
    )
    .orderBy(schema.kyivLore.id)
    .limit(args.limit || 100_000);
  // Each row as it will be once the osm phase's writes land.
  const rows = stored.map((r) => ({ ...r, facts: r.facts ?? pendingFacts.get(r.id) ?? null }));
  console.log(`\n▶ links — ${rows.length} rows without a Wikipedia handle`);

  const plans = new Map<string, LinkPlan>();
  const tally: Record<WikiSource, number> = { wikidata: 0, subject: 0, title: 0, geosearch: 0 };
  const plan = (p: LinkPlan) => {
    plans.set(p.id, p);
    tally[p.source]++;
  };

  // Tier 1 + 2a: every Wikidata entity we know of, one batched call.
  const qids = new Set<string>();
  for (const r of rows) {
    if (r.wikidataId) qids.add(r.wikidataId);
    if (r.facts?.subjectWikidata) qids.add(r.facts.subjectWikidata);
  }
  const links = await fetchWikidataLinks([...qids]);
  const pickLink = (qid: string | null | undefined): { title: string; lang: 'uk' | 'en' } | null => {
    const l = qid ? links.get(qid) : null;
    if (!l) return null;
    if (l.ukwiki) return { title: l.ukwiki, lang: 'uk' };
    if (l.enwiki) return { title: l.enwiki, lang: 'en' };
    return null;
  };
  for (const r of rows) {
    const own = pickLink(r.wikidataId);
    if (own) {
      plan({ id: r.id, name: r.name, ...own, source: 'wikidata' });
      continue;
    }
    // subject:wikipedia is the mapper's explicit link; subject:wikidata
    // the entity behind it. Either is the article about the subject.
    const sw = r.facts?.subjectWikipedia;
    if (sw && (sw.lang === 'uk' || sw.lang === 'en')) {
      plan({ id: r.id, name: r.name, title: sw.title, lang: sw.lang, source: 'subject' });
      continue;
    }
    const subj = pickLink(r.facts?.subjectWikidata);
    if (subj) plan({ id: r.id, name: r.name, ...subj, source: 'subject' });
  }
  console.log(`  wikidata: ${tally.wikidata}, subject: ${tally.subject} (from ${qids.size} entities)`);

  // Tier 3: proper names as article titles.
  const remaining = rows.filter((r) => !plans.has(r.id));
  const named = remaining.filter((r) => looksLikeProperName(r.name));
  let n = 0;
  for (const r of named) {
    n++;
    const title = await resolveWikipediaTitle('uk', r.name);
    if (title) plan({ id: r.id, name: r.name, title, lang: 'uk', source: 'title' });
    if (n % 100 === 0) console.log(`  title lookups: ${n}/${named.length}…`);
    await sleep(100);
  }
  console.log(`  title: ${tally.title} of ${named.length} proper-name rows have an article under their name`);

  // Tier 4: geosearch + name match, one call a row.
  const rest = rows.filter((r) => !plans.has(r.id));
  n = 0;
  for (const r of rest) {
    n++;
    const cands = await geosearchWikipedia('uk', r.lat, r.lng, GEOSEARCH_RADIUS_M);
    const m = pickGeoMatch({ name: r.name, nameEn: r.nameEn, category: r.category }, cands);
    if (m) {
      plan({
        id: r.id,
        name: r.name,
        title: m.title,
        lang: 'uk',
        source: 'geosearch',
        score: m.score,
        distM: Math.round(m.dist),
      });
    }
    if (n % 100 === 0) console.log(`  geosearch: ${n}/${rest.length}…`);
    await sleep(120);
  }
  console.log(`  geosearch: ${tally.geosearch} of ${rest.length} matched by name within ${GEOSEARCH_RADIUS_M} m`);

  for (const p of plans.values()) {
    const tag = p.source === 'geosearch' ? `geosearch ${p.score!.toFixed(2)} ${p.distM}m` : p.source;
    console.log(`  [${args.apply ? 'link' : 'dry'}] ${p.name}  ⇐  ${p.lang}:${p.title}  (${tag})`);
  }

  if (args.apply) {
    for (const p of plans.values()) {
      await db
        .update(schema.kyivLore)
        .set({ wikipediaTitle: p.title, sourceLang: p.lang, wikiSource: p.source })
        .where(eq(schema.kyivLore.id, p.id));
    }
    console.log(`  ✓ wrote ${plans.size} handles`);
  } else {
    console.log(`  (dry) would write ${plans.size} handles — ${JSON.stringify(tally)}`);
  }
  return plans;
}

// ---- phase: detail -------------------------------------------------------

// Parsing the answer lives in services/loreWriter.ts — strict JSON with
// a lenient fallback — so enrichLore.check.ts can pin it without a db.

function relationLine(wikiSource: string | null): string {
  switch (wikiSource) {
    case 'subject':
      return 'the person or event this memorial is for';
    case 'geosearch':
      return 'the nearest article on record, matched by name';
    case 'title':
      return 'the person or thing this place is named for (looked up by name)';
    default:
      return 'this place itself';
  }
}

interface DetailRow {
  id: string;
  name: string;
  nameEn: string | null;
  category: string;
  story: string;
  wikipediaTitle: string | null;
  sourceLang: string | null;
  wikidataId: string | null;
  wikiSource: string | null;
  facts: LoreFacts | null;
}

// The parsed answer, or the raw text so an unparsed row can be read.
type WriterResult = { ok: Written } | { raw: string };

async function write(
  model: string,
  row: DetailRow,
  summary: WikiSummary | null,
  wikidataDesc: string | null,
): Promise<WriterResult> {
  const userBlock = [
    'PLACE',
    `- name: ${row.name}${row.nameEn ? ` (${row.nameEn})` : ''}`,
    `- category: ${row.category}`,
    `- your current one-liner about it: ${row.story}`,
    ...factsLines(row.facts),
    wikidataDesc ? `- wikidata: ${wikidataDesc}` : null,
    summary ? `- article title: ${row.wikipediaTitle}` : null,
    summary ? `- article is about: ${relationLine(row.wikiSource)}` : null,
    summary?.description ? `- short description: ${summary.description}` : null,
    summary ? `- article lead: ${summary.extract.slice(0, 1800)}` : null,
    !summary ? '- (no article — write only from the facts above; keep it short)' : null,
  ]
    .filter(Boolean)
    .join('\n');

  const res = await anthropic().messages.create({
    model,
    max_tokens: 400,
    system: [{ type: 'text', text: WRITER_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userBlock }],
  });
  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  const parsed = parseWriter(text);
  return parsed ? { ok: parsed } : { raw: text };
}

async function phaseDetail(
  args: Args,
  pendingFacts: PendingFacts,
  pendingLinks: PendingLinks,
): Promise<void> {
  // Rows with a Wikipedia handle, or with facts that carry an
  // inscription / description / subject. The jsonb test mirrors
  // factsCarryResearch; the real decision is re-made in code below.
  //
  // In a dry run the handles and facts the earlier phases planned are
  // not in the database yet, so the SQL cannot see them: read every row
  // without a detail and decide in code, against the row as it WOULD
  // be. Applying, the earlier phases have written, and the SQL filter
  // is exact.
  const factsHaveResearch = sql`(facts ? 'inscription' or facts ? 'description' or facts ? 'subjectWikidata' or facts ? 'subjectWikipedia')`;
  const chaining = pendingFacts.size > 0 || pendingLinks.size > 0;
  const stored: Array<DetailRow & { createdAt: Date; lastRewroteAt: Date }> = await db
    .select({
      id: schema.kyivLore.id,
      name: schema.kyivLore.name,
      nameEn: schema.kyivLore.nameEn,
      category: schema.kyivLore.category,
      story: schema.kyivLore.story,
      wikipediaTitle: schema.kyivLore.wikipediaTitle,
      sourceLang: schema.kyivLore.sourceLang,
      wikidataId: schema.kyivLore.wikidataId,
      wikiSource: schema.kyivLore.wikiSource,
      facts: schema.kyivLore.facts,
      createdAt: schema.kyivLore.createdAt,
      lastRewroteAt: schema.kyivLore.lastRewroteAt,
    })
    .from(schema.kyivLore)
    .where(
      and(
        isNull(schema.kyivLore.detail),
        HAS_A_LETTER,
        chaining ? undefined : or(isNotNull(schema.kyivLore.wikipediaTitle), factsHaveResearch),
        args.id ? eq(schema.kyivLore.id, args.id) : undefined,
      ),
    )
    .orderBy(schema.kyivLore.id)
    .limit(chaining ? 100_000 : args.limit || 100_000);

  // The row as it will be: a stored handle wins over a planned one,
  // stored facts over planned ones. A planned handle carries its source
  // so the writer is told the relation.
  const rows = stored
    .map((r) => {
      const link = r.wikipediaTitle ? null : pendingLinks.get(r.id);
      return {
        ...r,
        facts: r.facts ?? pendingFacts.get(r.id) ?? null,
        wikipediaTitle: r.wikipediaTitle ?? link?.title ?? null,
        sourceLang: r.sourceLang ?? link?.lang ?? null,
        wikiSource: r.wikiSource ?? link?.source ?? null,
      };
    })
    .filter((r) => !!r.wikipediaTitle || factsCarryResearch(r.facts))
    .slice(0, args.limit || undefined);

  console.log(`\n▶ detail — ${rows.length} rows with research and no detail`);
  if (!args.apply) {
    console.log(
      `  (dry) would spend ~$${(rows.length * EST_USD_PER_DETAIL).toFixed(2)} on ${args.model} for ${rows.length} rows; sampling research for the first ${Math.min(rows.length, 20)} to show what it'd have`,
    );
  }

  let written = 0;
  let rewrote = 0;
  let noResearch = 0;
  let unparsed = 0;
  let n = 0;
  for (const row of rows) {
    n++;
    // Dry mode only samples research: reading 2000 leads to print
    // "wiki=yes" 2000 times is a Wikipedia bill with no reader.
    if (!args.apply && n > 20) break;

    let summary: WikiSummary | null = null;
    if (row.wikipediaTitle) {
      const lang = row.sourceLang ?? 'uk';
      summary = await fetchWikipediaSummary(lang, row.wikipediaTitle);
      if (!summary && lang !== 'uk') summary = await fetchWikipediaSummary('uk', row.wikipediaTitle);
      if (summary && summary.type !== 'standard') summary = null;
    }
    if (!summary && !factsCarryResearch(row.facts)) {
      noResearch++;
      console.log(`  [skip ${n}/${rows.length}] ${row.name}: no usable lead for ${row.sourceLang}:${row.wikipediaTitle} and no facts`);
      await sleep(100);
      continue;
    }
    // The description of the object itself, not of its subject — a
    // subject's entity describes the person.
    const wikidataDesc =
      row.wikidataId && row.wikiSource !== 'subject' ? await fetchWikidataDesc(row.wikidataId) : null;
    // A story written before this row had research was written from
    // nothing; the research is a reason to write it again. Rows the
    // seed linked ('osm') had their article from day one.
    const rewriteStory =
      row.wikiSource !== 'osm' && row.lastRewroteAt.getTime() <= row.createdAt.getTime();

    if (!args.apply) {
      console.log(
        `  [dry ${n}/${rows.length}] ${row.name} — ${summary ? `lead ${summary.extract.length} chars (${row.wikiSource})` : 'facts only'}${
          row.facts ? `, facts ${Object.keys(row.facts).join('+')}` : ''
        }${rewriteStory ? ', would rewrite story' : ''}`,
      );
      await sleep(100);
      continue;
    }

    try {
      const result = await write(args.model, row, summary, wikidataDesc);
      if (!('ok' in result)) {
        unparsed++;
        // The raw answer, one line, so the shape that defeated both
        // parsers is in the log rather than guessed at afterwards.
        console.log(
          `  [unparsed ${n}/${rows.length}] ${row.name}: ${JSON.stringify(result.raw.slice(0, 300))}`,
        );
        continue;
      }
      const out = result.ok;
      const now = new Date();
      await db
        .update(schema.kyivLore)
        .set({
          detail: out.detail,
          detailAt: now,
          // A geosearch or title match arrives without an entity id;
          // the article knows its own. Not for 'subject' — that entity
          // is the person, not the plaque.
          ...(row.wikidataId == null && row.wikiSource !== 'subject' && summary?.wikibaseItem
            ? { wikidataId: summary.wikibaseItem }
            : {}),
          ...(rewriteStory ? { story: out.story, lastRewroteAt: now } : {}),
        })
        .where(eq(schema.kyivLore.id, row.id));
      written++;
      if (rewriteStory) rewrote++;
      console.log(`  [${n}/${rows.length}] ${row.name}${rewriteStory ? ` → ${out.story}` : ''}\n      ${out.detail}`);
      await sleep(150);
    } catch (err) {
      console.error(`  [err ${n}/${rows.length}] ${row.name}:`, (err as Error).message);
      await sleep(1000);
    }
  }
  if (args.apply) {
    console.log(
      `  ✓ detail written for ${written} rows (${rewrote} stories rewritten, ${noResearch} without usable research, ${unparsed} unparsed)`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `▶ enrich-lore — ${args.apply ? 'APPLY' : 'dry run'}${args.only ? ` only=${args.only}` : ''}${args.limit ? ` limit=${args.limit}` : ''}${args.id ? ` id=${args.id}` : ''} model=${args.model}`,
  );
  const [census] = await db
    .select({
      total: sql<number>`count(*)::int`,
      facts: sql<number>`count(facts)::int`,
      linked: sql<number>`count(wikipedia_title)::int`,
      detailed: sql<number>`count(detail)::int`,
    })
    .from(schema.kyivLore);
  console.log(
    `  corpus: ${census?.total ?? 0} rows, ${census?.facts ?? 0} with facts, ${census?.linked ?? 0} with a Wikipedia handle, ${census?.detailed ?? 0} with detail`,
  );

  // Each phase hands its plan to the next, so a dry run sees the row as
  // the apply would leave it. Applying, the plan is already on disk and
  // the hand-off is redundant but harmless.
  const facts: PendingFacts = !args.only || args.only === 'osm' ? await phaseOsm(args) : new Map();
  const links: PendingLinks =
    !args.only || args.only === 'links' ? await phaseLinks(args, facts) : new Map();
  if (!args.only || args.only === 'detail') await phaseDetail(args, facts, links);

  if (!args.apply) {
    console.log('\n(dry run — nothing written. re-run with --apply once the plan above reads right.)');
  }
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
