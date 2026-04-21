import { sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { balance } from '../config/balance.js';

// Run every tickMs; applies decay proportional to elapsed time since last_decay_at.
// Clamped so idle users don't go to 0 instantly on first tick after deploy.
// NB: we use SQL NOW() rather than a JS Date param — postgres-js 3.4.x chokes
// when a Date value is bound as a query parameter.
export async function runDecayTick() {
  const hungerPerMs = balance.hunger.decay / balance.hunger.intervalMs;
  const happinessPerMs = balance.happiness.decay / balance.happiness.intervalMs;
  const maxElapsedMs = balance.hunger.intervalMs * 30; // cap at 30 ticks (~4min)

  await db.execute(sql`
    UPDATE ${schema.companionState} AS c
    SET
      hunger = GREATEST(0, c.hunger - LEAST(
        ${balance.hunger.decay * 30},
        ROUND(${hungerPerMs} * LEAST(${maxElapsedMs}, EXTRACT(EPOCH FROM (NOW() - c.last_decay_at)) * 1000))
      )::int),
      happiness = GREATEST(0, c.happiness - LEAST(
        ${balance.happiness.decay * 30},
        ROUND(${happinessPerMs} * LEAST(${maxElapsedMs}, EXTRACT(EPOCH FROM (NOW() - c.last_decay_at)) * 1000))
      )::int),
      last_decay_at = NOW()
    WHERE EXTRACT(EPOCH FROM (NOW() - c.last_decay_at)) * 1000 >= ${balance.hunger.intervalMs}
  `);
}

export function startDecayCron(intervalMs: number = balance.hunger.intervalMs) {
  const id = setInterval(() => {
    runDecayTick().catch((err) => console.error('[decay]', err));
  }, intervalMs);
  id.unref?.();
  return () => clearInterval(id);
}
