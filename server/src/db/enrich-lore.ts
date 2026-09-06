// Give the lore corpus its "read more".
//
// seed-lore.ts wrote every kyiv_lore row with one dog-voice sentence and
// a Wikipedia handle IF the OSM object carried a `wikipedia=` tag. Most
// don't, so most "read more" taps end in the dog shrugging — for
// landmarks that have an article. This pass fills that in, in two phases
// that can run together or apart:
//
//   links   For every row without a Wikipedia handle:
//             - a `wikidata=` tag → the entity's own sitelinks
//               (uk, then en). Certain: OSM's mapper said this object
//               IS this entity.
//             - no tag at all → every uk.wikipedia article geotagged
//               within GEOSEARCH_RADIUS_M, matched by NAME through
//               services/loreMatch.ts. Fuzzy by construction, so these
//               rows are stamped wiki_source = 'geosearch' and can be
//               audited or reverted as a group:
//                 UPDATE kyiv_lore SET wikipedia_title = NULL,
//                   source_lang = NULL, wiki_source = NULL, detail = NULL,
//                   detail_at = NULL WHERE wiki_source = 'geosearch';
//
//   detail  For every row with a handle and no `detail` yet: fetch the
//           article lead + Wikidata description, and have the model
//           write the dog's longer telling (2-4 sentences) from it. Rows
//           whose handle was found by THIS script — whose story was
//           therefore written from no article at all — get their
//           one-liner rewritten from the same research, and
//           last_rewrote_at moves.
//
// Dry by default. `--apply` writes. The dry run prints one line per row
// with what the apply would do, and the cost it would spend, and is
// meant to be read before the apply — same shape as clean:lost-dogs.
//
// Usage:
//   pnpm --filter @shukajpes/server enrich:lore                 # dry, both phases
//   pnpm --filter @shukajpes/server enrich:lore -- --apply
//   pnpm --filter @shukajpes/server enrich:lore -- --only links --apply
//   pnpm --filter @shukajpes/server enrich:lore -- --only detail --limit 50
//   pnpm --filter @shukajpes/server enrich:lore -- --id osm:node:123 --apply
//   production: fly ssh console -a shukajpes-api -C "node dist/db/enrich-lore.js --apply"
//
// Idempotent: links only touches rows with no handle, detail only rows
// with no detail. A re-run after a crash picks up where it stopped.
//
// Cost. Links is free (Wikimedia, anonymous, paced). Detail is one
// model call per row — see WRITER_MODEL and EST_USD_PER_DETAIL; the dry
// run multiplies that out for you.

