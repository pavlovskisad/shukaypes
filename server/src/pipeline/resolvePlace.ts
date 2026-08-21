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
  // ALREADY IN THE TABLE, AND I WAS NOT READING IT.
  //
  // kyiv_gazetteer.aliases exists for exactly the case that defeated the
  // first three rounds of this: «Подольском районе» is Подільський
  // район written in Russian, and the schema comment says aliases hold
  // "alternate spellings/inflections (e.g. 'Khreshchatyk' for
  // 'Хрещатик')". The probe reported twelve Kyiv places as "not in the
  // gazetteer" while matching against nameUk alone.
  aliases?: string[];
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
// Written against the EXPANDED forms, because normalisePlaceText has
// already turned «вул.» into «вулиця» by the time this runs. The first
// version listed the abbreviations and stopped matching the moment
// expansion landed — the marker silently went missing and every address
// downgraded to a bare name.
//
// The trailing \p{L}{0,3} carries the case ending: «на вулиці Садовій»,
// «в районі», «біля станції» are all how this appears in a real post.
const MARKERS =
  /(вулиц|проспект|бульвар|площ|провул|мікрорайон|масив|район|селищ|село|смт|метро|станц)\p{L}{0,3}\s*$/u;

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

// ABBREVIATIONS, EXPANDED ON BOTH SIDES.
//
// «Оболонський р-н» and «Оболонський район» are the same words, and the
// first is how people type. Stripping punctuation turns «р-н» into
// «р н», which matches nothing — so the gazetteer entry «Оболонський
// район» was invisible to any ad that abbreviated it, and the audit
// counted those ads as naming no place at all.
//
// Expanding is better than stemming harder here. Stemming «район» to
// «рай» would match «райдужний» and every other word starting that way;
// spelling the abbreviation out leaves an exact, unambiguous token. Run
// over the gazetteer name too, so both sides normalise to one form and
// neither has to know what the other did.
// Matched on TOKENS, not with \b. JavaScript's \b is ASCII-only: «й» is
// not a word character to the engine, so /\bр н\b/ never fires inside
// Cyrillic text and the whole expansion silently does nothing. The
// fixture for «Солом'янський р-н» caught that on the first run.
const ABBREV_PAIRS: Record<string, string> = {
  'р н': 'район',
  'пр т': 'проспект',
  'ж м': 'житловий масив',
};
const ABBREV_WORDS: Record<string, string> = {
  рн: 'район',
  вул: 'вулиця',
  ул: 'вулиця',
  просп: 'проспект',
  бул: 'бульвар',
  пров: 'провулок',
  мкр: 'мікрорайон',
};

