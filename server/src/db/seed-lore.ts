// Build the Kyiv-lore corpus the dog leans on when he walks past
// something with a story. One-off batch pipeline:
//   1. Overpass API → all OSM POIs in the Kyiv bbox tagged with
//      historic / tourism / memorial / artwork / man_made monuments /
//      religious buildings (services/overpass.ts).
//   2. For each: keep the tags worth keeping (inscription, subject,
//      date… — LoreFacts), pull the Wikidata description (CC0) +
//      Wikipedia summary (CC-BY-SA) if linked. Facts are our research
//      input — we don't ship their prose.
//   3. Sonnet rewrites each into ONE short in-voice sentence so the
//      dog mentions it like a place he knows, not like a tour guide.
//   4. Upsert to kyiv_lore, keyed by osm:<type>:<id> so a re-run is
//      idempotent (only writes new rows).
//
// The longer telling and the Wikipedia handles for rows the OSM tag
// doesn't provide are enrich-lore.ts's job, run after this.
//
// Usage:
//   dry run (no API spend, no DB writes, prints what it'd do):
//     pnpm --filter @shukajpes/server seed:lore -- --dry
//   real run:
//     pnpm --filter @shukajpes/server seed:lore
//   limit to first N entries (smoke test):
//     pnpm --filter @shukajpes/server seed:lore -- --limit 20
//
// Cost: ~$0.003 per Sonnet call; expect ~800–1500 OSM POIs in Kyiv =
// roughly $2.5–$4.5 for a full run, one-time.

import 'dotenv/config';
import { pathToFileURL } from 'url';
import { db, schema, pg } from './index.js';
import { anthropic, ACTIVE_MODEL } from '../services/anthropic.js';
import { fetchWikidataDesc, fetchWikipediaSummary } from '../services/wikiResearch.js';
import {
  factsFromTags,
  factsLines,
  fetchLoreElements,
  parseWikipediaTag,
  pickCategory,
  type LoreFacts,
  type OverpassElement,
} from '../services/overpass.js';

interface Candidate {
  osmType: 'node' | 'way' | 'relation';
  osmId: string;
  lat: number;
  lng: number;
  name: string;
  nameEn: string | null;
  category: string;
  wikidataId: string | null;
  wikipediaTitle: string | null;
  sourceLang: string | null;
  facts: LoreFacts | null;
}

