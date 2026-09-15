// THE CONSOLE'S MEMORY (D-84).
//
// Everything else the console shows is computed the moment you ask, which
// makes it a readout: it can say what is true and never whether it is
// moving. "Did the midday change actually put more dogs out" is not a
// question a snapshot can answer, and answering it by reading five-minute
// log lines out of Fly is how this repo has been doing it — by hand,
// through me, one window at a time.
//
// So: one row every five minutes, twelve columns of numbers worth a line
// on a chart, and a sixty-day floor under it. 288 rows a day, ~105k a
// year, a few megabytes — the cheapest thing on this database and the
// only one that turns the page into an instrument.
//
// CHEAP BY CONSTRUCTION. The cron reuses collectLive() — which the
// console is already calling every twenty seconds anyway — plus ONE extra
// query for the slower-moving totals. Nothing here scans a table the live
// path does not already scan.
//
// A MEAN OVER NOTHING IS NULL, NOT ZERO. The bot means are nullable and
// stay null when no bot is online, because storing zero would draw the
// happiness line crashing to the floor every night when the pool goes
// home — a chart that lies about the one rhythm the whole system is
// built on.

import type { FastifyBaseLogger } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { balance } from '../config/balance.js';
import { collectLive } from './live.js';
import { runCronTick } from './cronUtils.js';

// Five minutes: the same window the bots' own life line uses, so a point
// on the chart and a line in the log describe the same slice of time.
const EVERY_MS = 5 * 60_000;
// Long enough to see a week-over-week shape, short enough that nobody has
// to think about this table again.
const KEEP_DAYS = 60;

interface SlowRow {
  marks_total: number;
  ground_pieces: number;
  owners: number;
  paws_live: number;
  bones_live: number;
  real_accounts: number;
  dau: number;
  bots_index: number | null;
  bots_hunger: number | null;
  bots_happiness: number | null;
}

export async function writeSnapshot(): Promise<void> {
  const live = await collectLive();
  const rows = (await db.execute(sql`
    select
      (select count(*)::int from territory_marks)                        as marks_total,
      (select count(*)::int from territory_ground)                       as ground_pieces,
      (select count(distinct user_id)::int from territory_ground)        as owners,
      (select count(*)::int from tokens     where collected_at is null)  as paws_live,
      (select count(*)::int from food_items where consumed_at  is null)  as bones_live,
      (select count(*)::int from users where id not like 'bot:%')        as real_accounts,
      (select count(distinct user_id)::int from collect_events
         where user_id not like 'bot:%' and at >= now() - interval '24 hours') as dau,
      avg(happy_weight_s / nullif(active_s, 0)) filter (
        where user_id like 'bot:%' and active_s >= ${balance.happinessIndex.minActiveS}
      ) as bots_index,
      avg(hunger)    filter (where user_id like 'bot:%') as bots_hunger,
      avg(happiness) filter (where user_id like 'bot:%') as bots_happiness
    from companion_state
  `)) as unknown as SlowRow[];
  const s = rows[0];
  if (!s) return;

  // The worst tick in the window, which is the one that says whether the
  // machine kept up.
  const tickMax = live.ticks.reduce((m, t) => (t.max > m ? t.max : m), 0);
  const round1 = (n: number | null) =>
    n == null ? null : Math.round(Number(n) * 10) / 10;

  await db.execute(sql`
    insert into metrics_snapshots (
      at, presence_total, presence_people, presence_bots,
      with_dog_people, with_dog_bots,
      paws_5m, bones_5m, marks_5m, paws_live, bones_live,
      marks_total, ground_pieces, owners_with_ground,
      real_accounts, dau, tick_max_ms,
      bots_index_mean, bots_hunger_mean, bots_happiness_mean
    ) values (
      now(), ${live.presence.total}, ${live.presence.people}, ${live.presence.bots},
      ${live.withDog.people}, ${live.withDog.bots},
      ${live.last5m.paws}, ${live.last5m.bones}, ${live.last5m.marks},
      ${s.paws_live}, ${s.bones_live},
      ${s.marks_total}, ${s.ground_pieces}, ${s.owners},
      ${s.real_accounts}, ${s.dau}, ${tickMax},
      ${round1(s.bots_index)}, ${round1(s.bots_hunger)}, ${round1(s.bots_happiness)}
    )
    on conflict (at) do nothing
  `);
}

export interface SnapshotRow {
  at: string;
  [k: string]: number | string | null;
}

export async function readHistory(hours = 24): Promise<SnapshotRow[]> {
  // Clamped: the console asks for a day, and an unbounded window on a
  // token-gated endpoint is still a way to make the database work hard.
  const h = Math.max(1, Math.min(24 * 30, Math.round(hours)));
  const rows = (await db.execute(sql`
    select * from metrics_snapshots
    where at >= now() - (${h}::int * interval '1 hour')
    order by at asc
  `)) as unknown as SnapshotRow[];
  return rows;
}

export async function pruneSnapshots(): Promise<number> {
  const r = (await db.execute(sql`
    delete from metrics_snapshots where at < now() - (${KEEP_DAYS}::int * interval '1 day')
  `)) as unknown as { count?: number };
  return r.count ?? 0;
}

// One row every five minutes, and a prune once a day's worth of ticks
// have gone by. Returns a stop fn like every other cron here.
export function startMetricsSnapshotCron(log: FastifyBaseLogger): () => void {
  let ticks = 0;
  const id = setInterval(() => {
    void runCronTick(
      'metrics-snapshot',
      async () => {
        await writeSnapshot();
        // 288 ticks is a day. Pruning more often than that would be
        // deleting nothing, over and over.
        if (++ticks % 288 === 0) {
          const gone = await pruneSnapshots();
          if (gone > 0) {
            log.info({ kind: 'metrics_prune', gone }, `metrics: pruned ${gone} snapshots`);
          }
        }
      },
      log,
    );
  }, EVERY_MS);
  id.unref?.();
  return () => clearInterval(id);
}
