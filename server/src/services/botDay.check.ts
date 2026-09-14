// Fixture check for the bots' timetable (services/botDay.ts): the plan
// is deterministic, every walk starts inside its window and is the
// right length, and a pool of thirty comes out at about the online
// share a real owner keeps — a few percent, not ninety. Run with
// `pnpm check:bot-day`. No network, no database.

import { BOT_DAY, isOut, kyivClock, planDay } from './botDay.js';

function fail(msg: string): never {
  console.error(`✗ bot-day: ${msg}`);
  process.exit(1);
}

const BOTS = 30;
const DAYS = 60;
const day0 = kyivClock(Date.now()).day;

// Deterministic.
for (let i = 0; i < BOTS; i++) {
  const a = JSON.stringify(planDay(i, day0));
  const b = JSON.stringify(planDay(i, day0));
  if (a !== b) fail(`plan for bot ${i} differs between two draws`);
}
if (JSON.stringify(planDay(0, day0)) === JSON.stringify(planDay(1, day0))) fail('two bots share a plan');
if (JSON.stringify(planDay(0, day0)) === JSON.stringify(planDay(0, day0 + 1))) fail('two days share a plan');

// Shape, and the totals.
let walks = 0;
let minutes = 0;
const concurrent = new Array<number>(24 * 60).fill(0);
for (let d = 0; d < DAYS; d++) {
  for (let i = 0; i < BOTS; i++) {
    const plan = planDay(i, day0 + d);
    let prevEnd = -1;
    for (const w of plan.walks) {
      const len = w.end - w.start;
      if (len < BOT_DAY.minMinutes || len > BOT_DAY.maxMinutes) fail(`walk length ${len.toFixed(1)} out of range`);
      if (w.start < prevEnd) fail('walks overlap');
      if (!BOT_DAY.windows.some((win) => w.start >= win.from && w.start <= win.to)) fail(`walk starts at ${w.start.toFixed(0)}, outside every window`);
      prevEnd = w.end;
      walks++;
      minutes += len;
    }
    for (let m = 0; m < 24 * 60; m++) if (isOut(plan, m + 0.5)) concurrent[m]!++;
  }
}
const perDayWalks = walks / (BOTS * DAYS);
const perDayMin = minutes / (BOTS * DAYS);
const share = perDayMin / (24 * 60);
let peak = 0;
let peakAt = 0;
for (let m = 0; m < 24 * 60; m++) {
  const c = concurrent[m]! / DAYS;
  if (c > peak) { peak = c; peakAt = m; }
}
if (isOut(planDay(0, day0), 3 * 60)) fail('somebody is out at 03:00');
if (perDayWalks < 2.1 || perDayWalks > 3.1) fail(`${perDayWalks.toFixed(2)} walks a day, expected ~2.6`);
if (share < 0.03 || share > 0.10) fail(`online share ${(share * 100).toFixed(1)}%, expected a few percent`);
// Midday is a real part of the day, not a rounding error (D-79).
const midday = concurrent.slice(13 * 60, 14 * 60).reduce((a, b) => a + b, 0) / (60 * DAYS);
const evening = concurrent.slice(20 * 60, 21 * 60).reduce((a, b) => a + b, 0) / (60 * DAYS);
if (midday < evening * 0.6) fail(`midday ${midday.toFixed(1)} of ${BOTS} out vs evening ${evening.toFixed(1)} — too quiet`);

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
console.log(`✓ bot-day: ${BOTS} bots × ${DAYS} days — ${perDayWalks.toFixed(2)} walks/day, ${perDayMin.toFixed(0)} min/day online (${(share * 100).toFixed(1)}%), on average ${(share * BOTS).toFixed(1)} of ${BOTS} out at any moment, peak ${peak.toFixed(1)} at ${hhmm(peakAt)} Kyiv`);
console.log(`  at 13:00 ${midday.toFixed(1)} of ${BOTS} out, at 20:00 ${evening.toFixed(1)} — scaled to 120: ${(midday * 4).toFixed(0)} and ${(evening * 4).toFixed(0)}`);
const now = kyivClock(Date.now());
console.log(`  now ${hhmm(now.minute)} Kyiv, day ${now.day}; bot 0 today: ${planDay(0, now.day).walks.map((w) => `${hhmm(w.start)}–${hhmm(w.end)}`).join(', ') || 'stays in'}`);
