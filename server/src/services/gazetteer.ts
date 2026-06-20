// Fuzzy place-name lookup against kyiv_gazetteer. The lost-pet parser
// extracts free-text location mentions from a post ("на Львівській
// площі", "вул. Бандери 12") and calls this to resolve them to real
// coordinates. Replaces the ~30-entry hard-coded hints table that
// only knew a handful of central squares.
//
// Implementation notes:
//   - Uses Postgres pg_trgm word_similarity (<% operator + function
//     of the same name). word_similarity is asymmetric and is built
//     for exactly this scenario — "how well does the query word
//     match SOMEWHERE inside the indexed text" — better than the
//     symmetric similarity() for short user queries vs long alias
//     blobs.
//   - We probe two indexed sources: search_key (canonical normalised
//     name) and aliases_text (pre-joined alias blob, materialised at
//     seed time because array_to_string isn't IMMUTABLE and so can't
//     live inside an index expression). Both backed by GIN trigram
//     indexes (migration 0012). The lookup takes the max of both
//     scores so a hit on either path wins.
//   - normaliseQuery mirrors normaliseName in seed-gazetteer.ts so
//     "Львівській" (locative case) normalises the same way the index
//     does for "львівська" canonical — and trigram absorbs the rest
//     of the inflection variance.
//   - Threshold is conservative (0.55) — high enough that "загубив
//     гаманець" (lost wallet) doesn't match a street nor a square,
//     low enough that real inflected mentions land. Tune if false
//     positives or false negatives show up in scrape_log.

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

const MIN_SIMILARITY = 0.55;
const MIN_QUERY_LEN = 2;

export interface GazetteerHit {
  id: string;
  nameUk: string;
  nameEn: string | null;
  category: string;
  lat: number;
  lng: number;
  similarity: number;
}

// Same normalisation the seed uses. Kept in sync by hand because
// importing across the server↔seed boundary creates a dotenv cycle.
function normaliseQuery(s: string): string {
  return s
    .toLowerCase()
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’`ʼ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface GazetteerRow {
  id: string;
  name_uk: string;
  name_en: string | null;
  category: string;
  lat: number;
  lng: number;
  sim: number;
}

export async function lookupPlace(query: string): Promise<GazetteerHit | null> {
  const q = normaliseQuery(query);
  if (q.length < MIN_QUERY_LEN) return null;

  const rows = (await db.execute(sql`
    SELECT id, name_uk, name_en, category, lat, lng,
      GREATEST(
        word_similarity(${q}, search_key),
        word_similarity(${q}, aliases_text)
      ) AS sim
    FROM kyiv_gazetteer
    WHERE ${q} <% search_key OR ${q} <% aliases_text
    ORDER BY sim DESC
    LIMIT 1
  `)) as unknown as GazetteerRow[];

  const first = rows[0];
  if (!first || first.sim < MIN_SIMILARITY) return null;
  return {
    id: first.id,
    nameUk: first.name_uk,
    nameEn: first.name_en,
    category: first.category,
    lat: first.lat,
    lng: first.lng,
    similarity: first.sim,
  };
}

// Lookup the best match across an array of mentions. Returns the
// hit with the highest similarity, OR null if nothing crosses the
// threshold. Used by the parser when Haiku extracted 2-3 location
// strings and we want the strongest signal.
export async function lookupBestPlace(
  queries: string[],
): Promise<GazetteerHit | null> {
  let best: GazetteerHit | null = null;
  for (const q of queries) {
    const hit = await lookupPlace(q);
    if (hit && (!best || hit.similarity > best.similarity)) best = hit;
  }
  return best;
}
