// Fixture check for place resolution.
// Run with: pnpm --filter @shukajpes/server check:resolve-place
//
// THE COST IS NOT SYMMETRIC, and that is what shapes every case here.
//
// Failing to resolve leaves a pet where it already was — invisible on
// the fall-through, or on a landmark. Bad, and exactly the status quo.
//
// Resolving WRONGLY sends somebody out. They walk the wrong streets for
// an hour, find nothing, and report nothing. The pet is no closer to
// home and a person has been spent. So the must-not-resolve half of
// this file matters more than the must-resolve half.

import { resolvePlace, type GazetteerPlace } from './resolvePlace.js';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    failures++;
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// A slice shaped like the real table: a park that is also an ordinary
// word (as «Собачка» really is categorised in production — the first
// dry run found four pets about to move onto it), a district, a
// neighbourhood, a metro station.
const PLACES: GazetteerPlace[] = [
  { name: 'Собачка', lat: 50.4000, lng: 30.5000, category: 'park' },
  { name: 'Садова', lat: 50.3000, lng: 30.7000, category: 'street' },
  { name: 'Зодчих', lat: 50.4620, lng: 30.3560, category: 'street' },
  { name: 'Бортничі', lat: 50.3860, lng: 30.7150, category: 'neighbourhood' },
  { name: 'Виноградар', lat: 50.5030, lng: 30.3900, category: 'neighbourhood' },
  { name: "Солом'янський район", lat: 50.4260, lng: 30.4460, category: 'district' },
  { name: 'Лісова', lat: 50.4640, lng: 30.6600, category: 'metro' },
  // The pair that caught the ranking bug in production: a Kyiv
  // neighbourhood, and a village 8km away whose name contains it.
  { name: 'Борщагівка', lat: 50.4560, lng: 30.3700, category: 'street' },
  { name: 'Софіївська Борщагівка', lat: 50.4020, lng: 30.3320, category: 'neighbourhood' },
];

// ---- CONTAINMENT: one place named at two precisions ----
{
  const r = resolvePlace('Пропала собака, Софіївська Борщагівка', PLACES);
  check(
    'the longer name wins over the one inside it',
    r?.name === 'Софіївська Борщагівка',
    String(r?.name),
  );
}
{
  // The short one is categorised as a street in the real table, and a
  // bare street name deliberately does not resolve — see the policy
  // note in resolvePlace. The pet keeps its fall-through rather than
  // being guessed onto a street.
  const r = resolvePlace('Зник пес, Борщагівка', PLACES);
  check('a bare street name does not resolve', r === null, String(r?.name));
}

// ---- THE SAME PLACE, NAMED TWICE ----
//
// An ad names its district in the title and again in the body. Under an
// `includes` test without a length comparison the two hits cancelled and
// the whole ad resolved to null — invisible in every single-mention
// fixture, and the normal case in production.
{
  const twice = 'Загубився кіт, Виноградар. Бачили на Виноградарі біля школи.';
  check('a place named twice still resolves', resolvePlace(twice, PLACES)?.name === 'Виноградар',
    String(resolvePlace(twice, PLACES)?.name));
}
{
  // And three times, in three different cases.
  const thrice = 'Бортничі! Пропав пес у Бортничах, бачили біля Бортничів.';
  check('three inflections of one place resolve', resolvePlace(thrice, PLACES)?.name === 'Бортничі',
    String(resolvePlace(thrice, PLACES)?.name));
}

// ---- ALIASES AND GENERIC WORDS ----
//
// Both of these came back from production as "not in the gazetteer"
// while being very much in it.
{
  const withAlias: GazetteerPlace[] = [
    {
      name: 'Подільський район',
      lat: 50.4700,
      lng: 30.5000,
      category: 'district',
      aliases: ['Подольский район'],
    },
  ];
  const r = resolvePlace('Загубився пес в Подольском районе', withAlias);
  check('a Russian alias resolves', r?.name === 'Подільський район', String(r?.name));
}
{
  const streets: GazetteerPlace[] = [
    { name: 'Армійська вулиця', lat: 50.42, lng: 30.44, category: 'street' },
  ];
  check(
    'the generic word need not match in form',
    resolvePlace('в районі вулиць Армійська і Січова', streets)?.name === 'Армійська вулиця',
    String(resolvePlace('в районі вулиць Армійська і Січова', streets)?.name),
  );
  check(
    // The accepted cost of the bare-street policy, pinned so a change
    // to it is a conscious one: an unmarked street mention stays
    // unresolved, because «на Армійській» and «на садовій ділянці»
    // are indistinguishable in form.
    'an unmarked street mention stays unresolved',
    resolvePlace('на Армійській загубився кіт', streets) === null,
    String(resolvePlace('на Армійській загубився кіт', streets)?.name),
  );
}