import 'dotenv/config';
import { and, eq, isNull, isNotNull, sql } from 'drizzle-orm';
import { pathToFileURL } from 'url';
import { db, schema, pg } from './index.js';
import { anthropic } from '../services/anthropic.js';
import { pickGeoMatch } from '../services/loreMatch.js';
import {
  fetchWikidataDesc,
  fetchWikidataLinks,
  fetchWikipediaSummary,
  geosearchWikipedia,
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

const WRITER_SYSTEM = `you are шукайпес — a dog walking around Kyiv with your human. offline writing task: given a Kyiv place and a research blob, write two things in ukrainian, in your usual dog-voice.

"detail" — what you'd tell the human if they stopped and said "wait, tell me more about this one". two to four short sentences, 45-90 words total. pick the most interesting concrete beats in the research: who, when, what happened here, what's odd or lovely about it. lowercase, proper nouns capitalised normally. no markdown, no lists, no emojis, no "wikipedia", no "according to", no "source". one small dog gesture in *asterisks* at most, and not at the start of every sentence.

"story" — ONE sentence, max 25 words, same voice: a small observation, a sniff, a thought. never "this is", never "here we have".

facts come ONLY from the research. never invent names, dates, numbers or events. if the research is about something the place is PART of or attached to — a plaque on a building whose article you were given, a chapel of a monastery — say it that way; don't claim the plaque is the building.

answer with JSON only, no prose around it: {"story": "...", "detail": "..."}`;

interface Args {
  apply: boolean;
  only: 'links' | 'detail' | null;
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
  if (only && only !== 'links' && only !== 'detail') {
    throw new Error(`--only must be links or detail, got ${only}`);
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

// ---- phase: links --------------------------------------------------------

interface LinkPlan {
  id: string;
  name: string;
  title: string;
  lang: 'uk' | 'en';
  source: 'wikidata' | 'geosearch';
  // Geosearch only.
  score?: number;
  distM?: number;
}

async function phaseLinks(args: Args): Promise<LinkPlan[]> {
  const where = and(
    isNull(schema.kyivLore.wikipediaTitle),
    HAS_A_LETTER,
    args.id ? eq(schema.kyivLore.id, args.id) : undefined,
  );
  const rows = await db
    .select({
      id: schema.kyivLore.id,
      name: schema.kyivLore.name,
      nameEn: schema.kyivLore.nameEn,
      category: schema.kyivLore.category,
      lat: schema.kyivLore.lat,
      lng: schema.kyivLore.lng,
      wikidataId: schema.kyivLore.wikidataId,
    })
    .from(schema.kyivLore)
    .where(where)
    .orderBy(schema.kyivLore.id)
    .limit(args.limit || 100_000);

  const viaWikidata = rows.filter((r) => r.wikidataId);
  const viaGeo = rows.filter((r) => !r.wikidataId);
  console.log(
    `\n▶ links — ${rows.length} rows without a handle: ${viaWikidata.length} carry a wikidata id, ${viaGeo.length} carry nothing`,
  );

  const plans: LinkPlan[] = [];

  // Wikidata sitelinks, fifty entities a call.
  const links = await fetchWikidataLinks(viaWikidata.map((r) => r.wikidataId!));
  let wdMissing = 0;
  for (const r of viaWikidata) {
    const l = links.get(r.wikidataId!);
    if (!l) {
      wdMissing++;
      continue;
    }
    if (l.ukwiki) plans.push({ id: r.id, name: r.name, title: l.ukwiki, lang: 'uk', source: 'wikidata' });
    else if (l.enwiki) plans.push({ id: r.id, name: r.name, title: l.enwiki, lang: 'en', source: 'wikidata' });
  }
  const wdFound = plans.length;
  console.log(
    `  wikidata: ${wdFound} of ${viaWikidata.length} entities link an article (${wdMissing} entities missing or unreadable)`,
  );

  // Geosearch + name match, one call a row.
  let geoTried = 0;
  for (const r of viaGeo) {
    geoTried++;
    const cands = await geosearchWikipedia('uk', r.lat, r.lng, GEOSEARCH_RADIUS_M);
    const m = pickGeoMatch({ name: r.name, nameEn: r.nameEn, category: r.category }, cands);
    if (m) {
      plans.push({
        id: r.id,
        name: r.name,
        title: m.title,
        lang: 'uk',
        source: 'geosearch',
        score: m.score,
        distM: Math.round(m.dist),
      });
    }
    if (geoTried % 100 === 0) console.log(`  geosearch: ${geoTried}/${viaGeo.length}…`);
    await sleep(120);
  }
  console.log(`  geosearch: ${plans.length - wdFound} of ${viaGeo.length} matched by name within ${GEOSEARCH_RADIUS_M} m`);

  for (const p of plans) {
    const tag =
      p.source === 'geosearch' ? `geo ${p.score!.toFixed(2)} ${p.distM}m` : 'wikidata';
    console.log(`  [${args.apply ? 'link' : 'dry'}] ${p.name}  ⇐  ${p.lang}:${p.title}  (${tag})`);
  }

  if (args.apply) {
    for (const p of plans) {
      await db
        .update(schema.kyivLore)
        .set({ wikipediaTitle: p.title, sourceLang: p.lang, wikiSource: p.source })
        .where(eq(schema.kyivLore.id, p.id));
    }
    console.log(`  ✓ wrote ${plans.length} handles`);
  } else {
    console.log(`  (dry) would write ${plans.length} handles`);
  }
  return plans;
}

// ---- phase: detail -------------------------------------------------------

interface Written {
  story: string;
  detail: string;
}

function parseWriter(text: string): Written | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as { story?: unknown; detail?: unknown };
    if (typeof obj.story !== 'string' || typeof obj.detail !== 'string') return null;
    const clean = (s: string) => s.trim().replace(/^["“'«]+|["”'»]+$/g, '').trim();
    const story = clean(obj.story);
    const detail = clean(obj.detail);
    if (!story || !detail) return null;
    return { story, detail };
  } catch {
    return null;
  }
}

async function write(
  model: string,
  row: { name: string; nameEn: string | null; category: string; story: string; wikipediaTitle: string },
  summary: WikiSummary,
  wikidataDesc: string | null,
): Promise<Written | null> {
  const userBlock = [
    'PLACE',
    `- name: ${row.name}${row.nameEn ? ` (${row.nameEn})` : ''}`,
    `- category: ${row.category}`,
    `- your current one-liner about it: ${row.story}`,
    `- article title: ${row.wikipediaTitle}`,
    wikidataDesc ? `- wikidata: ${wikidataDesc}` : null,
    summary.description ? `- short description: ${summary.description}` : null,
    `- article lead: ${summary.extract.slice(0, 1800)}`,
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
  return parseWriter(text);
}

async function phaseDetail(args: Args): Promise<void> {
  const where = and(
    isNull(schema.kyivLore.detail),
    isNotNull(schema.kyivLore.wikipediaTitle),
    HAS_A_LETTER,
    args.id ? eq(schema.kyivLore.id, args.id) : undefined,
  );
  const rows = await db
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
      createdAt: schema.kyivLore.createdAt,
      lastRewroteAt: schema.kyivLore.lastRewroteAt,
    })
    .from(schema.kyivLore)
    .where(where)
    .orderBy(schema.kyivLore.id)
    .limit(args.limit || 100_000);

  console.log(`\n▶ detail — ${rows.length} rows with a handle and no detail`);
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
    const title = row.wikipediaTitle!;
    const lang = row.sourceLang ?? 'uk';
    let summary = await fetchWikipediaSummary(lang, title);
    if (!summary && lang !== 'uk') summary = await fetchWikipediaSummary('uk', title);
    if (!summary || summary.type !== 'standard') {
      noResearch++;
      console.log(`  [skip ${n}/${rows.length}] ${row.name}: no usable lead for ${lang}:${title}${summary ? ` (${summary.type})` : ''}`);
      await sleep(100);
      continue;
    }
    const wikidataDesc = row.wikidataId ? await fetchWikidataDesc(row.wikidataId) : null;
    // A story written before this row had an article was written from
    // nothing; the article is a reason to write it again. Rows the seed
    // linked ('osm') had their article from day one.
    const rewriteStory =
      row.wikiSource !== 'osm' && row.lastRewroteAt.getTime() <= row.createdAt.getTime();

    if (!args.apply) {
      console.log(
        `  [dry ${n}/${rows.length}] ${row.name} — lead ${summary.extract.length} chars${wikidataDesc ? ', wikidata desc' : ''}${rewriteStory ? ', would rewrite story' : ''}`,
      );
      await sleep(100);
      continue;
    }

    try {
      const out = await write(args.model, { ...row, wikipediaTitle: title }, summary, wikidataDesc);
      if (!out) {
        unparsed++;
        console.log(`  [unparsed ${n}/${rows.length}] ${row.name}`);
        continue;
      }
      const now = new Date();
      await db
        .update(schema.kyivLore)
        .set({
          detail: out.detail,
          detailAt: now,
          // A geosearch match arrives without an entity id; the article
          // knows its own.
          ...(row.wikidataId == null && summary.wikibaseItem ? { wikidataId: summary.wikibaseItem } : {}),
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
      `  ✓ detail written for ${written} rows (${rewrote} stories rewritten, ${noResearch} without a usable lead, ${unparsed} unparsed)`,
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
      linked: sql<number>`count(wikipedia_title)::int`,
      detailed: sql<number>`count(detail)::int`,
    })
    .from(schema.kyivLore);
  console.log(
    `  corpus: ${census?.total ?? 0} rows, ${census?.linked ?? 0} with a Wikipedia handle, ${census?.detailed ?? 0} with detail`,
  );

  if (args.only !== 'detail') await phaseLinks(args);
  if (args.only !== 'links') await phaseDetail(args);

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
