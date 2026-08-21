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

// A slice shaped like the real table: a street that is also an ordinary
// word, a district, a neighbourhood, a metro station.
const PLACES: GazetteerPlace[] = [
  { name: 'Собачка', lat: 50.4000, lng: 30.5000, category: 'street' },
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
  // …and the short one still resolves when it is the only thing written.
  const r = resolvePlace('Зник пес, Борщагівка', PLACES);
  check('the short name still resolves alone', r?.name === 'Борщагівка', String(r?.name));
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
    'and the bare name still works',
    resolvePlace('на Армійській загубився кіт', streets)?.name === 'Армійська вулиця',
    String(resolvePlace('на Армійській загубився кіт', streets)?.name),
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

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('✓ place resolution: addresses beat prose, specific beats broad, silence beats guessing');
