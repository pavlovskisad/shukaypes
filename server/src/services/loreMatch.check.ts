// Fixture check for the geosearch name matcher. Run it after touching
// loreMatch.ts — `pnpm --filter @shukajpes/server check:lore-match`.
//
// A wrong match here is a wrong "read more" on a real plaque, and a
// wrong article fed to the writer that produces the row's detail — so
// the false pairs below matter more than the true ones. Every pair is
// the shape of something geosearch actually returns for Kyiv: article
// titles carry "(Київ)", OSM names carry the dative ("Шевченку"), and
// half the institutions on a street are named after the person whose
// plaque is on the wall.

import {
  isMemorialLike,
  nameMatchScore,
  nameTokens,
  pickGeoMatch,
  type GeoCandidate,
} from './loreMatch.js';

let failures = 0;
let checks = 0;

function ok(cond: boolean, label: string, detail = ''): void {
  checks++;
  if (cond) return;
  failures++;
  console.error(`✗ ${label}${detail ? `\n    ${detail}` : ''}`);
}

function cands(...titles: Array<string | [string, number]>): GeoCandidate[] {
  return titles.map((t, i) =>
    typeof t === 'string' ? { title: t, dist: 20 + i * 10 } : { title: t[0], dist: t[1] },
  );
}

// ---------------------------------------------------------------------
// Tokeniser: inflection and generic words go, the name stays.
// ---------------------------------------------------------------------
{
  const a = nameTokens("Пам'ятник Тарасові Шевченку");
  const b = nameTokens('Пам’ятник Тарасу Шевченку (Київ)');
  ok(
    [...a].sort().join() === [...b].sort().join(),
    'dative and nominative forms tokenise the same',
    `${[...a]} vs ${[...b]}`,
  );
  ok(nameTokens('Меморіальна дошка').size === 0, 'a name that is only generic words has no tokens');
  ok(nameMatchScore('Меморіальна дошка', 'Меморіальна дошка Лесі Українці') === 0, 'no tokens means no match, not a perfect one');
}

// ---------------------------------------------------------------------
// True pairs. The OSM name is shorter, differently inflected, or missing
// the disambiguator, and it is still the same thing.
// ---------------------------------------------------------------------
{
  const pairs: Array<[string, string, string]> = [
    ['historic', 'Софійський собор', 'Софійський собор (Київ)'],
    ['historic', 'Будинок з химерами', 'Будинок з химерами'],
    ['religious', 'Андріївська церква', 'Андріївська церква (Київ)'],
    ['memorial', "Пам'ятник Богдану Хмельницькому", "Пам'ятник Богданові Хмельницькому (Київ)"],
    ['memorial', "Пам'ятник Шевченку", "Пам'ятник Тарасу Шевченку (Київ)"],
    ['museum', 'Музей Ханенків', 'Національний музей мистецтв імені Богдана та Варвари Ханенків'],
    ['historic', 'Золоті ворота', 'Золоті ворота (Київ)'],
    ['tourism', 'Дім Городецького', 'Будинок з химерами'],
  ];
  for (const [category, name, title] of pairs) {
    const m = pickGeoMatch({ name, nameEn: null, category }, cands(title, 'Хрещатик', 'Майдан Незалежності'));
    // The last pair is a genuine miss: two names for one building that
    // share no word. Listed so the limit of the matcher is written down,
    // not so it passes.
    if (name === 'Дім Городецького') {
      ok(m === null, 'a nickname with no shared word is a documented miss');
      continue;
    }
    ok(m?.title === title, `matches: ${name} ⇐ ${title}`, `got ${m?.title ?? 'null'} (${m?.score.toFixed(2) ?? '-'})`);
  }
}

// ---------------------------------------------------------------------
// False pairs. Same person, different thing.
// ---------------------------------------------------------------------
{
  const falsePairs: Array<[string, string, string]> = [
    ['memorial', "Пам'ятник Тарасові Шевченку", 'Київський національний університет імені Тараса Шевченка'],
    ['memorial', "Пам'ятник Тарасові Шевченку", 'Парк імені Тараса Шевченка (Київ)'],
    ['memorial', 'Меморіальна дошка Лесі Українці', 'Національний академічний театр російської драми імені Лесі Українки'],
    ['memorial', 'Меморіальна дошка Лесі Українці', 'Музей Лесі Українки (Київ)'],
    ['memorial', 'Меморіальна дошка Миколі Лисенку', 'Вулиця Лисенка (Київ)'],
    ['historic', 'Будинок Сікорського', 'Список пам’яток архітектури Києва'],
    ['memorial', "Пам'ятник Володимиру Великому", 'Володимирська гірка'],
  ];
  for (const [category, name, title] of falsePairs) {
    const m = pickGeoMatch({ name, nameEn: null, category }, cands(title));
    ok(m === null, `does not match: ${name} ⇏ ${title}`, `got ${m?.title} (${m?.score.toFixed(2)})`);
  }
}

// ---------------------------------------------------------------------
// The monument beats the institution when both are in the radius, and
// the nearer of two equal names wins.
// ---------------------------------------------------------------------
{
  const m = pickGeoMatch(
    { name: "Пам'ятник Тарасові Шевченку", nameEn: 'Taras Shevchenko Monument', category: 'memorial' },
    cands(
      ['Київський національний університет імені Тараса Шевченка', 90],
      ['Парк імені Тараса Шевченка (Київ)', 60],
      ["Пам'ятник Тарасу Шевченку (Київ)", 12],
    ),
  );
  ok(m?.title === "Пам'ятник Тарасу Шевченку (Київ)", 'the monument article wins over the park and the university', m?.title);

  const tie = pickGeoMatch(
    { name: 'Церква Миколи Притиска', nameEn: null, category: 'religious' },
    cands(['Церква Миколи Притиска', 140], ['Церква Миколи Притиска', 15]),
  );
  ok(tie?.dist === 15, 'on equal names the nearer wins', String(tie?.dist));

  ok(isMemorialLike({ name: 'Погруддя Лесі Українки', nameEn: null, category: 'historic' }), 'a bust is memorial-like whatever its category');
  ok(!isMemorialLike({ name: 'Будинок Сікорського', nameEn: null, category: 'historic' }), 'a house is not');
}

// ---------------------------------------------------------------------
// The English name is a second chance for the same landmark.
// ---------------------------------------------------------------------
{
  const m = pickGeoMatch(
    { name: 'Дім Городецького', nameEn: 'House with Chimaeras', category: 'historic' },
    cands('Будинок з химерами', 'House with Chimaeras'),
  );
  ok(m?.title === 'House with Chimaeras', 'the English name can carry the match', m?.title);
}

if (failures > 0) {
  console.error(`\n${failures} of ${checks} checks failed`);
  process.exit(1);
}
console.log(`✓ lore-match: ${checks} checks passed`);