export function normalisePlaceText(s: string): string {
  const tokens = s
    .toLowerCase()
    .replace(/['’ʼ`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const pair = `${tokens[i]} ${tokens[i + 1] ?? ''}`;
    if (ABBREV_PAIRS[pair]) {
      out.push(ABBREV_PAIRS[pair]!);
      i++;
      continue;
    }
    out.push(ABBREV_WORDS[tokens[i]!] ?? tokens[i]!);
  }
  return out.join(' ');
}

// UKRAINIAN INFLECTS, AND THE FIRST VERSION OF THIS DID NOT KNOW.
//
// Matching the gazetteer name as an exact substring finds «Оболонь» and
// misses «на Оболоні», «з Троєщини», «біля Лукʼянівки» — which is how
// people actually write about where they lost an animal. Measured
// against the 80 invisible pets it found a place in 6 of them and
// reported 74 as "no place named", a number that would have killed this
// whole approach on a defect in the matcher.
//
// keywords.ts already says it: "Stems over full forms — Ukrainian/
// Russian inflect heavily so we match on roots". Same rule, applied here
// too late.
//
// The stem is the name minus its case ending. Trimming two characters
// covers -ою -ій -ах -ів -ями and the rest; the floor of five keeps the
// stem long enough to still mean something, so «Лісова» stems to «лісов»
// and not to noise.
// Trim one character, then two: -ої and -ів need two, but «Лісова» →
// «Лісової» only needs one, and a fixed trim of two takes «лісов» below
// the floor and finds nothing at all. Longest stem first, so the
// tightest match that can work is the one used.
const STEM_TRIMS = [1, 2];
const MIN_STEM_CHARS = 5;

export function placeStems(key: string): string[] {
  const words = key.split(' ');
  const last = words[words.length - 1]!;
  const out: string[] = [];
  for (const trim of STEM_TRIMS) {
    if (last.length - trim < MIN_STEM_CHARS) continue;
    out.push([...words.slice(0, -1), last.slice(0, last.length - trim)].join(' '));
  }
  return out;
}

// THE GENERIC WORD IS NOT PART OF THE NAME.
//
// The gazetteer stores «Армійська вулиця» and «Солом'янський район»;
// an ad writes «районі вулиць Архипенка-Йорданська». Requiring the
// generic word to appear, in that form, next to the name means «вулиць»
// (plural) defeats «вулиця» (singular) — on a word carrying no
// information at all. Twelve real Kyiv places came back as "not in the
// gazetteer" and this is part of why.
//
// So a place offers two keys: its full name, and its name with the
// generic word taken off. «армійська» matches «вулиць Армійська» and
// «на Армійській» alike, while the full form still scores higher when
// it is actually present.
const GENERIC_WORDS = new Set([
  'вулиця',
  'проспект',
  'бульвар',
  'площа',
  'провулок',
  'мікрорайон',
  'масив',
  'район',
  'селище',
  'село',
  'станція',
  'житловий',
]);

function stripGeneric(key: string): string {
  const kept = key.split(' ').filter((w) => !GENERIC_WORDS.has(w));
  return kept.join(' ');
}

/** Every spelling of this place we are willing to look for. */
export function matchKeys(p: GazetteerPlace): string[] {
  const keys = new Set<string>();
  for (const raw of [p.name, ...(p.aliases ?? [])]) {
    if (!raw) continue;
    const key = normalisePlaceText(raw);
    if (key.length >= MIN_PLACE_CHARS) keys.add(key);
    const bare = stripGeneric(key);
    if (bare !== key && bare.length >= MIN_PLACE_CHARS) keys.add(bare);
  }
  return [...keys];
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

  const hits: { place: ResolvedPlace; key: string; score: number }[] = [];

  for (const p of places) {
    for (const key of matchKeys(p)) {
      // Exact first, stem second. An exact hit is worth more than an
      // inflected one and should not be outranked by a longer stem match.
      let at = hay.indexOf(key);
      const exact = at >= 0;
      if (at < 0) {
        for (const stem of placeStems(key)) {
          at = hay.indexOf(stem);
          if (at >= 0) break;
        }
        if (at < 0) continue;
      }

      const before = hay.slice(Math.max(0, at - 22), at);
      const marked = MARKERS.test(before);
      // Marked dominates everything else, then specificity, then length.
      // Scaled so no combination of the lower two can outrank a marked
      // match — that ordering is the whole defence against prose.
      const score =
        (marked ? 10_000 : 0) +
        (exact ? 1_000 : 0) +
        (SPECIFICITY[p.category] ?? 0) * 100 +
        Math.min(key.length, 60);

      hits.push({
        place: { name: p.name, lat: p.lat, lng: p.lng, category: p.category, marked },
        key,
        score,
      });
    }
  }

  if (hits.length === 0) return null;

  // CONTAINMENT FIRST, BEFORE ANY SCORE.
  //
  // «Софіївська Борщагівка» is a village 8km from Kyiv's «Борщагівка»,
  // and an ad naming the first contains the second as a substring. On
  // the production dry run the shorter one won — it is categorised as a
  // street, and a street outranks a neighbourhood — so a pet would have
  // been moved confidently into the wrong district.
  //
  // When one matched name contains another, they are not two candidates.
  // They are one place named at two precisions, and the longer name is
  // the one the owner actually wrote. No category ranking should be able
  // to overturn that, so this happens before scoring rather than inside
  // it.
  const survivors = hits.filter(
    (h) => !hits.some((other) => other !== h && other.key.includes(h.key)),
  );

  survivors.sort((a, b) => b.score - a.score);
  return survivors[0]?.place ?? null;
}
