// WHAT THE DAY OWES, as a pure function.
//
// The six tasks pay paws the moment a counter crosses its target, and a
// counter does not stop there — the fourth bone arrives after the third
// one has already paid. So "what do we owe right now" is not "which
// targets are met", it is "which targets are met AND have not been paid
// for yet", and the row has to remember. That is `paid`.
//
// The bonus is the same shape one level up: all six met, and the bonus
// not yet paid.
//
// Pure and fixture-checked (`pnpm check:daily`) because every way of
// getting this wrong pays somebody twice — or, worse, once and never
// again — and none of them is visible in a reading of the SQL that does
// the granting. It is also the arithmetic nobody can afford to have
// wrong in a currency the walker can see.

import { balance } from '../config/balance.js';

export const TASK_KEYS = [
  'searchQuests',
  'bones',
  'landmarks',
  'landM2',
  'maxHappiness',
  'spotVisits',
] as const;

export type TaskKey = (typeof TASK_KEYS)[number];

/** The day's counters, as stored. */
export type Counters = Record<TaskKey, number>;

/**
 * Targets, keyed the same. `spotVisits` is the routed kind now — a spot
 * arrived at on a planned walk — so it reads its own target.
 */
export function targetFor(key: TaskKey): number {
  const t = balance.dailyTasks.targets;
  return key === 'spotVisits' ? t.routedSpotVisits : t[key];
}

export function rewardFor(key: TaskKey): number {
  const r = balance.dailyTasks.rewards;
  return key === 'spotVisits' ? r.routedSpotVisits : r[key];
}

export interface Owed {
  /** Tasks that have just been earned and not yet paid. */
  tasks: TaskKey[];
  /** True when the whole set is done and the bonus is still unpaid. */
  bonus: boolean;
  /** Paws to add: the tasks above, plus the bonus if it is owed. */
  paws: number;
}

export function isDone(counters: Counters, key: TaskKey): boolean {
  return (counters[key] ?? 0) >= targetFor(key);
}

export function allDone(counters: Counters): boolean {
  return TASK_KEYS.every((k) => isDone(counters, k));
}

/**
 * What to pay, given the counters as they now stand, what has already
 * been paid, and whether the bonus has gone out.
 *
 * Idempotent by construction: call it twice with the same inputs and
 * the second call owes nothing new, because the first call's payment is
 * what changes `paid`.
 */
export function owed(counters: Counters, paid: readonly string[], bonusPaid: boolean): Owed {
  const already = new Set(paid);
  const tasks = TASK_KEYS.filter((k) => isDone(counters, k) && !already.has(k));
  // The bonus rides on the counters, not on `paid`: a task earned and
  // paid in the same breath as the last one still completes the set.
  const bonus = !bonusPaid && allDone(counters);
  const paws =
    tasks.reduce((sum, k) => sum + rewardFor(k), 0) + (bonus ? balance.dailyTasks.bonus : 0);
  return { tasks, bonus, paws };
}

/** Everything the day is worth, if you did all of it. For the UI. */
export function fullDayPaws(): number {
  return TASK_KEYS.reduce((sum, k) => sum + rewardFor(k), 0) + balance.dailyTasks.bonus;
}