// ---- THE AD IS IN RUSSIAN, THE TABLE IS IN UKRAINIAN ----
//
// The largest single reason the resolver found nothing on production:
// 65 of 126 refused ads are Russian-spelled. The gazetteer holds
// «Уманська вулиця»; the ad says «Уманская улица», and no ending-trim
// bridges «уманськ» to «уманск» — the difference is in the middle of
// the word. Folding the orthographies is what makes them meet.
{
  const streets: GazetteerPlace[] = [
    { name: 'Уманська вулиця', lat: 50.4408, lng: 30.4637, category: 'street' },
    { name: 'Оболонський район', lat: 50.5010, lng: 30.4980, category: 'district' },
  ];
  check(
    'a Russian-spelled street resolves to the Ukrainian entry',
    resolvePlace('Пропала собака, ул. Уманская 25', streets)?.name === 'Уманська вулиця',
    String(resolvePlace('Пропала собака, ул. Уманская 25', streets)?.name),
  );
  check(
    'a Russian-spelled district too',
    resolvePlace('потерялся кот в Оболонском районе', streets)?.name === 'Оболонський район',
    String(resolvePlace('потерялся кот в Оболонском районе', streets)?.name),
  );
}

// ---- ABBREVIATIONS: also how people actually write ----
{
  const r = resolvePlace('Загубився пес, Солом’янський р-н', PLACES);
  check('«р-н» reads as «район»', r?.name === "Солом'янський район", String(r?.name));
}
{
  const r = resolvePlace('Зник кіт, вул. Садова 12', PLACES);
  check('«вул.» still resolves and marks', r?.name === 'Садова' && r?.marked === true, String(r?.name));
}

// ---- INFLECTION: how people actually write ----
{
  check(
    'на Оболоні — locative case',
    resolvePlace('Загубився кіт на Виноградарі', PLACES)?.name === 'Виноградар',
    String(resolvePlace('Загубився кіт на Виноградарі', PLACES)?.name),
  );
  check(
    'з Бортничів — genitive plural',
    resolvePlace('Пес утік з Бортничів', PLACES)?.name === 'Бортничі',
    String(resolvePlace('Пес утік з Бортничів', PLACES)?.name),
  );
  check(
    'біля Лісової — genitive',
    resolvePlace('бачили біля Лісової', PLACES)?.name === 'Лісова',
    String(resolvePlace('бачили біля Лісової', PLACES)?.name),
  );
}

// ---- MUST resolve ----
{
  const r = resolvePlace('Загубився пес на вул. Зодчих, біля школи', PLACES);
  check('a marked street resolves', r?.name === 'Зодчих', String(r?.name));
  check('and it is marked', r?.marked === true);
}
{
  const r = resolvePlace('Зник кіт, Виноградар, дуже боязкий', PLACES);
  check('a bare neighbourhood resolves', r?.name === 'Виноградар', String(r?.name));
  check('a bare match is not marked', r?.marked === false);
}
{
  const r = resolvePlace('Пропала собака, Бортничі', PLACES);
  check('another bare neighbourhood', r?.name === 'Бортничі', String(r?.name));
}

// ---- MUST prefer the marked one ----
{
  // «садова» appears as prose, «Зодчих» as an address. The address wins
  // however the sentence is ordered.
  const r = resolvePlace('садова ділянка, загубився пес на вул. Зодчих', PLACES);
  check('marked beats bare regardless of order', r?.name === 'Зодчих', String(r?.name));
}

// ---- MUST prefer the more specific one ----
{
  const r = resolvePlace("Солом'янський район, вулиця Садова", PLACES);
  check('a street beats the district containing it', r?.name === 'Садова', String(r?.name));
}
{
  // Nothing marked: the narrower place is still the better answer.
  const r = resolvePlace("Солом'янський район, десь біля Лісова", PLACES);
  check('metro beats district when both are bare', r?.name === 'Лісова', String(r?.name));
}

