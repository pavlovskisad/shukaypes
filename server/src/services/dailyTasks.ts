// The day's six, counted and paid server-side (D-99).
//
// WHY THE SERVER COUNTS. Until these tasks paid anything, the client
// ticking them was harmless: /tasks/tick was a counter the app kept for
// its own progress bars. The moment a crossed target pays paws, that
// endpoint becomes a mint — one fetch in a console, repeated. So every
// one of the six is now counted from an event the server already sees,
// and the client's tick no longer accepts any of them.
//
//   searchQuests  a quest completing in /quests/advance
//   bones         eatFoodTx, the same transaction that feeds the dog
//   landmarks     /lore/discover, the long-press sniff
//   landM2        claimGround's gainedM2 — ground GAINED, so re-marking
//                 what you already hold does not count
//   maxHappiness  the happiness service, when it reaches the ceiling
//   spotVisits    arriving at the destination of a planned walk
//
// THE DAY IS A KYIV DAY. The old endpoint took the date from the client
// ("we don't track timezones server-side"), which cannot work once the
// server is the one counting: nobody is asking. Kyiv is where the game
// is, it is the clock the bots already live on (botDay.kyivClock), and
// a walker in another zone gets a day that rolls over at Kyiv midnight
// rather than one that never rolls over at all.
//
// PAYING IS PART OF THE SAME TRANSACTION as counting, under a row lock,
// so two events landing together cannot both see "not yet paid" and pay
// twice. What is owed is decided by the pure rule in dailyRewards.ts.

import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { balance } from '../config/balance.js';
import { distanceMeters } from '../utils/geo.js';
import { kyivClock } from './botDay.js';
import { TASK_KEYS, owed, type Counters, type TaskKey } from './dailyRewards.js';

