// Build the Kyiv gazetteer — a comprehensive place-name → coords
// index the lost-pet parser fuzzy-matches against. Replaces the ~30
// hard-coded landmarks in pipeline/parser.ts so a post mentioning any
// real Kyiv street / square / metro / park resolves to actual coords
// instead of falling back to city center.
//
// Pipeline:
//   1. Overpass API → all named OSM elements in the Kyiv bbox across
//      our category set (see QUERY_CHUNKS below).
//   2. Normalise: extract name_uk / name_en / built aliases (street-
//      prefix variants like "вул. X" / "вулиця X" / "X").
//   3. Build search_key (lowercase, diacritics stripped) for trigram
//      lookup in stage B.
//   4. Upsert by osm:<type>:<id> so re-runs are idempotent.
//
// Usage:
//   dry run (no DB writes, prints first 20):
//     pnpm --filter @shukajpes/server seed:gazetteer -- --dry
//   real run:
//     pnpm --filter @shukajpes/server seed:gazetteer
//   limit to first N rows:
//     pnpm --filter @shukajpes/server seed:gazetteer -- --limit 100
//
// Cost: no LLM calls. Overpass is free; expect ~10-20k rows + ~5min
// scrape time on a cold run.

import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { pathToFileURL } from 'url';
import { db, schema, pg } from './index.js';

// Kyiv bbox (south, west, north, east) — same as seed-lore.
const KYIV_BBOX = [50.21, 30.24, 50.59, 30.83] as const;

// Each chunk is one Overpass call. Splitting by category keeps any
// single query under the ~10MB/timeout limit. `out center tags;`
// returns way + relation centroids so we don't need to compute
// geometry ourselves.
const QUERY_CHUNKS: Array<{ label: string; category: string; body: string }> = [
  {
    label: 'streets-primary',
    category: 'street',
    body: `
[out:json][timeout:90];
(
  way["highway"~"^(primary|secondary|tertiary)$"]["name"](${KYIV_BBOX.join(',')});
);
out center tags;`.trim(),
  },
  {
    label: 'streets-residential',
    category: 'street',
    body: `
[out:json][timeout:120];
(
  way["highway"~"^(residential|living_street|pedestrian)$"]["name"](${KYIV_BBOX.join(',')});
);
out center tags;`.trim(),
  },
  {
    label: 'squares',
    category: 'square',
    body: `
[out:json][timeout:60];
(
  node["place"="square"](${KYIV_BBOX.join(',')});
  way["place"="square"](${KYIV_BBOX.join(',')});
  relation["place"="square"](${KYIV_BBOX.join(',')});
  way["highway"="pedestrian"]["area"="yes"]["name"~"площа"](${KYIV_BBOX.join(',')});
);
out center tags;`.trim(),
  },
  {
    label: 'metro',
    category: 'metro',
    body: `
[out:json][timeout:60];
(
  node["station"="subway"]["name"](${KYIV_BBOX.join(',')});
  node["subway"="yes"]["name"](${KYIV_BBOX.join(',')});
  way["station"="subway"]["name"](${KYIV_BBOX.join(',')});
  relation["station"="subway"]["name"](${KYIV_BBOX.join(',')});
);
out center tags;`.trim(),
  },
  {
    label: 'parks',
    category: 'park',
    body: `
[out:json][timeout:60];
(
  way["leisure"="park"]["name"](${KYIV_BBOX.join(',')});
  relation["leisure"="park"]["name"](${KYIV_BBOX.join(',')});
  way["leisure"="garden"]["name"](${KYIV_BBOX.join(',')});
);
out center tags;`.trim(),
  },
  {
    label: 'neighbourhoods',
    category: 'neighbourhood',
    body: `
[out:json][timeout:60];
(
  node["place"~"^(neighbourhood|suburb|quarter)$"](${KYIV_BBOX.join(',')});
  relation["place"~"^(neighbourhood|suburb|quarter)$"](${KYIV_BBOX.join(',')});
);
out center tags;`.trim(),
  },
  {
    label: 'districts',
    category: 'district',
    body: `
[out:json][timeout:60];
(
  relation["admin_level"="9"]["boundary"="administrative"](${KYIV_BBOX.join(',')});
  relation["admin_level"="10"]["boundary"="administrative"](${KYIV_BBOX.join(',')});
);
out center tags;`.trim(),
  },
];

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
  id: string;
  osmType: 'node' | 'way' | 'relation';
  osmId: string;
  lat: number;
  lng: number;
  nameUk: string;
  nameEn: string | null;
  aliases: string[];
  aliasesText: string;
  searchKey: string;
  category: string;
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
              'shukajpes-gazetteer-seed/1.0 (contact: pavlovskisad@gmail.com)',
          },
          body: `data=${encodeURIComponent(body)}`,
        });
        if (res.status === 429 || res.status === 504) {
          const wait = 2000 * Math.pow(2, attempt);
          console.log(`    ${label}: ${endpoint} ${res.status}, retry in ${wait}ms`);
          await sleep(wait);
          continue;
        }
        if (!res.ok) throw new Error(`overpass ${res.status} from ${endpoint}`);
        const json = (await res.json()) as OverpassResult;
        return json.elements;
      } catch (err) {
        lastErr = err;
        const wait = 1500 * Math.pow(2, attempt);
        console.log(
          `    ${label}: ${endpoint} failed (${(err as Error).message}), retry in ${wait}ms`,
        );
        await sleep(wait);
      }
    }
    console.log(`    ${label}: ${endpoint} exhausted, trying next…`);
  }
  throw new Error(
    `overpass chunk ${label} failed on all endpoints: ${(lastErr as Error)?.message ?? 'unknown'}`,
  );
}

