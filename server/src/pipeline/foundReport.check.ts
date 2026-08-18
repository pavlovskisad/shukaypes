// Fixture check for the found-report rule.
// Run with: pnpm --filter @shukajpes/server check:found-report
//
// The cost of each mistake is not symmetric, which is what shapes this.
//
// Calling a LOST pet "found" hides a real search from the map — an owner
// loses their helpers and never knows. Calling a FOUND pet "lost" is the
// status quo: mildly confusing, sends somebody on a pointless walk.
//
// So when a title says both, or says neither clearly, it stays LOST. The
// must-not-flag half of this file is the important half.

import { looksLikeFoundReport } from './keywords.js';

let failures = 0;
function check(name: string, ok: boolean): void {
  if (!ok) {
    failures++;
    console.error(`✗ ${name}`);
  }
}

// ---- MUST be recognised as found reports ----
for (const t of [
  'песик (знайдений)',
  'Знайшли собаку на Оболоні',
  'знайдено кота, шукаємо господарів',
  'Нашли собаку возле метро',
  'найден кот, ищем хозяев',
  'Прибилася собака до двору',
  'знайшлася кішка, чия?',
]) check(`found: ${t}`, looksLikeFoundReport(t));

// ---- MUST NOT be, because these are real searches ----
for (const t of [
  // The most lost a post can be: asking for help finding.
  'Допоможіть знайти собаку',
  'Допоможіть знайти кота, Оболонь',
  'Пропала собака, Троєщина',
  'Загубився пес',
  'Зник кіт',
  'потерялась собака',
  'Пропала собака, дуже просимо допомогти знайти',
  // Says both — ambiguous, so it stays a search for a human to judge.
  'Пропала собака… знайшлася?',
]) check(`NOT found: ${t}`, !looksLikeFoundReport(t));

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('✓ found reports: told apart from searches, ambiguity stays a search');