/** The Kyiv calendar day as YYYY-MM-DD. */
export function kyivDate(nowMs: number = Date.now()): string {
  const { day } = kyivClock(nowMs);
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

const COLUMN: Record<TaskKey, string> = {
  searchQuests: 'search_quests',
  bones: 'bones',
  landmarks: 'landmarks',
  landM2: 'land_m2',
  maxHappiness: 'max_happiness',
  spotVisits: 'spot_visits',
};

export interface TickResult {
  /** Tasks that crossed their target on this tick and were paid. */
  earned: TaskKey[];
  /** True when this tick completed the set and paid the bonus. */
  bonus: boolean;
  /** Paws granted by this tick. Zero for most ticks. */
  paws: number;
}

const NOTHING: TickResult = { earned: [], bonus: false, paws: 0 };

function countersOf(row: Record<string, unknown>): Counters {
  return Object.fromEntries(TASK_KEYS.map((k) => [k, Number(row[k] ?? 0)])) as Counters;
}

/**
 * Whatever the counters now make due, paid once, inside the caller's
 * transaction and under the row it already holds.
 *
 * Both tick paths end here, so there is exactly one place that decides
 * to move paws — and the second of two concurrent ticks sees the
 * first's receipt in `paid` and owes nothing.
 */
async function payWhatIsOwed(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  date: string,
  counters: Counters,
  row: Record<string, unknown>,
): Promise<TickResult> {
  const paid = Array.isArray(row.paid) ? (row.paid as string[]) : [];
  const due = owed(counters, paid, row.bonus_paid_at != null);
  if (due.paws <= 0) return NOTHING;

  // The task names are PARAMETERS, not text spliced into the statement.
  // They come from a typed union today and would be safe either way; a
  // statement built by pasting values together is the habit that stops
  // being safe the day one of them comes from somewhere else.
  const additions = sql`ARRAY[${sql.join(
    due.tasks.map((t) => sql`${t}`),
    sql`, `,
  )}]::text[]`;
  await tx.execute(sql`
    UPDATE daily_tasks
    SET paid = paid || ${additions},
        bonus_paid_at = ${due.bonus ? sql`NOW()` : sql`bonus_paid_at`},
        updated_at = NOW()
    WHERE user_id = ${userId} AND date = ${date}
  `);
  await tx
    .update(schema.users)
    .set({ totalTokens: sql`${schema.users.totalTokens} + ${due.paws}` })
    .where(eq(schema.users.id, userId));

  return { earned: due.tasks, bonus: due.bonus, paws: due.paws };
}

/**
 * Add to one of the day's counters, and pay whatever that makes due.
 *
 * `amount` is a count for five of the six and square metres for
 * `landM2`. Never throws: a task counter is a nice-to-have on top of
 * the event that produced it, and a walker's bone must not fail to feed
 * the dog because the tasks table was busy.
 */
export async function tickTask(
  userId: string,
  key: TaskKey,
  amount = 1,
): Promise<TickResult> {
  if (!(key in COLUMN)) return NOTHING;
  if (!Number.isFinite(amount) || amount <= 0) return NOTHING;
  const date = kyivDate();
  const column = COLUMN[key];

  try {
    return await db.transaction(async (tx) => {
      // Upsert the counter and take the row's lock in one statement —
      // RETURNING gives us the post-increment row, so the decision
      // below is made on the value this tick produced and nobody
      // else's.
      const res = await tx.execute(sql`
        INSERT INTO daily_tasks (user_id, date, ${sql.raw(column)}, updated_at)
        VALUES (${userId}, ${date}, ${amount}, NOW())
        ON CONFLICT (user_id, date) DO UPDATE
        SET ${sql.raw(column)} = daily_tasks.${sql.raw(column)} + EXCLUDED.${sql.raw(column)},
            updated_at = NOW()
        RETURNING search_quests, bones, landmarks, land_m2, max_happiness,
                  spot_visits, paid, bonus_paid_at
      `);
      const row = (res[0] ?? null) as Record<string, unknown> | null;
      if (!row) return NOTHING;

      const counters = countersOf({
        searchQuests: row.search_quests,
        bones: row.bones,
        landmarks: row.landmarks,
        landM2: row.land_m2,
        maxHappiness: row.max_happiness,
        spotVisits: row.spot_visits,
      });
      return payWhatIsOwed(tx, userId, date, counters, row);
    });
  } catch (err) {
    console.error('[daily] tick failed', key, err);
    return NOTHING;
  }
}

export interface TodayRow {
  date: string;
  counters: Counters;
  paid: string[];
  bonusPaid: boolean;
}

/** The day as it stands, for the tasks card. Never creates a row. */
export async function todayFor(userId: string): Promise<TodayRow> {
  const date = kyivDate();
  const blank: TodayRow = {
    date,
    counters: Object.fromEntries(TASK_KEYS.map((k) => [k, 0])) as Counters,
    paid: [],
    bonusPaid: false,
  };
  const [row] = await db
    .select()
    .from(schema.dailyTasks)
    .where(and(eq(schema.dailyTasks.userId, userId), eq(schema.dailyTasks.date, date)))
    .limit(1);
  if (!row) return blank;
  return {
    date,
    counters: countersOf({
      searchQuests: row.searchQuests,
      bones: row.bones,
      landmarks: row.landmarks,
      landM2: row.landM2,
      maxHappiness: row.maxHappiness,
      spotVisits: row.spotVisits,
    }),
    paid: row.paid ?? [],
    bonusPaid: row.bonusPaidAt != null,
  };
}

/**
 * A landmark sniffed. Counted by IDENTITY, not by how many times the
 * client asked: /lore/discover is handed the already-seen list by the
 * app, so three calls with an empty exclude list are three sniffs of
 * the same statue. The row keeps the ids, and the counter is how many
 * distinct ones are in it.
 */
export async function tickLandmark(userId: string, loreId: string): Promise<TickResult> {
  if (!loreId) return NOTHING;
  const date = kyivDate();
  try {
    return await db.transaction(async (tx) => {
      // array_append only when it is not already there, and the counter
      // follows the array rather than being incremented beside it — one
      // source of truth, so they cannot disagree.
      const res = await tx.execute(sql`
        INSERT INTO daily_tasks (user_id, date, landmark_ids, landmarks, updated_at)
        VALUES (${userId}, ${date}, ARRAY[${loreId}]::text[], 1, NOW())
        ON CONFLICT (user_id, date) DO UPDATE
        SET landmark_ids = CASE
              WHEN ${loreId} = ANY(daily_tasks.landmark_ids) THEN daily_tasks.landmark_ids
              ELSE array_append(daily_tasks.landmark_ids, ${loreId})
            END,
            landmarks = CASE
              WHEN ${loreId} = ANY(daily_tasks.landmark_ids)
                THEN cardinality(daily_tasks.landmark_ids)
              ELSE cardinality(daily_tasks.landmark_ids) + 1
            END,
            updated_at = NOW()
        RETURNING search_quests, bones, landmarks, land_m2, max_happiness,
                  spot_visits, paid, bonus_paid_at
      `);
      const row = (res[0] ?? null) as Record<string, unknown> | null;
      if (!row) return NOTHING;
      const counters = countersOf({
        searchQuests: row.search_quests,
        bones: row.bones,
        landmarks: row.landmarks,
        landM2: row.land_m2,
        maxHappiness: row.max_happiness,
        spotVisits: row.spot_visits,
      });
      return payWhatIsOwed(tx, userId, date, counters, row);
    });
  } catch (err) {
    console.error('[daily] landmark tick failed', err);
    return NOTHING;
  }
}

// A dog sitting at the ceiling polls /state every few seconds, and the
// day's max-happiness task needs noticing exactly once. This remembers
// who has already been noticed today so the common case costs nothing.
//
// It is a CACHE, not the rule: the rule is the row (the counter is a
// ceiling of 1, the reward pays once), so a restart or a second server
// costs one extra no-op write and never a second payment.
const maxHappinessSeen = new Map<string, string>();

/**
 * The dog's happiness is at its ceiling right now. Counts the day's
 * task the first time we see it, and does nothing on every poll after.
 */
export async function noteMaxHappiness(userId: string): Promise<TickResult | null> {
  const date = kyivDate();
  if (maxHappinessSeen.get(userId) === date) return null;
  maxHappinessSeen.set(userId, date);
  // Yesterday's entries are dead weight; the map is one row per active
  // walker per day, and this keeps it that size.
  if (maxHappinessSeen.size > 5_000) {
    for (const [id, d] of maxHappinessSeen) if (d !== date) maxHappinessSeen.delete(id);
  }
  const r = await tickTask(userId, 'maxHappiness', 1);
  return r.paws > 0 ? r : null;
}

// ── The planned walk ────────────────────────────────────────────────

/**
 * Record where the walker says they are walking to.
 *
 * Refused from close up: the task is a walk, and a route planned to the
 * spot you are standing on is not one. Returns whether it was kept, so
 * the caller can say nothing rather than lie.
 */
export async function planWalk(
  userId: string,
  dest: { lat: number; lng: number; name?: string | null },
  from: { lat: number; lng: number } | null,
): Promise<{ kept: boolean; startDistM: number }> {
  if (!Number.isFinite(dest.lat) || !Number.isFinite(dest.lng)) {
    return { kept: false, startDistM: 0 };
  }
  const startDistM = from ? distanceMeters(from, dest) : 0;
  if (startDistM < balance.dailyTasks.walkPlan.minStartM) {
    return { kept: false, startDistM };
  }
  await db
    .insert(schema.walkPlans)
    .values({
      userId,
      lat: dest.lat,
      lng: dest.lng,
      name: dest.name ?? null,
      startDistM,
    })
    .onConflictDoUpdate({
      target: schema.walkPlans.userId,
      set: {
        lat: dest.lat,
        lng: dest.lng,
        name: dest.name ?? null,
        startDistM,
        createdAt: new Date(),
      },
    });
  return { kept: true, startDistM };
}

/**
 * Has the walker arrived at the walk they planned?
 *
 * Called from /collect/path with the position the SERVER just accepted,
 * so both ends of the walk are the server's own record: it wrote where
 * the walk started from, and it is writing where the walker is now.
 * Clears the plan on arrival, so one planned walk is one arrival.
 */
export async function noteWalkArrival(
  userId: string,
  at: { lat: number; lng: number },
): Promise<TickResult | null> {
  const [plan] = await db
    .select()
    .from(schema.walkPlans)
    .where(eq(schema.walkPlans.userId, userId))
    .limit(1);
  if (!plan) return null;
  if (distanceMeters(at, { lat: plan.lat, lng: plan.lng }) > balance.dailyTasks.walkPlan.arriveM) {
    return null;
  }
  await db.delete(schema.walkPlans).where(eq(schema.walkPlans.userId, userId));
  const r = await tickTask(userId, 'spotVisits', 1);
  return r.paws > 0 ? r : null;
}
