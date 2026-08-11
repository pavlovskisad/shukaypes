// Fixture check for detectOtherCity. Run it after touching the city
// list — `pnpm --filter @shukajpes/server check:out-of-area`.
//
// This repo has no test runner and this is not an argument for adding
// one; it is a script, like every other verifiable thing here. But the
// detector decides which rows expire:out-of-area is willing to write to,
// so its failure mode is expiring a real Kyiv pet off the map, and that
// is worth being able to re-check in one command rather than by
// reasoning about regexes.
//
// The first list is the one that matters. Kyiv is full of streets and
// metro stations named after other cities, and every entry in it is a
// real place a pet could plausibly be lost on.
//
// Exits non-zero on any failure so it can be wired into CI later.

import { detectOtherCity } from './outOfArea.js';

// Must NOT flag.
const IN_SCOPE = [
  // Kyiv places named after other cities — the false-positive trap.
  'Загубився пес на Львівській площі',
  'Пропала кішка, Харківське шосе 12',
  'Одеська площа, загубився цуцик',
  'Ужгородський провулок, знайшли пса',
  'Полтавська вулиця, район Лук’янівки',
  'метро Чернігівська, загубився кіт',
  'станція Житомирська, пропав пес',
  'метро Бориспільська, знайдено собаку',
  'Броварський проспект, загубився пес',
  // Ordinary Kyiv posts.
  'Пропав кіт на Дарниці',
  'Загубилась собака біля Контрактової площі',
  'Пропав песик, Троєщина',
  'Знайшли кота, вулиця Оноре де Бальзака',
  'Пропала собака в Голосіївському парку',
  // A Kyiv pet whose backstory names another city. Real production row.
  'КИЇВ!!! ЗНИК собака!! evacuated from Kramatorsk, slipped leash near Olimpiiska',
  // Inside upsert's KYIV_BBOX, which deliberately reaches these towns.
  // Flagging them would put this module and the bbox in disagreement.
  'Загубився кіт Буча вул. інститутська біля УГІ',
  'Загубився пес у Броварах',
  'Пропала кішка, Бориспіль',
];

// Must flag. Every one is a real title measured on production.
const OUT_OF_AREA = [
  'Пропав кіт Ужгород',
  'Потерялся кот Харьков Библика 2 В',
  'Загублена собаку, Миколаїв!',
  'Пропав пес біля Вінниці',
  'Знайдено пса - такса - кабель - Хмельницький',
  'Знайшли котика! Шукаємо власників, Борислав',
  'Допоможіть знайти собаку Долгинцево',
  'Загубилась собака с.Беремицьке',
  'Потерялся кот г.Днепр ж/м Покровский',
  'Загубився кіт, сіро-білий, Черкаси, район АТБ',
  'Зник кіт! Вул. Євгена Танцюри, Одеса',
  'Запоріжжя Олександрівський район ( біля танку ) - ПРОПАЛА кішка',
  'Увага!!! Знайшлися дві собаки в Житомирі.',
];

let failures = 0;

for (const text of IN_SCOPE) {
  const hit = detectOtherCity(text);
  if (hit) {
    failures++;
    console.error(`FALSE POSITIVE  ${hit.city} via "${hit.token}"\n                ${text}`);
  }
}

for (const text of OUT_OF_AREA) {
  if (!detectOtherCity(text)) {
    failures++;
    console.error(`MISSED          ${text}`);
  }
}

const total = IN_SCOPE.length + OUT_OF_AREA.length;
if (failures === 0) {
  console.log(`✓ ${total} cases pass (${IN_SCOPE.length} must-not-flag, ${OUT_OF_AREA.length} must-flag)`);
} else {
  console.error(`\n✗ ${failures} of ${total} cases failed`);
  process.exit(1);
}
