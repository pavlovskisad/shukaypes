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
  /(вулиц|проспект|бульвар|площ|провул|мікрорайон|масив|район|селищ|село|смт|метро|станц|парк)\p{L}{0,3}\s*$/u;

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
    // ONE ALPHABET FOR TWO LANGUAGES.
    //
    // The gazetteer is Ukrainian; 65 of the 126 ads the resolver refused
    // are written in Russian, which is the largest single reason it
    // finds nothing. «Уманська» and «Уманская» are the same street, but
    // stemming cannot bridge them: «уманськ» and «уманск» differ by a
    // soft sign, and no amount of trimming the ending fixes a
    // difference in the middle.
    //
    // Folding the letters that differ between the two orthographies —
    // and dropping the signs that carry no sound of their own — lands
    // both spellings on one string. Applied to the gazetteer name and
    // the ad alike, so neither side has to know what the other did.
    //
    // It does make the matcher slightly blunter: «Лісова» and «Лисова»
    // fold together too. The marker requirement in front of street
    // names is what keeps that from becoming a wrong address.
    .replace(/[ьъ]/g, '')
    .replace(/[іїы]/g, 'и')
    .replace(/[єэ]/g, 'е')
    .replace(/ґ/g, 'г')
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

// HOW FAR APART TWO PIECES OF ONE PLACE MAY SIT — see "ONE NAME, MANY
// PLACES" below.
//
// This is a LINK distance, not a diameter, and the difference is the
// whole bug it replaces. The first version asked whether any two
// same-named rows were more than a kilometre apart and refused the name
// if so. But OSM stores a street as a chain of segments, and «Уманська
// вулиця» is eleven rows spanning 1.3 km — so the test that was meant
// to catch two different places called Набережна threw away a perfectly
// good address, and a cat whose ad named her street sat five kilometres
// away on a landmark guess instead. Measured against the table: 141
// names are one continuous street wider than a kilometre.
//
// Chaining tells the two apart. Consecutive segments of one street are
// a few hundred metres apart at most, so they link into a single group
// however long the street runs; two streets of the same name in
// different districts are kilometres from any of each other's pieces
// and stay separate. 600 m is comfortably above the gap between
// segments (a street interrupted by a park still links) and comfortably
// below the distance between genuine namesakes.
const NAMESAKE_LINK_M = 600;

interface Namesake {
  /** How many separated groups the places of this name form. */
  clusters: number;
  /** The middle of them all. Meaningful only when `clusters` is 1. */
  lat: number;
  lng: number;
}

