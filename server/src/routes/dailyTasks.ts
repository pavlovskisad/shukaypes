// The day's six, read by the tasks card.
//
// WHAT CHANGED, AND WHY THE TICK IS GONE (D-99). This used to be two
// endpoints: a read, and a POST the client called whenever it decided
// something had happened. That was fine while the tasks paid nothing —
// they were the app's own progress bars, kept server-side only so they
// survived a cache wipe. The moment a crossed target pays paws, a
// counter anybody can POST to is a mint.
//
// So the tick is gone entirely, and every one of the six is counted
// from an event the server already witnesses (services/dailyTasks.ts).
// The endpoint is not kept as a no-op or a 403-per-key: a route that
// exists is a route somebody wires back up.
//
// The date is no longer the client's either. It used to send its local
// calendar day because the server did not track timezones; the server
// is the one counting now, so it keeps the day itself, on the Kyiv
// clock the bots already live on.

import type { FastifyPluginAsync } from 'fastify';
import { balance } from '../config/balance.js';
import { limitRead } from '../lib/rateLimit.js';
import { TASK_KEYS, fullDayPaws, rewardFor, targetFor } from '../services/dailyRewards.js';
import { todayFor } from '../services/dailyTasks.js';

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/tasks/today', limitRead, async (req) => {
    const today = await todayFor(req.userId);
    return {
      date: today.date,
      // The counters, and what each is worth — sent together so the
      // card never has to carry its own copy of the numbers. The
      // balance file is the one place any of them is written down.
      tasks: TASK_KEYS.map((key) => ({
        key,
        value: today.counters[key],
        target: targetFor(key),
        reward: rewardFor(key),
        done: today.counters[key] >= targetFor(key),
        paid: today.paid.includes(key),
      })),
      bonus: {
        reward: balance.dailyTasks.bonus,
        paid: today.bonusPaid,
      },
      // What the whole day is worth, so the card can say so without
      // summing six numbers and getting it subtly wrong.
      fullDayPaws: fullDayPaws(),
    };
  });
};

export default plugin;
