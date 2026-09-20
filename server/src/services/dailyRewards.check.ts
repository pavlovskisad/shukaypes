// Fixture check for what a day owes (services/dailyRewards.ts).
// Run with `pnpm check:daily`. No network, no database.
//
// The rule is four lines long and every way of getting it wrong is a
// money bug: pay twice, pay never, or pay the bonus to somebody who did
// five of six. So the cases here are written as the SEQUENCE a walker
// actually produces — counters climbing past their targets, one event
// at a time, with the payment applied in between.

import { balance } from '../config/balance.js';
import {
  TASK_KEYS,
  allDone,
  fullDayPaws,
  owed,
  rewardFor,
  targetFor,
  type Counters,
  type TaskKey,
} from './dailyRewards.js';

function fail(msg: string): never {
  console.error(`✗ daily: ${msg}`);
  process.exit(1);
}

const zero = (): Counters =>
  Object.fromEntries(TASK_KEYS.map((k) => [k, 0])) as Counters;

// ---------------------------------------------------------------- one task

// Three bones, one at a time. Nothing until the third; the third pays;
// the fourth pays nothing. THE BUG THIS GUARDS: a counter does not stop
// at its target, so "is it done" is not "should we pay".
{
  const c = zero();
  const paid: string[] = [];
  const got: number[] = [];
  for (let i = 1; i <= 4; i++) {
    c.bones = i;
    const o = owed(c, paid, false);
    got.push(o.paws);
    paid.push(...o.tasks);
  }
  const want = [0, 0, rewardFor('bones'), 0];
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(`bones one at a time paid ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
  }
  if (paid.length !== 1) fail(`bones should be marked paid exactly once, got ${paid.length}`);
}

// Land is metres, not a count, and arrives in lumps of whatever ground a
// claim gained. Crossing in one jump pays once; more ground after that
// pays nothing.
{
  const c = zero();
  const paid: string[] = [];
  c.landM2 = targetFor('landM2') - 1;
  if (owed(c, paid, false).paws !== 0) fail('one metre short of the land target must pay nothing');
  c.landM2 = targetFor('landM2') + 50_000;
  const o = owed(c, paid, false);
  if (o.paws !== rewardFor('landM2')) fail(`crossing the land target paid ${o.paws}`);
  paid.push(...o.tasks);
  c.landM2 += 500_000;
  if (owed(c, paid, false).paws !== 0) fail('more ground after the land target must pay nothing');
}

// Exactly on the target counts as done. Off-by-one here is a task that
// can never be finished.
for (const k of TASK_KEYS) {
  const c = zero();
  c[k] = targetFor(k);
  if (!owed(c, [], false).tasks.includes(k)) fail(`${k} exactly at its target must pay`);
}

// ------------------------------------------------------------- the bonus

// Five of six is not the set.
{
  const c = zero();
  for (const k of TASK_KEYS) c[k] = targetFor(k);
  c[TASK_KEYS[0]!] = targetFor(TASK_KEYS[0]!) - 1;
  if (allDone(c)) fail('five of six must not read as the whole set');
  if (owed(c, [], false).bonus) fail('five of six must not pay the bonus');
}

// The last task and the bonus land together — the task is earned and
// paid in the same breath that completes the set, so the bonus may not
// wait for a further event that never comes.
{
  const c = zero();
  const paid: string[] = [];
  for (const k of TASK_KEYS.slice(0, -1)) {
    c[k] = targetFor(k);
    paid.push(...owed(c, paid, false).tasks);
  }
  const last = TASK_KEYS[TASK_KEYS.length - 1]!;
  c[last] = targetFor(last);
  const o = owed(c, paid, false);
  if (!o.bonus) fail('the bonus must land with the task that completes the set');
  if (!o.tasks.includes(last)) fail('the task that completes the set must pay too');
  if (o.paws !== rewardFor(last) + balance.dailyTasks.bonus) {
    fail(`the last task plus bonus paid ${o.paws}`);
  }
  // And once paid, never again.
  paid.push(...o.tasks);
  if (owed(c, paid, true).paws !== 0) fail('a finished day must owe nothing');
}

// A whole day in one go pays every task and the bonus, exactly once.
{
  const c = zero();
  for (const k of TASK_KEYS) c[k] = targetFor(k) * 3;
  const o = owed(c, [], false);
  if (o.tasks.length !== TASK_KEYS.length) fail('a full day must pay every task');
  if (o.paws !== fullDayPaws()) fail(`a full day paid ${o.paws}, expected ${fullDayPaws()}`);
  if (owed(c, o.tasks as TaskKey[], true).paws !== 0) fail('a paid-out day must owe nothing');
}

// ------------------------------------------------------- nothing for free

if (owed(zero(), [], false).paws !== 0) fail('an untouched day must owe nothing');
// A `paid` list carrying a key that is not a task (an older row, a
// renamed task) must not throw or confuse the rest.
if (owed(zero(), ['tokens', 'sightings'], false).paws !== 0) {
  fail('retired task keys in `paid` must be ignored');
}

console.log(
  `✓ daily: ${TASK_KEYS.length} tasks pay once each at their target, the bonus lands with the last of them, a full day is ${fullDayPaws()} paws`,
);