// ---- LANDMARKS: how a great many ads actually say where ----
//
// «Район цирка», «біля жд вокзалу», «район 9-той больницы». Thirteen of
// the 192 active pets are located this way and every one resolved to
// nothing, because the table held streets and districts but no circus.
// What the data alone buys: a landmark the ad NAMES resolves, in either
// language, and outranks the district it stands in.
{
  const withLandmark: GazetteerPlace[] = [
    { name: 'Охматдит', lat: 50.4494, lng: 30.4620, category: 'landmark', aliases: ['Охматдет'] },
    { name: "Солом'янський район", lat: 50.4260, lng: 30.4460, category: 'district' },
  ];
  check(
    'a landmark resolves',
    resolvePlace('загубився пес біля Охматдиту', withLandmark)?.name === 'Охматдит',
    String(resolvePlace('загубився пес біля Охматдиту', withLandmark)?.name),
  );
  check(
    'and beats the district it stands in',
    resolvePlace("Солом'янський район, біля Охматдиту", withLandmark)?.name === 'Охматдит',
  );
  check(
    'the Russian spelling of it too',
    resolvePlace('потерялся пёс возле Охматдета', withLandmark)?.name === 'Охматдит',
    String(resolvePlace('потерялся пёс возле Охматдета', withLandmark)?.name),
  );
}
// WHAT THIS DOES NOT YET REACH, pinned so nobody assumes otherwise.
//
// «Район цирка» — the ad that started this — still resolves to nothing,
// for two reasons worth writing down. placeStems only trims the LAST
// word, so «Київського національного цирку» cannot meet «Київський
// національний цирк»; and the head noun on its own, «цирк», is four
// characters and below MIN_PLACE_CHARS. Landmark data is the first half
// of that fix; short head-noun aliases and per-word stemming are the
// second, and they are their own change with their own measurement.
{
  const circus: GazetteerPlace[] = [
    { name: 'Київський національний цирк', lat: 50.4517, lng: 30.4864, category: 'landmark' },
  ];
  check(
    'an inflected multi-word landmark still misses (known, measured)',
    resolvePlace('Потерялся щенок, Район цирка Киев', circus) === null,
    String(resolvePlace('Потерялся щенок, Район цирка Киев', circus)?.name),
  );
}
// …WHICH IS WHY THE STOP NAME IS THE ONE THAT MATTERS.
//
// OSM maps the venue as «Національний цирк України» and the bus stop
// outside it as «Цирк» — the second is what an ad writes. Four
// characters, so it only works because landmarks carry their own floor.
{
  const stop: GazetteerPlace[] = [
    { name: 'Цирк', lat: 50.4479, lng: 30.4925, category: 'landmark' },
    { name: 'Садова', lat: 50.3000, lng: 30.7000, category: 'street' },
  ];
  const r = resolvePlace('Потерялся щенок Коля возраст 7 месяцев Район цирка Киев', stop);
  check('the stop name catches «район цирка»', r?.name === 'Цирк', String(r?.name));
  check('and it reads as marked, because «район» precedes it', r?.marked === true);
}
{
  // The floor is landmark-only: a four-character STREET name stays
  // unmatchable, which is what stops short words matching everything.
  const shortStreet: GazetteerPlace[] = [
    { name: 'Лісо', lat: 50.46, lng: 30.52, category: 'street' },
  ];
  check(
    'a four-character street is still refused',
    resolvePlace('загубився пес на Лісо', shortStreet) === null,
  );
}

// ---- MUST NOT resolve ----
{
  check('empty text resolves to nothing', resolvePlace('', PLACES) === null);
  check(
    'a post with no place resolves to nothing',
    resolvePlace('Загубився рудий кіт, дуже боязкий, відгукується', PLACES) === null,
  );
  check(
    'a short word cannot match',
    // 'Лісова' is 6 chars and allowed; anything shorter must not be in
    // the table's matchable set at all. This asserts the floor holds.
    resolvePlace('ліс', PLACES) === null,
  );
}

// ---- THE CASE THAT MOTIVATED THE MARKER RULE ----
{
  // Real production noise: «Собачка» is a Kyiv street AND the word for a
  // small dog. A bare mention in a lost-pet ad is overwhelmingly the
  // animal. It still resolves — we cannot know — but it must never
  // outrank an actual address in the same post.
  const r = resolvePlace('загубилася собачка на вул. Зодчих', PLACES);
  check('the animal does not outrank the address', r?.name === 'Зодчих', String(r?.name));
}
{
  // And alone, the animal resolves to nothing at all — «Собачка» is a
  // park in the real table, and bare parks are out for the same reason
  // bare streets are: park names are common nouns.
  const r = resolvePlace('загубилася собачка, дуже ляклива', PLACES);
  check('the animal alone resolves to nothing', r === null, String(r?.name));
}
{
  // A park the ad actually marks as one still resolves.
  const r = resolvePlace('бачили в парку Собачка вчора', PLACES);
  check('a marked park resolves', r?.name === 'Собачка' && r?.marked === true, String(r?.name));
}

