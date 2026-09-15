// WHAT IS HAPPENING RIGHT NOW, for the console's top strip.
//
// Deliberately separate from services/metrics.ts, and the split is about
// cost, not tidiness. The metrics collector is a dozen aggregates over
// every table that matters; it is rate-limited to ten a minute and the
// console asks for it every two minutes. This is the half you want to
// watch — who is out, what they picked up, how the ticks are doing — and
// watching means asking every twenty seconds. So it has to be cheap:
//
//   · one ZRANGEBYSCORE of the live presence set
//   · one scan of collect_events over the last hour (indexed on at)
//   · one of territory_marks over the same hour
//   · one count over companion_state's poll clock
//   · the rest is in memory (services/liveStats.ts)
//
// Four small queries against indexed time columns, on a machine that is
// also serving walkers. Adding anything here that scans a whole table
// belongs in metrics.ts instead.
//
// BOTS ARE COUNTED, AND NAMED. metrics.ts excludes them structurally
// because those numbers describe a business; these describe a system,
// and a system whose load is 120 synthetic walkers should say so. Every
// activity figure is given as both the total and the bots' share.

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { balance } from '../config/balance.js';
import { presenceCounts } from './presence.js';
import { botLife, machine, startedAt, tickStats, type BotLifeWindow, type TickStat } from './liveStats.js';

export interface ActivityWindow {
  paws: number;
  bones: number;
  marks: number;
  botPaws: number;
  botBones: number;
  botMarks: number;
}

export interface Live {
  at: string;
  process: {
    uptimeS: number;
    machine: { id: string | null; version: string | null; region: string | null };
  };
  presence: { total: number; bots: number; people: number };
  // "With their dog" by the decay cron's own definition (D-75): polled
  // inside the online window. Wider than presence — a person on a
  // non-map screen still counts — which is why both are shown.
  withDog: { bots: number; people: number };
  last5m: ActivityWindow;
  last60m: ActivityWindow;
  botLife: BotLifeWindow | null;
  ticks: TickStat[];
}

interface CollectRow {
  paws5: number; bones5: number; botpaws5: number; botbones5: number;
  paws60: number; bones60: number; botpaws60: number; botbones60: number;
}
interface MarkRow { m5: number; botm5: number; m60: number; botm60: number }
interface OnlineRow { bots: number; people: number }

export async function collectLive(nowMs = Date.now()): Promise<Live> {
  // ISO strings with an explicit cast: postgres-js binds a JS Date as a
  // record, which the driver cannot turn into a timestamp (the same
  // trip-up the bots report hit).
  const m5 = new Date(nowMs - 5 * 60_000).toISOString();
  const m60 = new Date(nowMs - 60 * 60_000).toISOString();
  const pollWindow = new Date(nowMs - balance.happinessIndex.onlineWindowMs).toISOString();

  const [presence, collect, marks, online] = await Promise.all([
    presenceCounts(nowMs),
    db.execute(sql`
      select
        count(*) filter (where kind = 'token' and at >= ${m5}::timestamptz)::int as paws5,
        count(*) filter (where kind = 'food'  and at >= ${m5}::timestamptz)::int as bones5,
        count(*) filter (where kind = 'token' and at >= ${m5}::timestamptz and user_id like 'bot:%')::int as botpaws5,
        count(*) filter (where kind = 'food'  and at >= ${m5}::timestamptz and user_id like 'bot:%')::int as botbones5,
        count(*) filter (where kind = 'token')::int as paws60,
        count(*) filter (where kind = 'food')::int as bones60,
        count(*) filter (where kind = 'token' and user_id like 'bot:%')::int as botpaws60,
        count(*) filter (where kind = 'food'  and user_id like 'bot:%')::int as botbones60
      from collect_events
      where accepted and at >= ${m60}::timestamptz
    `) as unknown as Promise<CollectRow[]>,
    db.execute(sql`
      select
        count(*) filter (where created_at >= ${m5}::timestamptz)::int as m5,
        count(*) filter (where created_at >= ${m5}::timestamptz and user_id like 'bot:%')::int as botm5,
        count(*)::int as m60,
        count(*) filter (where user_id like 'bot:%')::int as botm60
      from territory_marks
      where created_at >= ${m60}::timestamptz
    `) as unknown as Promise<MarkRow[]>,
    db.execute(sql`
      select
        count(*) filter (where user_id like 'bot:%')::int as bots,
        count(*) filter (where user_id not like 'bot:%')::int as people
      from companion_state
      where last_poll_at >= ${pollWindow}::timestamptz
    `) as unknown as Promise<OnlineRow[]>,
  ]);

  const c = (collect as unknown as CollectRow[])[0] ?? {
    paws5: 0, bones5: 0, botpaws5: 0, botbones5: 0,
    paws60: 0, bones60: 0, botpaws60: 0, botbones60: 0,
  };
  const mk = (marks as unknown as MarkRow[])[0] ?? { m5: 0, botm5: 0, m60: 0, botm60: 0 };
  const on = (online as unknown as OnlineRow[])[0] ?? { bots: 0, people: 0 };

  return {
    at: new Date(nowMs).toISOString(),
    process: {
      uptimeS: Math.round((nowMs - startedAt) / 1000),
      machine: machine(),
    },
    presence,
    withDog: { bots: on.bots, people: on.people },
    last5m: {
      paws: c.paws5, bones: c.bones5, marks: mk.m5,
      botPaws: c.botpaws5, botBones: c.botbones5, botMarks: mk.botm5,
    },
    last60m: {
      paws: c.paws60, bones: c.bones60, marks: mk.m60,
      botPaws: c.botpaws60, botBones: c.botbones60, botMarks: mk.botm60,
    },
    botLife: botLife(),
    ticks: tickStats(),
  };
}

// The same thing as a terminal report, for the same reason metrics has
// one: "what is happening" should never require a browser.
export function renderLiveText(l: Live): string {
  const out: string[] = [];
  const m = l.process.machine;
  out.push(`live — ${l.at}`);
  out.push(
    `machine ${m.id ?? '?'}${m.version ? ` v${m.version}` : ''}${m.region ? ` ${m.region}` : ''} · up ${Math.floor(l.process.uptimeS / 60)}m`,
  );
  out.push('');
  out.push(`on the map : ${l.presence.total} (${l.presence.people} people, ${l.presence.bots} bots)`);
  out.push(`with a dog : ${l.withDog.people} people, ${l.withDog.bots} bots`);
  const win = (label: string, w: ActivityWindow) =>
    `${label}: ${w.paws} paws (${w.botPaws} bot), ${w.bones} bones (${w.botBones} bot), ${w.marks} marks (${w.botMarks} bot)`;
  out.push(win('last 5m ', l.last5m));
  out.push(win('last 60m', l.last60m));
  const b = l.botLife;
  if (b) {
    out.push('');
    out.push(
      `bots' last window (${b.windowS}s): ${b.online}/${b.pool} out, ${b.outings} went out, ` +
        `${b.bones} bones, ${b.paws} paws, ${b.marks} marks, refused ${b.grumpy} grumpy / ${b.hungry} hungry`,
    );
  }
  if (l.ticks.length) {
    out.push('');
    out.push('cron ticks, last 5 min:');
    for (const t of l.ticks) {
      out.push(`  ${t.name.padEnd(16)} ${String(t.ticks).padStart(4)} ticks  p50 ${t.p50}ms  max ${t.max}ms  slow ${t.slow}`);
    }
  }
  return out.join('\n') + '\n';
}
