// Deciding whether a Wikipedia article geotagged near a kyiv_lore row is
// the article ABOUT that row.
//
// enrich-lore.ts asks uk.wikipedia for every article geotagged within a
// short radius of a landmark that has no Wikipedia handle of its own.
// Geosearch answers by position alone, so a plaque on the wall of a
// theatre gets the theatre, the square it faces, the metro station under
// it and a church two doors down, all inside 150 m. This module picks
// the one whose NAME says it is the same thing, or nothing.
//
// Pure — no network, no db — so loreMatch.check.ts can pin it against a
// fixture of real pairs. The score is deliberately coarse: tokens with
// generic words dropped and inflection trimmed, compared as a set. A
// cleverer matcher would need a Ukrainian stemmer for a gain the fixture
// does not show. What does the real work is not the score but the two
// guards after it, both learnt from what geosearch actually returns:
//
//   1. A title that names an INSTITUTION or a piece of GROUND the
//      landmark's name does not — the theatre a plaque hangs on, the
//      park a monument stands in, the hill a statue looks down from —
//      is the place the landmark is AT, not the landmark.
//   2. A title that is itself a memorial ("Пам'ятник Миколі Лисенку")
//      claimed for a landmark that is not one (a church of St Nicholas
//      that shares the name) is a coincidence of first names.

export interface GeoCandidate {
  title: string;
  // Metres from the landmark, as geosearch reports it.
  dist: number;
}

export interface GeoMatch {
  title: string;
  score: number;
  dist: number;
}

export interface MatchSubject {
  name: string;
  nameEn: string | null;
  // kyiv_lore.category — a memorial/monument/artwork row is memorial-
  // like whatever its name says, see isMemorialLike.
  category: string;
}

// Words that say what KIND of thing a place is, not WHICH. "Пам'ятник
// Шевченку" and "Пам'ятник Тарасу Шевченку (Київ)" share nothing after
// these go except the name — which is exactly the part that has to
// agree. Kept in their normalised (apostrophe-free, lowercase) form.
const GENERIC = new Set([
  'памятник',
  'монумент',
  'меморіальна',
  'меморіальний',
  'меморіал',
  'дошка',
  'погруддя',
  'бюст',
  'стела',
  'обеліск',
  'скульптура',
  'церква',
  'храм',
  'собор',
  'каплиця',
  'костел',
  'синагога',
  'мечеть',
  'будинок',
  'будівля',
  'садиба',
  'особняк',
  'вулиця',
  'вул',
  'площа',
  'імені',
  'ім',
  'святого',
  'святої',
  'святих',
  'св',
  'київ',
  'києві',
  'києва',
  'київський',
  'київська',
  'київське',
  'україни',
  'український',
  'українська',
  'національний',
  'національна',
  'державний',
  'державна',
  'та',
  'і',
  'й',
  'у',
  'в',
  'на',
  'до',
  'з',
  'із',
  'зі',
  'про',
  'the',
  'of',
  'to',
  'and',
  'monument',
  'memorial',
  'church',
  'house',
  'st',
]);

// Words that name an institution or a piece of ground, as the 5-letter
// stems the tokeniser produces. See guard 1 in the header.
const PLACE_KIND = new Set([
  'парк',
  'сквер',
  'сад',
  'музей',
  'театр',
  'уніве',
  'інсти',
  'акаде',
  'школа',
  'гімна',
  'ліцей',
  'лікар',
  'біблі',
  'стаді',
  'палац',
  'кінот',
  'завод',
  'фабри',
  'готел',
  'банк',
  'колед',
  'консе',
  'філар',
  'станц',
  'метро',
  'вокза',
  'ринок',
  'галер',
  'центр',
  'фонд',
  'клуб',
  'цвинт',
  'кладо',
  'узвіз',
  'спуск',
  'проспе',
  'бульв',
  'прову',
  'набер',
  'міст',
  'остр',
  'озеро',
  'гора',
  'гірка',
  'урочи',
  'район',
  'масив',
  'мікро',
  'селищ',
  'місце',
]);

