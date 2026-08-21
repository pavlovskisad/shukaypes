// FIND THE PLACE THE OWNER WROTE, IN A TABLE WE ALREADY HAVE.
//
// Pet placement currently works like this: the parser hands the model a
// list of 35 Kyiv landmarks and asks it to infer lat/lng. Measured on
// production, of 176 active pets —
//
//   80  landed on the fall-through coordinate and are invisible on the
//       map, because both map queries filter that point exactly
//   69  reproduce exactly as jitterAround(<a landmark>, id, 120), so
//       they are the model's nearest guess rather than an address
//   27  everything else
//
// 85% of the map is a guess or a hole. Meanwhile kyiv_gazetteer holds
// 16,917 real places — 15,948 streets, 415 neighbourhoods, 307 parks,
// 159 metro stations, 82 squares, 80 districts — and nothing in the
// ingest path reads it. Every place that turned up misplaced in the
// audit (Софіївська Борщагівка, Васильків, Зазим'я, Бортничі,
// Виноградар) was matched FROM that table. It is not missing anything.
//
// PURE ON PURPOSE. Places come in as an argument rather than being
// queried here, so this can be exercised by a fixture check with no
// database — the same reason extractAdBody lives apart from olx.ts.
//
// WHAT IT WILL NOT DO. It does not invent a coordinate. When nothing
// matches it returns null and the caller keeps whatever it had, because
// a confident wrong street is worse than an honest fall-through: the
// walker goes out, searches the wrong neighbourhood, and reports nothing
// — and to them the app simply lied.

export interface GazetteerPlace {
  name: string;
  lat: number;
  lng: number;
  category: string;
}

export interface ResolvedPlace {
  name: string;
  lat: number;
  lng: number;
  category: string;
  /** The owner wrote вул./проспект/район in front of it. */
  marked: boolean;
}

// Short names match everything. «Лісова» is a metro station, a street
// and an adjective; six characters is where a match starts to mean
// something.
const MIN_PLACE_CHARS = 6;

// What somebody writes in front of a name when they mean a place. The
// text is normalised before this runs, so «вул.» is already «вул».
const MARKERS =
  /(вул|вулиц|просп|проспект|бульвар|площ|провул|мкр|масив|район|селищ|село|смт|метро|станц|жм)\s*$/;

// A street is a block; a district is four kilometres across. When both
// match, the narrower one is the more useful answer — and when only a
// district matches, that is still far better than the wrong side of the
// city.
const SPECIFICITY: Record<string, number> = {
  street: 5,
  square: 4,
  park: 4,
  metro: 3,
  neighbourhood: 2,
  district: 1,
};

export function normalisePlaceText(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’ʼ`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * The best place named in `text`, or null when nothing is named.
 *
 * Ranking, in order: marked beats bare, then more specific beats less,
 * then longer beats shorter. Marked comes first because «вул. Садова»
 * is an address and a bare «садова» is very often just a word — the
 * audit that motivated this matched four pets on «Собачка», which is a
 * real Kyiv street and also what you call a small dog.
 */
export function resolvePlace(text: string, places: GazetteerPlace[]): ResolvedPlace | null {
  if (!text) return null;
  const hay = normalisePlaceText(text);
  if (!hay) return null;

  let best: ResolvedPlace | null = null;
  let bestScore = -1;

  for (const p of places) {
    const key = normalisePlaceText(p.name);
    if (key.length < MIN_PLACE_CHARS) continue;
    const at = hay.indexOf(key);
    if (at < 0) continue;

    const before = hay.slice(Math.max(0, at - 22), at);
    const marked = MARKERS.test(before);
    // Marked dominates everything else, then specificity, then length.
    // Scaled so no combination of the lower two can outrank a marked
    // match — that ordering is the whole defence against prose.
    const score =
      (marked ? 10_000 : 0) + (SPECIFICITY[p.category] ?? 0) * 100 + Math.min(key.length, 60);

    if (score > bestScore) {
      bestScore = score;
      best = { name: p.name, lat: p.lat, lng: p.lng, category: p.category, marked };
    }
  }

  return best;
}
