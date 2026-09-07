// The OSM side of the lore corpus: the Overpass queries that define the
// population, and the tags on each object that are worth keeping.
//
// Shared by seed-lore.ts (first write) and enrich-lore.ts (the facts
// pass, for rows seeded before facts existed). The queries are the
// definition of "a Kyiv landmark" for this app — change them here and
// both scripts agree on the population.

// Kyiv bbox (south, west, north, east) — Overpass takes (S,W,N,E).
// Pulled from OSM's "Kyiv" relation bounds, padded slightly.
const KYIV_BBOX = [50.21, 30.24, 50.59, 30.83] as const;

// Query split into category chunks so any one Overpass call stays
// small enough to dodge "server too busy" 504s. Each chunk returns a
// few hundred elements rather than ~2k in one go.
export const QUERY_CHUNKS: Array<{ label: string; body: string }> = [
  {
    label: 'historic+memorial',
    body: `
[out:json][timeout:120];
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
[out:json][timeout:120];
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
[out:json][timeout:120];
(
  way["building"~"^(cathedral|church|chapel|synagogue|mosque|temple)$"](${KYIV_BBOX.join(',')});
  relation["building"~"^(cathedral|church|chapel|synagogue|mosque|temple)$"](${KYIV_BBOX.join(',')});
);
out center tags;`.trim(),
  },
  {
    label: 'monuments',
    body: `
[out:json][timeout:120];
(
  node["man_made"="obelisk"](${KYIV_BBOX.join(',')});
  way["man_made"="obelisk"](${KYIV_BBOX.join(',')});
  node["man_made"="tower"]["tower:type"!="communication"](${KYIV_BBOX.join(',')});
);
out center tags;`.trim(),
  },
];

// Public Overpass endpoints, tried in turn. On a bad day every one of
// them answers 503/504 for a while; the rounds below wait it out rather
// than give up, because a partial population is a wrong population.
const OVERPASS_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const ROUNDS = 4;
const REQUEST_TIMEOUT_MS = 150_000;

export interface OverpassElement {
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchOverpassChunk(label: string, body: string): Promise<OverpassElement[]> {
  let lastErr = 'unknown';
  for (let round = 0; round < ROUNDS; round++) {
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            accept: 'application/json',
            'user-agent': 'shukajpes-lore-seed/1.0 (contact: pavlovskisad@gmail.com)',
          },
          body: `data=${encodeURIComponent(body)}`,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!res.ok) {
          lastErr = `${res.status} from ${endpoint}`;
          console.log(`    ${label}: ${lastErr}`);
          await sleep(4000);
          continue;
        }
        const json = (await res.json()) as OverpassResult;
        return json.elements;
      } catch (err) {
        lastErr = `${(err as Error).message} from ${endpoint}`;
        console.log(`    ${label}: ${lastErr}`);
        await sleep(3000);
      }
    }
    const wait = 15_000 * (round + 1);
    console.log(`    ${label}: every endpoint busy, waiting ${wait / 1000}s…`);
    await sleep(wait);
  }
  throw new Error(`overpass chunk ${label} failed on all endpoints: ${lastErr}`);
}

// The whole population, all chunks.
export async function fetchLoreElements(): Promise<OverpassElement[]> {
  console.log('→ querying Overpass in chunks…');
  const all: OverpassElement[] = [];
  for (const chunk of QUERY_CHUNKS) {
    console.log(`  · ${chunk.label}`);
    const els = await fetchOverpassChunk(chunk.label, chunk.body);
    console.log(`    got ${els.length}`);
    all.push(...els);
    // Polite gap between chunks so we don't hammer one endpoint.
    await sleep(1500);
  }
  console.log(`  total ${all.length} elements across ${QUERY_CHUNKS.length} chunks`);
  return all;
}

export function pickCategory(tags: Record<string, string>): string {
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

// What the mapper wrote on the object beyond its name. Measured on the
// September population: of the ~2500 rows with no Wikipedia or Wikidata
// tag, 542 carry the plaque's INSCRIPTION, 151 a description, 165 a
// date, 150 an artist, 125 the Wikidata id of the person or event the
// memorial is FOR. The seed read none of it, and wrote those rows "a
// thin sensory line, no fabricated facts" for want of anything else.
// This is that something else.
export interface LoreFacts {
  // The text on the plaque or pedestal, as mapped.
  inscription?: string;
  description?: string;
  // start_date — when the memorial was put up, or the building built.
  startDate?: string;
  // The entity the memorial commemorates (subject:wikidata), and the
  // article about it if the mapper linked one (subject:wikipedia, as
  // "uk:Title").
  subjectWikidata?: string;
  subjectWikipedia?: { lang: string; title: string };
  artist?: string;
  architect?: string;
  // memorial=plaque|bust|statue|…, historic=…, artwork_type=…
  kind?: string;
  material?: string;
}

export function parseWikipediaTag(value: string | undefined): { lang: string; title: string } | null {
  if (!value) return null;
  const m = value.match(/^([a-z-]+):(.+)$/);
  if (!m) return null;
  return { lang: m[1]!, title: m[2]! };
}

export function factsFromTags(tags: Record<string, string>): LoreFacts | null {
  const f: LoreFacts = {};
  const inscription = tags['inscription:uk'] ?? tags['inscription'];
  if (inscription) f.inscription = inscription.trim();
  const description = tags['description:uk'] ?? tags['description'];
  if (description) f.description = description.trim();
  if (tags['start_date']) f.startDate = tags['start_date'];
  if (tags['subject:wikidata']) f.subjectWikidata = tags['subject:wikidata'];
  const sw = parseWikipediaTag(tags['subject:wikipedia']);
  if (sw) f.subjectWikipedia = sw;
  if (tags['artist_name']) f.artist = tags['artist_name'];
  if (tags['architect']) f.architect = tags['architect'];
  const kind =
    tags['memorial'] && tags['memorial'] !== 'yes'
      ? `memorial:${tags['memorial']}`
      : tags['artwork_type']
        ? `artwork:${tags['artwork_type']}`
        : tags['historic'] && tags['historic'] !== 'yes'
          ? `historic:${tags['historic']}`
          : null;
  if (kind) f.kind = kind;
  if (tags['material']) f.material = tags['material'];
  return Object.keys(f).length > 0 ? f : null;
}

// The facts as lines of a research blob for the writer prompts.
export function factsLines(f: LoreFacts | null): string[] {
  if (!f) return [];
  return [
    f.kind ? `- kind: ${f.kind}` : null,
    f.inscription ? `- inscription on it: ${f.inscription.slice(0, 600)}` : null,
    f.description ? `- description: ${f.description.slice(0, 600)}` : null,
    f.startDate ? `- date: ${f.startDate}` : null,
    f.artist ? `- artist: ${f.artist}` : null,
    f.architect ? `- architect: ${f.architect}` : null,
    f.material ? `- material: ${f.material}` : null,
  ].filter((x): x is string => !!x);
}

// Whether the facts alone are enough to write a longer telling from.
// A date and a material are not — the writer would have to invent the
// rest. The plaque's own text, a description, or a commemorated subject
// (whose article the link phase fetches) is.
export function factsCarryResearch(f: LoreFacts | null): boolean {
  return !!f && (!!f.inscription || !!f.description || !!f.subjectWikidata || !!f.subjectWikipedia);
}
