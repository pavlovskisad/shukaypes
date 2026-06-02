// Build the Kyiv-lore corpus the dog leans on when he walks past
// something with a story. One-off batch pipeline:
//   1. Overpass API → all OSM POIs in the Kyiv bbox tagged with
//      historic / tourism / memorial / artwork / man_made monuments /
//      religious buildings.
//   2. For each: pull Wikidata description (CC0) + Wikipedia summary
//      (CC-BY-SA) if linked. Facts are our research input — we don't
//      ship their prose.
//   3. Sonnet rewrites each into ONE short in-voice sentence so the
//      dog mentions it like a place he knows, not like a tour guide.
//   4. Upsert to kyiv_lore, keyed by osm:<type>:<id> so a re-run is
//      idempotent (only writes new + flagged-for-rewrite rows).
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
import { sql } from 'drizzle-orm';
import { pathToFileURL } from 'url';
import { db, schema, pg } from './index.js';
import { anthropic, ACTIVE_MODEL } from '../services/anthropic.js';

// Kyiv bbox (south, west, north, east) — Overpass takes (S,W,N,E).
// Pulled from OSM's "Kyiv" relation bounds, padded slightly.
const KYIV_BBOX = [50.21, 30.24, 50.59, 30.83] as const;

// Query split into category chunks so any one Overpass call stays
// small enough to dodge "server too busy" 504s. Each chunk returns a
// few hundred elements rather than ~2k in one go.
const QUERY_CHUNKS: Array<{ label: string; body: string }> = [
  {
    label: 'historic+memorial',
    body: `
[out:json][timeout:90];
(
  node["historic"](${KYIV_BBOX.join(',')});
  way["historic"](${KYIV_BBOX.join(',')});
  relation["historic"](${KYIV_BBOX.join(',')});
  node["memorial"](${KYIV_BBOX.join(',')});
  way["memorial"](${KYIV_BBOX.join(',')});
);
out center tags;`.trim(),
  },
  {
    label: 'tourism',
    body: `
[out:json][timeout:90];
(
  node["tourism"~"^(attraction|museum|artwork|gallery)$"](${KYIV_BBOX.join(',')});
  way["tourism"~"^(attraction|museum|artwork|gallery)$"](${KYIV_BBOX.join(',')});
  relation["tourism"~"^(attraction|museum|artwork|gallery)$"](${KYIV_BBOX.join(',')});
);
out center tags;`.trim(),
  },
  {
    label: 'religious',
    body: `
[out:json][timeout:90];
(
  way["building"~"^(cathedral|church|chapel|synagogue|mosque|temple)$"](${KYIV_BBOX.join(',')});
  relation["building"~"^(cathedral|church|chapel|synagogue|mosque|temple)$"](${KYIV_BBOX.join(',')});
);
out center tags;`.trim(),
  },
  {
    label: 'monuments',
    body: `
[out:json][timeout:90];
(
  node["man_made"="obelisk"](${KYIV_BBOX.join(',')});
  way["man_made"="obelisk"](${KYIV_BBOX.join(',')});
  node["man_made"="tower"]["tower:type"!="communication"](${KYIV_BBOX.join(',')});
);
out center tags;`.trim(),
  },
];

// Public Overpass endpoints, tried in order. Main can throw 504 under
// load; Kumi mirror is the usual fallback.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
];

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResult {
  elements: OverpassElement[];
}

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
}

function pickCategory(tags: Record<string, string>): string {
  if (tags.historic) return 'historic';
  if (tags.memorial) return 'memorial';
  if (tags.tourism === 'museum' || tags.tourism === 'gallery') return 'museum';
  if (tags.tourism === 'artwork') return 'artwork';
  if (tags.tourism === 'attraction') return 'tourism';
  if (tags.building === 'cathedral' || tags.building === 'church' || tags.building === 'chapel') return 'religious';
  if (tags.building === 'synagogue' || tags.building === 'mosque' || tags.building === 'temple') return 'religious';
  if (tags.man_made === 'obelisk' || tags.man_made === 'tower') return 'monument';
  return 'other';
}

function parseWikipediaTag(value: string | undefined): { lang: string; title: string } | null {
  if (!value) return null;
  const m = value.match(/^([a-z-]+):(.+)$/);
  if (!m) return null;
  return { lang: m[1]!, title: m[2]! };
}