// Lowercase + strip Ukrainian/Russian diacritics + collapse whitespace.
// Used as the trigram search key — matching "Хрещатик" vs "хрещатик"
// vs "ХРЕЩАТИК" all hit the same key.
export function normaliseName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[̀-ͯ]/g, '') // combining marks (Latin diacritics)
    .replace(/['’`ʼ]/g, '') // apostrophes — common variants in Ukr
    .replace(/\s+/g, ' ')
    .trim();
}

// Streets in OSM are named "Хрещатик", "вулиця Степана Бандери",
// "проспект Перемоги", etc. Posts in groups freely abbreviate them:
// "вул. Бандери", "пр-т Перемоги", just "Бандери". Build a few
// common variants so fuzzy match has something to bind to even when
// the user drops the type word entirely.
function streetAliases(name: string): string[] {
  const out = new Set<string>();
  out.add(name);
  // Pre-typed forms (with type word): generate the abbreviated form.
  const typePrefixes: Array<[RegExp, string[]]> = [
    [/^вулиця\s+(.+)/i, ['вул.', 'вул', '']],
    [/^проспект\s+(.+)/i, ['просп.', 'просп', 'пр-т', 'пр.', '']],
    [/^бульвар\s+(.+)/i, ['бул.', 'бул', '']],
    [/^площа\s+(.+)/i, ['пл.', 'пл', '']],
    [/^провулок\s+(.+)/i, ['пров.', 'пров', '']],
    [/^набережна\s+(.+)/i, ['наб.', 'наб', '']],
    [/^узвіз\s+(.+)/i, ['']],
  ];
  for (const [re, prefixes] of typePrefixes) {
    const m = name.match(re);
    if (!m) continue;
    const bare = m[1]!;
    out.add(bare);
    for (const p of prefixes) {
      out.add(p ? `${p} ${bare}`.trim() : bare);
    }
  }
  // Type-less: "Хрещатик" — also generate "вул. Хрещатик" etc so a
  // user who typed the full form still hits us.
  if (!/^(вулиця|проспект|бульвар|площа|провулок|набережна|узвіз)\s/i.test(name)) {
    out.add(`вул. ${name}`);
    out.add(`вулиця ${name}`);
  }
  return [...out].filter((x) => x.length > 0);
}

function buildCandidate(el: OverpassElement, category: string): Candidate | null {
  const tags = el.tags ?? {};
  const nameUk = tags['name:uk'] ?? tags['name'];
  if (!nameUk) return null;
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (lat == null || lng == null) return null;
  const nameEn = tags['name:en'] ?? null;
  const aliasSet = new Set<string>();
  aliasSet.add(nameUk);
  if (nameEn) aliasSet.add(nameEn);
  if (tags['name']) aliasSet.add(tags['name']);
  if (tags['alt_name']) {
    for (const a of tags['alt_name'].split(';')) aliasSet.add(a.trim());
  }
  if (tags['old_name']) {
    for (const a of tags['old_name'].split(';')) aliasSet.add(a.trim());
  }
  if (category === 'street') {
    for (const a of streetAliases(nameUk)) aliasSet.add(a);
  }
  if (category === 'metro' && !nameUk.toLowerCase().includes('метро')) {
    aliasSet.add(`метро ${nameUk}`);
    aliasSet.add(`м. ${nameUk}`);
  }
  const aliases = [...aliasSet];
  // Pre-joined + normalised: one trigram-indexed text blob per row.
  // Lookup probes this directly instead of a runtime
  // array_to_string(aliases, ' ') call, which Postgres rejects in
  // an index expression (array_to_string isn't IMMUTABLE).
  const aliasesText = aliases.map(normaliseName).join(' ');
  return {
    id: `osm:${el.type}:${el.id}`,
    osmType: el.type,
    osmId: String(el.id),
    lat,
    lng,
    nameUk,
    nameEn,
    aliases,
    aliasesText,
    searchKey: normaliseName(nameUk),
    category,
  };
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const limitArg = args.indexOf('--limit');
  const limit = limitArg >= 0 ? parseInt(args[limitArg + 1] ?? '0', 10) : 0;

  console.log(`▶ seed-gazetteer — dry=${dry} limit=${limit || 'none'}`);

  const all: Candidate[] = [];
  for (const chunk of QUERY_CHUNKS) {
    console.log(`  · ${chunk.label}`);
    const els = await fetchOverpassChunk(chunk.label, chunk.body);
    console.log(`    raw ${els.length}`);
    let kept = 0;
    for (const el of els) {
      const c = buildCandidate(el, chunk.category);
      if (c) {
        all.push(c);
        kept++;
      }
    }
    console.log(`    kept ${kept}`);
    await sleep(800);
  }

  // Dedup by id (an element can appear in two chunks for boundary
  // cases). Last write wins for category.
  const byId = new Map<string, Candidate>();
  for (const c of all) byId.set(c.id, c);
  const candidates = [...byId.values()];
  console.log(`  total ${candidates.length} unique candidates`);

  if (dry) {
    for (const c of candidates.slice(0, 20)) {
      console.log(
        `  [${c.category}] ${c.nameUk}  (${c.lat.toFixed(4)}, ${c.lng.toFixed(4)})  aliases: ${c.aliases.slice(0, 3).join(' | ')}${c.aliases.length > 3 ? ` +${c.aliases.length - 3}` : ''}`,
      );
    }
    console.log(`\n✓ dry run — would write ${candidates.length}`);
    return;
  }

  const work = limit > 0 ? candidates.slice(0, limit) : candidates;
  console.log(`  writing ${work.length}…`);

  // Batch inserts — Drizzle's onConflictDoUpdate handles the upsert
  // so re-runs refresh aliases / searchKey if normalisation logic
  // changes without needing a full wipe.
  const BATCH = 500;
  let writes = 0;
  for (let i = 0; i < work.length; i += BATCH) {
    const slice = work.slice(i, i + BATCH);
    await db
      .insert(schema.kyivGazetteer)
      .values(
        slice.map((c) => ({
          id: c.id,
          nameUk: c.nameUk,
          nameEn: c.nameEn,
          aliases: c.aliases,
          aliasesText: c.aliasesText,
          searchKey: c.searchKey,
          category: c.category,
          lat: c.lat,
          lng: c.lng,
          osmType: c.osmType,
          osmId: c.osmId,
        })),
      )
      .onConflictDoUpdate({
        target: schema.kyivGazetteer.id,
        set: {
          nameUk: sql`excluded.name_uk`,
          nameEn: sql`excluded.name_en`,
          aliases: sql`excluded.aliases`,
          aliasesText: sql`excluded.aliases_text`,
          searchKey: sql`excluded.search_key`,
          category: sql`excluded.category`,
          lat: sql`excluded.lat`,
          lng: sql`excluded.lng`,
        },
      });
    writes += slice.length;
    console.log(`  ${writes}/${work.length}`);
  }

  console.log(`\n✓ done. wrote ${writes} rows.`);
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