// Ukrainian inflects the end of a word; the first few letters are the
// part that survives a case change. Five keeps "Шевченко/Шевченку/
// Шевченка" together without collapsing "Богдан" into "Богородиця".
const STEM_LEN = 5;

export function normaliseName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’'`ʼ]/g, '')
    .replace(/[«»"()[\],.:;!?/\\—–-]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stem(raw: string): string {
  return raw.length > STEM_LEN ? raw.slice(0, STEM_LEN) : raw;
}

export function nameTokens(s: string): Set<string> {
  const out = new Set<string>();
  for (const raw of normaliseName(s).split(' ')) {
    if (raw.length < 3) continue;
    if (GENERIC.has(raw)) continue;
    out.add(stem(raw));
  }
  return out;
}

// Lookarounds rather than \b: JavaScript's \b is ASCII-only and never
// fires beside a Cyrillic letter, even with the u flag.
const MEMORIAL_WORD = /(?<!\p{L})(памятник|монумент|меморіал|погруддя|бюст|дошка|стела|обеліск|скульптура|меморіальна|меморіальний)(?!\p{L})/u;

// A landmark that commemorates something rather than being it.
export function isMemorialLike(subject: MatchSubject): boolean {
  if (subject.category === 'memorial' || subject.category === 'monument' || subject.category === 'artwork') {
    return true;
  }
  return MEMORIAL_WORD.test(normaliseName(subject.name));
}

function titleIsMemorial(title: string): boolean {
  return MEMORIAL_WORD.test(normaliseName(title));
}

// Overlap coefficient over the meaningful tokens: shared tokens as a
// share of the SHORTER name. Chosen over Jaccard because OSM names are
// short ("Музей Ханенків") and article titles are long ("Національний
// музей мистецтв імені Богдана та Варвари Ханенків"), and the short one
// being wholly inside the long one is what a match looks like. What that
// lets through — a one-word name inside any title that contains the
// word — is what the guards in pickGeoMatch are for.
//
// A name that is NOTHING but generic words ("Меморіальна дошка") scores
// 0 against everything: there is no name to agree on, so no article can
// be claimed for it.
export function nameMatchScore(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.min(ta.size, tb.size);
}

// Guard 1: the candidate names a kind of place the landmark does not.
function namesAPlaceKindBeyond(candidateTitle: string, subjectNames: string[]): boolean {
  const have = new Set<string>();
  for (const n of subjectNames) for (const t of nameTokens(n)) have.add(t);
  for (const t of nameTokens(candidateTitle)) {
    if (PLACE_KIND.has(t) && !have.has(t)) return true;
  }
  return false;
}

// Titles that are never the article about a landmark, whatever the
// score says.
const NEVER_TITLE = /^(Список|Перелік|Категорія|Шаблон|Вулиця|Провулок|Проспект|Бульвар|Узвіз|Площа)(?!\p{L})/u;

// Below this the shared tokens are a coincidence more often than a
// match. With the overlap coefficient this means "at least half of the
// shorter name's words are in the other".
export const MATCH_THRESHOLD = 0.5;

// The article for a landmark, if one of the geotagged neighbours is it.
// The English name is a second chance for the same landmark, not a
// second landmark: the best score across both names wins.
export function pickGeoMatch(
  subject: MatchSubject,
  candidates: GeoCandidate[],
  threshold = MATCH_THRESHOLD,
): GeoMatch | null {
  const memorial = isMemorialLike(subject);
  const names = subject.nameEn ? [subject.name, subject.nameEn] : [subject.name];
  let best: GeoMatch | null = null;
  for (const c of candidates) {
    if (NEVER_TITLE.test(c.title)) continue;
    let score = 0;
    for (const n of names) score = Math.max(score, nameMatchScore(n, c.title));
    if (score < threshold) continue;
    if (namesAPlaceKindBeyond(c.title, names)) continue;
    if (!memorial && titleIsMemorial(c.title)) continue;
    // Ties go to the nearer one — same name twice inside the radius is
    // a church and its bell tower, and the nearer is the one pointed at.
    if (!best || score > best.score || (score === best.score && c.dist < best.dist)) {
      best = { title: c.title, score, dist: c.dist };
    }
  }
  return best;
}
