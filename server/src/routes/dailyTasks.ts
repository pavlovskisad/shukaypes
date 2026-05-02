// Daily-task progress endpoints. Promoted from client-side
// localStorage (PR #161) so progress survives a cache wipe and syncs
// across devices on the same userId.
//
// The client computes its local calendar date (YYYY-MM-DD) and sends
// it on every call — we don't track timezones server-side. A user
// crossing midnight while tabbed away just lands on the new date
// row on next interaction; yesterday's row stays as history.
//
// Two endpoints:
//   GET  /tasks/today?date=YYYY-MM-DD → fetch (creates with zeros if missing)
//   POST /tasks/tick body { date, key, amount? } → upsert + increment

import type { FastifyPluginAsync } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

const VALID_KEYS = ['tokens', 'bones', 'lostPetChecks', 'spotVisits', 'sightings'] as const;
type TaskKey = (typeof VALID_KEYS)[number];

// Map JS camelCase → DB snake_case for the SET clause. Drizzle's
// column references in dynamic SQL get awkward; explicit map is
// clearer for a five-key enum.
const KEY_TO_COLUMN: Record<TaskKey, string> = {
  tokens: 'tokens',
  bones: 'bones',
  lostPetChecks: 'lost_pet_checks',
  spotVisits: 'spot_visits',
  sightings: 'sightings',
};

// YYYY-MM-DD shape check; doesn't validate calendar correctness but
// blocks SQL-shaped junk and keeps the column small.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface TodayQuery { date: string }
interface TickBody { date: string; key: string; amount?: number }

interface TaskRow {
  date: string;
  tokens: number;
  bones: number;
  lostPetChecks: number;
  spotVisits: number;
  sightings: number;
}

function emptyRow(date: string): TaskRow {
  return { date, tokens: 0, bones: 0, lostPetChecks: 0, spotVisits: 0, sightings: 0 };
}

const plugin: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: TodayQuery }>('/tasks/today', async (req, reply) => {
    const date = String(req.query.date ?? '');
    if (!DATE_RE.test(date)) {
      reply.code(400);
      return { error: 'invalid date' };
    }
    const [row] = await db
      .select()
      .from(schema.dailyTasks)
      .where(
        and(
          eq(schema.dailyTasks.userId, req.userId),
          eq(schema.dailyTasks.date, date),
        ),
      )
      .limit(1);
    if (!row) {
      // Don't materialise an empty row on read — the first tick will
      // upsert it. Empty result reads as "all zeros" client-side via
      // emptyRow().
      return { tasks: emptyRow(date) };
    }
    return {
      tasks: {
        date: row.date,
        tokens: row.tokens,
        bones: row.bones,
        lostPetChecks: row.lostPetChecks,
        spotVisits: row.spotVisits,
        sightings: row.sightings,
      } satisfies TaskRow,
    };
  });

  app.post<{ Body: TickBody }>('/tasks/tick', async (req, reply) => {
    const { date, key } = req.body ?? ({} as TickBody);
    const amount = req.body?.amount ?? 1;
    if (!DATE_RE.test(date)) {
      reply.code(400);
      return { error: 'invalid date' };
    }
    if (!VALID_KEYS.includes(key as TaskKey)) {
      reply.code(400);
      return { error: 'invalid key' };
    }
    if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
      reply.code(400);
      return { error: 'invalid amount' };
    }
    const column = KEY_TO_COLUMN[key as TaskKey];

    // Upsert: insert with the increment as the initial value, or
    // bump the existing column if the row already exists. Single
    // round-trip; postgres handles concurrent ticks via row locks
    // on the conflict target.
    await db.execute(sql`
      INSERT INTO daily_tasks (user_id, date, ${sql.raw(column)}, updated_at)
      VALUES (${req.userId}, ${date}, ${amount}, NOW())
      ON CONFLICT (user_id, date) DO UPDATE
      SET ${sql.raw(column)} = daily_tasks.${sql.raw(column)} + EXCLUDED.${sql.raw(column)},
          updated_at = NOW()
    `);
    return { ok: true };
  });
};

export default plugin;
