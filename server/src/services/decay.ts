import type { FastifyBaseLogger } from 'fastify';
import { sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { balance } from '../config/balance.js';
import { runCronTick } from './cronUtils.js';

// Run every tickMs; applies decay proportional to elapsed time since last_decay_at.
// Clamped so idle users don't go to 0 instantly on first tick after deploy.
// NB: we use SQL NOW() rather than a JS Date param — postgres-js 3.4.x chokes
// when a Date value is bound as a query parameter.
//
// HAPPINESS decays slower on home ground — the passive territory perk.
// It reads off a column rather than the shapes because this is one bulk
// UPDATE across every companion; /sync/map writes the flag when it has
// the geometry in hand. Hunger is untouched on purpose: that's the bones
// economy, and slowing it would take the point out of walking to parks.
export async function runDecayTick() {
  const hungerPerMs = balance.hunger.decay / balance.hunger.intervalMs;
  const happinessPerMs = balance.happiness.decay / balance.happiness.intervalMs;
  const homeHappinessPerMs = happinessPerMs * balance.territory.homeHappinessDecayFactor;
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
        ROUND(
          CASE
            WHEN c.on_home_ground THEN ${homeHappinessPerMs}::double precision
            ELSE ${happinessPerMs}::double precision
          END
            * LEAST(${maxElapsedMs}, EXTRACT(EPOCH FROM (NOW() - c.last_decay_at)) * 1000)
        )
      )::int),
      last_decay_at = NOW()
    WHERE EXTRACT(EPOCH FROM (NOW() - c.last_decay_at)) * 1000 >= ${balance.hunger.intervalMs}
  `);
}

export function startDecayCron(
  log: FastifyBaseLogger,
  intervalMs: number = balance.hunger.intervalMs,
) {
  const id = setInterval(() => {
    void runCronTick('decay', runDecayTick, log);
  }, intervalMs);
  id.unref?.();
  return () => clearInterval(id);
}