function buildCandidates(elements: OverpassElement[]): Candidate[] {
  const out: Candidate[] = [];
  for (const el of elements) {
    const tags = el.tags ?? {};
    const name = tags['name:uk'] ?? tags['name'];
    if (!name) continue;
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) continue;
    const wiki = parseWikipediaTag(tags['wikipedia']);
    out.push({
      osmType: el.type,
      osmId: String(el.id),
      lat,
      lng,
      name,
      nameEn: tags['name:en'] ?? null,
      category: pickCategory(tags),
      wikidataId: tags['wikidata'] ?? null,
      wikipediaTitle: wiki ? wiki.title : null,
      sourceLang: wiki ? wiki.lang : null,
      facts: factsFromTags(tags),
    });
  }
  // Dedup by (osm type + id).
  const seen = new Set<string>();
  return out.filter((c) => {
    const k = `${c.osmType}:${c.osmId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

interface ResearchBlob {
  wikidataDescription: string | null;
  wikipediaSummary: string | null;
  wikipediaLang: string | null;
}

// The Wikimedia fetches live in services/wikiResearch.ts, shared with
// enrich-lore.ts.
async function researchOne(c: Candidate): Promise<ResearchBlob> {
  const wikidataDescription = c.wikidataId ? await fetchWikidataDesc(c.wikidataId) : null;
  let wikipediaSummary: string | null = null;
  let wikipediaLang: string | null = null;
  if (c.wikipediaTitle && c.sourceLang) {
    wikipediaSummary = (await fetchWikipediaSummary(c.sourceLang, c.wikipediaTitle))?.extract ?? null;
    wikipediaLang = c.sourceLang;
    if (!wikipediaSummary && c.sourceLang !== 'uk') {
      wikipediaSummary = (await fetchWikipediaSummary('uk', c.wikipediaTitle))?.extract ?? null;
      if (wikipediaSummary) wikipediaLang = 'uk';
    }
  }
  return { wikidataDescription, wikipediaSummary, wikipediaLang };
}

// Rewrite prompt — separate from the chat persona because this is a
// one-off content-gen step, not a conversation. Output must be one
// short sentence the dog would say IF the human asked about this place
// while walking past it. No "according to", no Wikipedia mention, no
// lists, no dates unless they land naturally.
const REWRITE_SYSTEM = `you are шукайпес — a dog walking around Kyiv with your human. your job here is one offline writing task: given a Kyiv place + a research blob, write ONE short sentence (ukrainian) in your normal dog-voice that you'd say if you and the human walked past it. like a place you've sniffed before and find interesting.

rules:
- ONE sentence, max 25 words. lowercase. proper nouns capitalised normally.
- ukrainian. mix in a russian word only if it lands naturally for the topic.
- no "wikipedia", no "according to", no "source", no quotes around facts.
- no markdown, no lists, no emojis.
- if the research is thin or generic, still write one warm sensory line that hints at being-near-something (a smell, a year, a building feel) — do NOT fabricate names or specific facts not in the research.
- pick the single most interesting beat. skip filler. don't list dates.
- start like a dog would: a small observation, a sniff, a tail wag, a thought. never "this is", never "here we have".

good examples (style):
- "*вуха вгору* пахне старим каменем — кажуть, цій плиті понад чотириста років."
- "*ніс у двір* у тридцятих тут жив поет; стіна ще пам'ятає."
- "*хвостом* люблю проходити повз — банюшний верх ще XI ст., князя якогось доба."
- "*зупиняюсь* пам'ятник солдатам — тут квіти завжди свіжі."`;

interface RewriteInput {
  c: Candidate;
  research: ResearchBlob;
}

async function rewrite({ c, research }: RewriteInput): Promise<string> {
  const hasResearch =
    !!research.wikidataDescription ||
    !!research.wikipediaSummary ||
    !!c.facts?.inscription ||
    !!c.facts?.description;
  const userBlock = [
    `PLACE`,
    `- name: ${c.name}${c.nameEn ? ` (${c.nameEn})` : ''}`,
    `- category: ${c.category}`,
    ...factsLines(c.facts),
    research.wikidataDescription
      ? `- wikidata: ${research.wikidataDescription}`
      : null,
    research.wikipediaSummary
      ? `- summary (${research.wikipediaLang}): ${research.wikipediaSummary.slice(0, 1200)}`
      : null,
    !hasResearch
      ? `- (no external research — write a thin sensory line, no fabricated facts)`
      : null,
  ]
    .filter(Boolean)
    .join('\n');

  const res = await anthropic().messages.create({
    model: ACTIVE_MODEL,
    max_tokens: 120,
    system: [
      {
        type: 'text',
        text: REWRITE_SYSTEM,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userBlock }],
  });
  const text = res.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim();
  // Strip stray surrounding quotes if Sonnet added them.
  return text.replace(/^["“'«]+|["”'»]+$/g, '').trim();
}

async function existingIds(): Promise<Set<string>> {
  const rows = await db.select({ id: schema.kyivLore.id }).from(schema.kyivLore);
  return new Set(rows.map((r) => r.id));
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const limitArg = args.indexOf('--limit');
  const limit = limitArg >= 0 ? parseInt(args[limitArg + 1] ?? '0', 10) : 0;

  console.log(`▶ seed-lore — dry=${dry} limit=${limit || 'none'}`);

  const elements = await fetchLoreElements();
  const candidates = buildCandidates(elements);
  console.log(`  ${candidates.length} candidates after dedup + name filter`);

  const already = dry ? new Set<string>() : await existingIds();
  const fresh = candidates
    .map((c) => ({ ...c, id: `osm:${c.osmType}:${c.osmId}` }))
    .filter((c) => !already.has(c.id));
  console.log(`  ${fresh.length} new (already have ${already.size})`);

  const work = limit > 0 ? fresh.slice(0, limit) : fresh;
  console.log(`  will process ${work.length}\n`);

  let done = 0;
  let writes = 0;
  for (const c of work) {
    done++;
    try {
      const research = await researchOne(c);
      if (dry) {
        console.log(
          `[dry ${done}/${work.length}] ${c.name} (${c.category}) — wiki=${
            research.wikipediaSummary ? 'yes' : 'no'
          } wd=${research.wikidataDescription ? 'yes' : 'no'} facts=${
            c.facts ? Object.keys(c.facts).join('+') : 'no'
          }`,
        );
        // Skip the Sonnet call in dry mode — we just want to see what
        // research we'd have to work with.
        await sleep(80);
        continue;
      }
      const story = await rewrite({ c, research });
      if (!story) {
        console.log(`  [skip ${done}/${work.length}] empty rewrite for ${c.name}`);
        continue;
      }
      await db
        .insert(schema.kyivLore)
        .values({
          id: c.id,
          name: c.name,
          nameEn: c.nameEn,
          category: c.category,
          lat: c.lat,
          lng: c.lng,
          story,
          osmType: c.osmType,
          osmId: c.osmId,
          wikidataId: c.wikidataId,
          wikipediaTitle: c.wikipediaTitle,
          sourceLang: research.wikipediaLang ?? c.sourceLang,
          wikiSource: c.wikipediaTitle ? 'osm' : null,
          facts: c.facts,
        })
        .onConflictDoNothing({ target: schema.kyivLore.id });
      writes++;
      console.log(`  [${done}/${work.length}] ${c.name} → ${story}`);
      // Be polite to Wikipedia + Overpass and gentle on Anthropic rate.
      await sleep(120);
    } catch (err) {
      console.error(`  [err ${done}/${work.length}] ${c.name}:`, (err as Error).message);
      await sleep(500);
    }
  }

  console.log(`\n✓ done. processed=${work.length} writes=${writes}`);
}

const isEntry =
  import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isEntry) {
  main()
    .then(() => pg.end())
    .catch((err) => {
      console.error(err);
      pg.end().finally(() => process.exit(1));
    });
}