async function fetchOverpassChunk(
  label: string,
  body: string,
): Promise<OverpassElement[]> {
  let lastErr: unknown = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            accept: 'application/json',
            'user-agent':
              'shukajpes-lore-seed/1.0 (contact: pavlovskisad@gmail.com)',
          },
          body: `data=${encodeURIComponent(body)}`,
        });
        if (res.status === 429 || res.status === 504) {
          // Server told us to back off — wait then retry on same endpoint.
          const wait = 2000 * Math.pow(2, attempt);
          console.log(`    ${label}: ${endpoint} ${res.status}, retry in ${wait}ms`);
          await sleep(wait);
          continue;
        }
        if (!res.ok) {
          throw new Error(`overpass ${res.status} from ${endpoint}`);
        }
        const json = (await res.json()) as OverpassResult;
        return json.elements;
      } catch (err) {
        lastErr = err;
        const wait = 1500 * Math.pow(2, attempt);
        console.log(`    ${label}: ${endpoint} failed (${(err as Error).message}), retry in ${wait}ms`);
        await sleep(wait);
      }
    }
    console.log(`    ${label}: ${endpoint} exhausted, trying next endpoint…`);
  }
  throw new Error(
    `overpass chunk ${label} failed on all endpoints: ${(lastErr as Error)?.message ?? 'unknown'}`,
  );
}

async function fetchOverpass(): Promise<OverpassElement[]> {
  console.log('→ querying Overpass in chunks…');
  const all: OverpassElement[] = [];
  for (const chunk of QUERY_CHUNKS) {
    console.log(`  · ${chunk.label}`);
    const els = await fetchOverpassChunk(chunk.label, chunk.body);
    console.log(`    got ${els.length}`);
    all.push(...els);
    // Polite gap between chunks so we don't hammer one endpoint.
    await sleep(800);
  }
  console.log(`  total ${all.length} elements across ${QUERY_CHUNKS.length} chunks`);
  return all;
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

async function fetchWikidataDesc(qid: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`,
      { headers: { 'user-agent': 'shukajpes-lore-seed/1.0 (contact: pavlovskisad@gmail.com)' } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      entities?: Record<string, { descriptions?: Record<string, { value: string }> }>;
    };
    const ent = json.entities?.[qid];
    if (!ent) return null;
    return (
      ent.descriptions?.uk?.value ??
      ent.descriptions?.en?.value ??
      ent.descriptions?.ru?.value ??
      null
    );
  } catch {
    return null;
  }
}

async function fetchWikipediaSummary(
  lang: string,
  title: string,
): Promise<string | null> {
  try {
    const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const res = await fetch(url, {
      headers: { 'user-agent': 'shukajpes-lore-seed/1.0 (contact: pavlovskisad@gmail.com)' },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { extract?: string };
    return json.extract ?? null;
  } catch {
    return null;
  }
}

async function researchOne(c: Candidate): Promise<ResearchBlob> {
  const wikidataDescription = c.wikidataId ? await fetchWikidataDesc(c.wikidataId) : null;
  let wikipediaSummary: string | null = null;
  let wikipediaLang: string | null = null;
  if (c.wikipediaTitle && c.sourceLang) {
    wikipediaSummary = await fetchWikipediaSummary(c.sourceLang, c.wikipediaTitle);
    wikipediaLang = c.sourceLang;
    if (!wikipediaSummary && c.sourceLang !== 'uk') {
      wikipediaSummary = await fetchWikipediaSummary('uk', c.wikipediaTitle);
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
  const userBlock = [
    `PLACE`,
    `- name: ${c.name}${c.nameEn ? ` (${c.nameEn})` : ''}`,
    `- category: ${c.category}`,
    research.wikidataDescription
      ? `- wikidata: ${research.wikidataDescription}`
      : null,
    research.wikipediaSummary
      ? `- summary (${research.wikipediaLang}): ${research.wikipediaSummary.slice(0, 1200)}`
      : null,
    !research.wikidataDescription && !research.wikipediaSummary
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

  const elements = await fetchOverpass();
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
          } wd=${research.wikidataDescription ? 'yes' : 'no'}`,
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