function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = (a.lat - b.lat) * 111_320;
  const dLng = (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

/**
 * Single-linkage grouping: two points join when they are within
 * NAMESAKE_LINK_M of each other, and the relation chains through
 * intermediate points — which is what makes a string of street
 * segments one group rather than many.
 */
function describeNamesake(points: { lat: number; lng: number }[]): Namesake {
  if (points.length === 0) return { clusters: 1, lat: 0, lng: 0 };
  const seen = new Array<boolean>(points.length).fill(false);
  let clusters = 0;
  for (let i = 0; i < points.length; i++) {
    if (seen[i]) continue;
    clusters++;
    const queue = [i];
    seen[i] = true;
    while (queue.length > 0) {
      const cur = queue.pop()!;
      for (let j = 0; j < points.length; j++) {
        if (seen[j]) continue;
        if (metresBetween(points[cur]!, points[j]!) <= NAMESAKE_LINK_M) {
          seen[j] = true;
          queue.push(j);
        }
      }
    }
  }
  let lat = 0;
  let lng = 0;
  for (const p of points) {
    lat += p.lat;
    lng += p.lng;
  }
  return { clusters, lat: lat / points.length, lng: lng / points.length };
}

// Grouping a name costs O(n²) in its row count, and the same names come
// up ad after ad, so each is described once per gazetteer array and kept
// — lazily, because only the names an ad actually mentions are ever
// asked about.
const NAMESAKE_CACHE = new WeakMap<GazetteerPlace[], Map<string, Namesake>>();

function namesakeOf(name: string, places: GazetteerPlace[]): Namesake {
  let per = NAMESAKE_CACHE.get(places);
  if (!per) {
    per = new Map();
    NAMESAKE_CACHE.set(places, per);
  }
  const cached = per.get(name);
  if (cached) return cached;
  const described = describeNamesake(buildNameIndex(places).get(name) ?? []);
  per.set(name, described);
  return described;
}

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

// MEMOISED, because the keys depend only on the place and the caller
// asks for them once per PET. The gazetteer is 16,917 rows and the audit
// runs 176 pets against it — recomputing normalisation every time meant
// several million token-splits per run, and the first pass after aliases
// landed took long enough to time out a five-minute command.
//
// A WeakMap keyed on the row object: computed once, dropped when the
// caller drops the array, and no cache to invalidate.
const KEY_CACHE = new WeakMap<GazetteerPlace, string[]>();

// The longest name anybody writes out: «вулиця Олександра Архипенка».
export const MAX_GRAM_WORDS = 4;

// key (and every stem of it) → the places that answer to it.
//
// Built once per gazetteer array and cached on the array itself, so a
// caller that loads the table once pays for this once — including the
// ingest path, where the alternative is rebuilding 16,917 rows' worth of
// keys for every pet that arrives.
const INDEX_CACHE = new WeakMap<GazetteerPlace[], Map<string, GazetteerPlace[]>>();

// Normalised name → every place carrying it, for the namesake half of
// the ambiguity check. Cached per array for the same reason the main
// index is: built once, consulted per pet.
const NAME_INDEX_CACHE = new WeakMap<GazetteerPlace[], Map<string, GazetteerPlace[]>>();

function buildNameIndex(places: GazetteerPlace[]): Map<string, GazetteerPlace[]> {
  const cached = NAME_INDEX_CACHE.get(places);
  if (cached) return cached;
  const index = new Map<string, GazetteerPlace[]>();
  for (const p of places) {
    const name = normalisePlaceText(p.name);
    const bucket = index.get(name);
    if (bucket) bucket.push(p);
    else index.set(name, [p]);
  }
  NAME_INDEX_CACHE.set(places, index);
  return index;
}

export function buildPlaceIndex(places: GazetteerPlace[]): Map<string, GazetteerPlace[]> {
  const cached = INDEX_CACHE.get(places);
  if (cached) return cached;

  const index = new Map<string, GazetteerPlace[]>();
  const add = (key: string, p: GazetteerPlace) => {
    // MIN_STEM_CHARS, not MIN_PLACE_CHARS. The six-character floor
    // belongs on the place NAME — matchKeys already applies it — and a
    // stem is deliberately shorter: «Лісова» stems to «лісов», five
    // characters, which the stricter floor silently refused to index.
    // «біля Лісової» then resolved to nothing.
    if (key.length < MIN_STEM_CHARS) return;
    // More words than a text n-gram can ever be is a key nothing will
    // look up — indexing it only grows the map.
    if (key.split(' ').length > MAX_GRAM_WORDS) return;
    const bucket = index.get(key);
    if (bucket) bucket.push(p);
    else index.set(key, [p]);
  };

  for (const p of places) {
    for (const key of matchKeys(p)) {
      add(key, p);
      // Index the stems too, so an inflected n-gram from the ad and the
      // table's nominative meet at the same string.
      for (const stem of placeStems(key)) add(stem, p);
    }
  }

  INDEX_CACHE.set(places, index);
  return index;
}

/** Every spelling of this place we are willing to look for. */
export function matchKeys(p: GazetteerPlace): string[] {
  const cached = KEY_CACHE.get(p);
  if (cached) return cached;

  const keys = new Set<string>();
  for (const raw of [p.name, ...(p.aliases ?? [])]) {
    if (!raw) continue;
    const key = normalisePlaceText(raw);
    if (key.length >= MIN_PLACE_CHARS) keys.add(key);
    const bare = stripGeneric(key);
    if (bare !== key && bare.length >= MIN_PLACE_CHARS) keys.add(bare);
  }

  const out = [...keys];
  KEY_CACHE.set(p, out);
  return out;
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

  const index = buildPlaceIndex(places);
  const words = hay.split(' ').filter(Boolean);
  const hits: { place: ResolvedPlace; key: string; score: number }[] = [];

  // WALK THE TEXT, NOT THE TABLE.
  //
  // The previous version asked every one of 16,917 places whether it
  // appeared in the ad — 50,000 substring searches over a 2KB string,
  // per pet. It took long enough to time out a five-minute command, and
  // it is the same call that would run per pet at ingest.
  //
  // An ad is a few hundred words. Looking up its n-grams in a prepared
  // map is bounded by the AD's length instead of the gazetteer's, which
  // is the difference between a lookup and a scan.
  //
  // Four words, because «вулиця Олександра Архипенка» is three and a
  // marker in front makes four; nothing in the table is longer that a
  // person would write out.
  for (let i = 0; i < words.length; i++) {
    for (let n = 1; n <= MAX_GRAM_WORDS && i + n <= words.length; n++) {
      const gram = words.slice(i, i + n).join(' ');
      if (gram.length < MIN_PLACE_CHARS) continue;

      // Exact first, stem second, and BOTH sides are stemmed to the same
      // form — the index holds each key's stems too, so «оболоні» in an
      // ad and «Оболонь» in the table meet at «оболон».
      let found = index.get(gram);
      const exact = found !== undefined;
      if (!found) {
        for (const stem of placeStems(gram)) {
          found = index.get(stem);
          if (found) break;
        }
      }
      if (!found) continue;

      const before = words.slice(Math.max(0, i - 2), i).join(' ');
      const marked = MARKERS.test(before);

      for (const p of found) {
        // A BARE STREET NAME IS NOT AN ADDRESS.
        //
        // 15,948 of the table's 16,917 places are streets, and street
        // names are ordinary words: «Собачка» is a street and what you
        // call a small dog, «Садова» is a street and «садова ділянка»,
        // «Лісова» is a street and the forest the cat ran into. With
        // that many candidates, any adjective in an ad probably IS some
        // street's name — which is exactly the confident-wrong-«Садова»
        // failure this file's header warns about. So a street only
        // counts when the owner marked it as one («вул. Зодчих»). The
        // bare categories that remain — neighbourhoods, districts,
        // metro, parks, squares — are ~1,000 distinctive proper names
        // people genuinely write without a marker («Троєщина»).
        //
        // The cost is real and accepted: «на Армійській загубився кіт»
        // no longer resolves. The asymmetry decides it — a miss keeps
        // the fall-through we already have; a wrong street sends a
        // person to walk the wrong end of the city.
        //
        // Parks earn the same rule, and the production dry run is why:
        // «Собачка» turned out to be categorised as a PARK in the real
        // table, and four pets whose ads merely said "little dog" would
        // have moved onto it. Park names are common nouns more often
        // than any other category — Собачка, Перемога, Юність, Дружба —
        // so a park counts only when the ad writes «парк» next to it
        // (which MARKERS now recognises).
        if (!marked && (p.category === 'street' || p.category === 'park')) continue;
        // Score on the MATCHED gram, not the place's full name. An ad
        // writing «Архипенка» should not inherit the length of
        // «вулиця Олександра Архипенка» it happened to hit — the score
        // is meant to reward what the owner actually wrote.
        const score =
          (marked ? 10_000 : 0) +
          (exact ? 1_000 : 0) +
          (SPECIFICITY[p.category] ?? 0) * 100 +
          Math.min(gram.length, 60);

        hits.push({
          place: { name: p.name, lat: p.lat, lng: p.lng, category: p.category, marked },
          key: gram,
          score,
        });
      }
    }
  }

  if (hits.length === 0) return null;

  // ONE NAME, MANY PLACES: REFUSE, DON'T FLIP A COIN.
  //
  // «Набережна вулиця» exists in half the settlements the table covers,
  // and the production dry run showed what picking the first bucket
  // entry does: a pet 25 km from where its ad put it, under a "marked,
  // high confidence" label. Marking doesn't help — «вул. Набережна»
  // says it is a street, not WHICH of five. When the places answering
  // to one key sit further apart than a search zone, the name alone
  // cannot place a pet, so every hit on that key is dropped and the
  // ad's other names (if any) still get their chance.
  //
  // What counts as "many places" is CHAINING, not width — see
  // NAMESAKE_LINK_M. A street stored as a line of segments is one
  // answer however long it runs; two streets of one name in different
  // districts are two answers however tidy each is.
  //
  // Grouped two ways, because the same ambiguity hides behind either:
  //
  //   by AD GRAM — «садов» in the text reaches both «Садова» and
  //   «Садове» through a shared stem; the name alone can't say which.
  //
  //   by PLACE NAME — three places are all called «Перемога», and the
  //   production dry run proved the gram grouping alone misses this: an
  //   ad written in Russian said «Победа», ONE of the three carried
  //   that alias, so its gram-bucket held one place and the refusal
  //   never fired — a coin-flip between three Перемогаs dressed up as
  //   an unambiguous hit. Grouping by the place's own normalised name
  //   catches it whichever spelling the ad used.
  const ambiguousKeys = new Set<string>();
  const ambiguousNames = new Set<string>();
  {
    const byKey = new Map<string, { lat: number; lng: number }[]>();
    for (const h of hits) {
      const bucket = byKey.get(h.key);
      if (bucket) bucket.push(h.place);
      else byKey.set(h.key, [h.place]);
    }
    for (const [key, coords] of byKey) {
      if (describeNamesake(coords).clusters > 1) ambiguousKeys.add(key);
    }
    // The name grouping consults the whole TABLE, not just the hits —
    // the other two «Перемога» rows never produced a hit (that was the
    // hole), so only the table itself can reveal them.
    for (const h of hits) {
      const name = normalisePlaceText(h.place.name);
      if (ambiguousNames.has(name)) continue;
      if (namesakeOf(name, places).clusters > 1) ambiguousNames.add(name);
    }
  }
  const unambiguous = hits.filter(
    (h) => !ambiguousKeys.has(h.key) && !ambiguousNames.has(normalisePlaceText(h.place.name)),
  );
  if (unambiguous.length === 0) return null;

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
  // STRICTLY LONGER, and the word "strictly" is load-bearing.
  //
  // Written as `other !== h && other.key.includes(h.key)`, two hits with
  // the SAME key cancelled each other: «оболоні» contains «оболоні», the
  // objects differ, so each dropped the other and the function returned
  // null. Any ad naming a place twice — the title and then the body,
  // which is most of them — resolved to nothing at all.
  //
  // It only showed up under repetition, so every fixture passed and a
  // 16,917-place benchmark caught it by accident. Comparing length
  // first restores the intent: a longer name supersedes the shorter one
  // inside it, and an equal name is the same match seen twice.
  const survivors = unambiguous.filter(
    (h) =>
      !unambiguous.some((other) => other.key.length > h.key.length && other.key.includes(h.key)),
  );

  survivors.sort((a, b) => b.score - a.score);
  const winner = survivors[0];
  if (!winner) return null;

  // THE MIDDLE OF THE STREET, NOT WHICHEVER PIECE SORTED FIRST.
  //
  // Eleven rows say «Уманська вулиця» and they are eleven segments of
  // one road. They all match, they all score identically, and which one
  // came out on top was down to the order the table was read in — so
  // the same ad could land a pet at either end of a 1.3 km street.
  //
  // Everything that survives to here is a single linked group (the
  // check above dropped the rest), so its centre is a real answer: on a
  // straight street it is the middle, and the search radius — 500 m at
  // its tightest — covers the length from there. On an L-shaped street
  // the centre can fall a little off the road itself, which is a price
  // worth paying for an answer that does not move between runs.
  const namesake = namesakeOf(normalisePlaceText(winner.place.name), places);
  if (namesake.clusters === 1) {
    return { ...winner.place, lat: namesake.lat, lng: namesake.lng };
  }
  return winner.place;
}