// ---- ONE NAME, MANY PLACES ----
//
// «Набережна вулиця» exists in half the settlements the table covers.
// The first production dry run picked one arbitrarily and would have
// moved a pet 25 km under a "marked" label. A name shared by places
// further apart than a search zone places nothing.
{
  const twoStreets: GazetteerPlace[] = [
    { name: 'Набережна вулиця', lat: 50.46, lng: 30.52, category: 'street' },
    { name: 'Набережна вулиця', lat: 50.30, lng: 30.70, category: 'street' },
  ];
  const r = resolvePlace('Зник кіт, вул. Набережна 5', twoStreets);
  check('a name shared across the map resolves to nothing', r === null, String(r?.name));
}
{
  // The alias bypass, caught on production: three places all named
  // «Перемога», one carrying the Russian alias «Победа». An ad writing
  // «Победа» hit only that row, so the gram grouping saw one place and
  // called it unambiguous — a coin-flip between three Перемогаs
  // dressed up as a confident hit. The namesake grouping must refuse
  // it whichever spelling the ad used.
  const threePeremohas: GazetteerPlace[] = [
    { name: 'Перемога', lat: 50.4371, lng: 30.3950, category: 'neighbourhood', aliases: ['Победа'] },
    { name: 'Перемога', lat: 50.4448, lng: 30.2799, category: 'neighbourhood' },
    { name: 'Перемога', lat: 50.5420, lng: 30.8260, category: 'district' },
  ];
  const r = resolvePlace('кіт втік у ЖК Победа-3, дуже боязкий', threePeremohas);
  check('an alias cannot dodge the namesake refusal', r === null, String(r?.name));
}
{
  // …but the same street stored as nearby segments is one answer.
  const segments: GazetteerPlace[] = [
    { name: 'Набережна вулиця', lat: 50.4600, lng: 30.5200, category: 'street' },
    { name: 'Набережна вулиця', lat: 50.4630, lng: 30.5230, category: 'street' },
  ];
  const r = resolvePlace('Зник кіт, вул. Набережна 5', segments);
  check('street segments still resolve', r?.name === 'Набережна вулиця', String(r?.name));
}

// ---- A LONG STREET IS STILL ONE STREET ----
//
// The regression this file exists for, in the shape production actually
// holds it: «Уманська вулиця» is ELEVEN rows, a chain of OSM segments
// running 1.3 km end to end. The first version of the ambiguity rule
// measured the widest gap between any two rows and refused anything
// over a kilometre — so it threw away a real address, and «Рижуля»,
// whose ad names that exact street, sat 5 km away on a landmark guess.
// Chaining is what tells one long street from two distant namesakes.
{
  const umanska: GazetteerPlace[] = [
    { name: 'Уманська вулиця', lat: 50.4376, lng: 30.4519, category: 'street' },
    { name: 'Уманська вулиця', lat: 50.4379, lng: 30.4521, category: 'street' },
    { name: 'Уманська вулиця', lat: 50.4397, lng: 30.4582, category: 'street' },
    { name: 'Уманська вулиця', lat: 50.4413, lng: 30.4648, category: 'street' },
    { name: 'Уманська вулиця', lat: 50.4416, lng: 30.4663, category: 'street' },
    { name: 'Уманська вулиця', lat: 50.4417, lng: 30.4673, category: 'street' },
    { name: 'Уманська вулиця', lat: 50.4418, lng: 30.4674, category: 'street' },
    { name: 'Уманська вулиця', lat: 50.4418, lng: 30.4678, category: 'street' },
    { name: 'Уманська вулиця', lat: 50.4419, lng: 30.4677, category: 'street' },
    { name: 'Уманська вулиця', lat: 50.4419, lng: 30.4680, category: 'street' },
    { name: 'Уманська вулиця', lat: 50.4421, lng: 30.4688, category: 'street' },
  ];
  const r = resolvePlace(
    '16 жовтня в районі будинків вул. Уманська, 25, 25 корпус 1, 27 зник рижий котик',
    umanska,
  );
  check('a 1.3km street stored in pieces resolves', r?.name === 'Уманська вулиця', String(r?.name));
  // …and it answers with the middle of the street rather than whichever
  // segment happened to sort first, so the same ad places the same pet
  // in the same spot every time.
  const midLat = umanska.reduce((s, p) => s + p.lat, 0) / umanska.length;
  const midLng = umanska.reduce((s, p) => s + p.lng, 0) / umanska.length;
  check(
    'and answers with the middle of it',
    r !== null && Math.abs(r.lat - midLat) < 1e-9 && Math.abs(r.lng - midLng) < 1e-9,
    `${r?.lat},${r?.lng}`,
  );
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('✓ place resolution: addresses beat prose, specific beats broad, silence beats guessing');
