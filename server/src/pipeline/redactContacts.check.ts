// Fixture check for contact redaction.
// Run with: pnpm --filter @shukajpes/server check:redact
//
// Two failure modes, and they are not equally bad.
//
// A phone that slips through is a small miss: the walker could get that
// number thirty seconds later by reporting the sighting, so the cost is
// early access, not exposure.
//
// A redaction that eats the DESCRIPTION is the worse failure, because it
// defeats the whole point of showing the ad during a search. "Оболонь,
// буд. 12" and "загубився 14.08" have to survive, or the walker is left
// reading holes.
//
// So the must-not-redact half of this file is the important half.

import { redactContacts } from './redactContacts.js';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    failures++;
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const MASK = '[контакт приховано]';
const gone = (input: string) => redactContacts(input).includes(MASK);
const kept = (input: string) => redactContacts(input) === input;

// ---- MUST REDACT: the shapes Ukrainian ads actually use ----

const phones = [
  'Телефон 0671234567',
  'тел: +380671234567',
  'дзвоніть +38 067 123 45 67',
  'моб. 067-123-45-67',
  'звоните (067) 123-45-67',
  '380501234567',
  'Viber 0931234567',
  'номер 095 111 22 33',
];
for (const p of phones) check(`redacts: ${p}`, gone(p), redactContacts(p));

check('redacts an e-mail', gone('пишіть olena.kovalenko@gmail.com'));
check('redacts a telegram handle', gone('пишіть в тг @olena_kyiv'));
check('redacts a handle at line start', gone('@olena_kyiv напишіть'));

// ---- MUST NOT REDACT: everything that is description ----

const keepers = [
  'Загубився пес на Оболоні, вул. Героїв 12',
  'зник 14.08.2026 ввечері',
  'йому 3 роки, вага 12 кг',
  'винагорода 5000 грн',
  'квартира 45, під’їзд 2',
  'о 19:30 біля метро',
  'чорний нашийник, номер жетона 77',
  'Дуже боїться людей, відгукується на імʼя Мухтар',
  'зростом 40 см, довжина 60 см',
];
for (const k of keepers) check(`keeps: ${k}`, kept(k), redactContacts(k));

// ---- The realistic whole-ad case ----

const ad = [
  'ЗНИК СОБАКА! Оболонь, вул. Маршала Тимошенка 15.',
  'Мухтар, вівчарка, 4 роки, чорний нашийник.',
  'Дуже боїться чоловіків, не йде на руки, відгукується на імʼя.',
  'Зник 14.08 близько 19:00. Винагорода 5000 грн.',
  'Телефон 067-123-45-67, Viber той самий. Тг @mukhtar_kyiv',
].join('\n');

const red = redactContacts(ad);
check('whole ad: phone gone', !red.includes('067-123-45-67'));
check('whole ad: handle gone', !red.includes('@mukhtar_kyiv'));
check('whole ad: street number survives', red.includes('Тимошенка 15'));
check('whole ad: date survives', red.includes('14.08'));
check('whole ad: reward survives', red.includes('5000 грн'));
check('whole ad: the identifying detail survives', red.includes('боїться чоловіків'));
check('whole ad: the name survives', red.includes('Мухтар'));

// ---- Shape ----

check('empty stays empty', redactContacts('') === '');
check('no contacts means byte-identical', kept('просто текст без контактів'));

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('✓ contact redaction: contacts go, description stays');
