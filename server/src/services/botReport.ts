// The bots' life, as numbers (D-76): what thirty dogs living by the
// player's rules do per hour, next to what the people do — the tuning
// bench the owner asked for. Read-only, one request, no shell:
// GET /admin/bots/report[?format=text].
//
// Everything comes from tables the life already writes: companion_state
// (meters, XP, counted time, the happiness totals), collect_events (every
// bone eaten and paw taken, per walker), territory_marks. Nothing here is
// sampled or estimated from the cron's log line; if the report and the
// log disagree, the report is the one to believe, and the log is the one
// to fix.
//
// Rates are PER ONLINE HOUR — events divided by counted life — so a bot
// that is online a third of the day compares with a person who walks
// twenty minutes: both are "what happens while the dog is out".

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { balance } from '../config/balance.js';
import { xpProgress } from '../lib/xp.js';

const DAY_MS = 86_400_000;

export interface BotRow {
  id: string;
  name: string;
  online: boolean;
  hunger: number;
  happiness: number;
  level: number;
  xp: number;
  hoursCounted: number;
  index: number | null;
  bones24h: number;
  paws24h: number;
  bonesAll: number;
  pawsAll: number;
  marksLive: number;
  marks24h: number;
}

export interface Cohort {
  walkers: number;
  online: number;
  hoursCounted: number;
  bonesPerHour: number | null;
  pawsPerHour: number | null;
  marksPerHour24h: number | null;
  indexMean: number | null;
  hungerMean: number | null;
  happinessMean: number | null;
}

export interface BotReport {
  at: string;
  rules: {
    onlineWindowMs: number;
    collectReachM: number;
    tokensInUserArea: number;
    bonesPerPark: number;
    foodCount: number;
    hungerDecayPer8s: number;
    happinessDecayPer8s: number;
    markMinHappiness: number;
    markMinHunger: number;
    luckyPawThreshold: number;
  };
  bots: BotRow[];
  botsTotal: Cohort;
  people: Cohort;
}

interface Agg {
  id: string;
  name: string;
  hunger: number;
  happiness: number;
  xp: number;
  active_s: number;
  happy_weight_s: number;
  online: boolean;
  bones24h: number;
  paws24h: number;
  bones_all: number;
  paws_all: number;
  marks_live: number;
  marks24h: number;
}

// One query per cohort: the companion row, the ledger counts and the
// marks, grouped per walker. Bots are `bot:%`; people are everyone else
// with any counted life.
async function aggregate(bots: boolean, now: Date): Promise<Agg[]> {
  // ISO strings with a cast, not Date objects: postgres-js 3.4 chokes on
  // a Date bound as a parameter (see decay.ts).
  const nowIso = now.toISOString();
  const since24 = new Date(now.getTime() - DAY_MS).toISOString();
  const liveSince = new Date(now.getTime() - balance.territory.markTtlDays * DAY_MS).toISOString();
  const win = balance.happinessIndex.onlineWindowMs;
  const who = bots ? sql`c.user_id LIKE 'bot:%'` : sql`c.user_id NOT LIKE 'bot:%' AND c.active_s > 0`;
  const rows = await db.execute(sql`
    SELECT c.user_id AS id,
           COALESCE(u.pet_name, u.telegram_first_name, u.username, 'сусід') AS name,
           c.hunger, c.happiness, c.xp, c.active_s, c.happy_weight_s,
           (c.last_poll_at IS NOT NULL AND c.last_poll_at > ${nowIso}::timestamptz - (${win}::int * interval '1 millisecond')) AS online,
           (SELECT count(*)::int FROM collect_events e WHERE e.user_id = c.user_id AND e.accepted AND e.kind = 'food' AND e.at >= ${since24}::timestamptz) AS bones24h,
           (SELECT count(*)::int FROM collect_events e WHERE e.user_id = c.user_id AND e.accepted AND e.kind = 'token' AND e.at >= ${since24}::timestamptz) AS paws24h,
           (SELECT count(*)::int FROM collect_events e WHERE e.user_id = c.user_id AND e.accepted AND e.kind = 'food') AS bones_all,
           (SELECT count(*)::int FROM collect_events e WHERE e.user_id = c.user_id AND e.accepted AND e.kind = 'token') AS paws_all,
           (SELECT count(*)::int FROM territory_marks m WHERE m.user_id = c.user_id AND m.created_at >= ${liveSince}::timestamptz) AS marks_live,
           (SELECT count(*)::int FROM territory_marks m WHERE m.user_id = c.user_id AND m.created_at >= ${since24}::timestamptz) AS marks24h
    FROM companion_state c
    JOIN users u ON u.id = c.user_id
    WHERE ${who}
    ORDER BY c.user_id
  `);
  return rows as unknown as Agg[];
}

function cohort(rows: Agg[]): Cohort {
  const hours = rows.reduce((a, r) => a + Number(r.active_s), 0) / 3600;
  const sum = (f: (r: Agg) => number) => rows.reduce((a, r) => a + f(r), 0);
  const mean = (f: (r: Agg) => number) => (rows.length ? sum(f) / rows.length : null);
  const ranked = rows.filter((r) => Number(r.active_s) >= balance.happinessIndex.minActiveS);
  const per = (n: number) => (hours > 0 ? Math.round((n / hours) * 10) / 10 : null);
  // Marks per hour over the last day: the day's marks against the
  // day's share of counted life — approximated by the all-time rate
  // when the row is younger than a day, which for bots it will be for
  // the first day after D-76.
  const hours24 = Math.min(hours, rows.length * 24);
  return {
    walkers: rows.length,
    online: rows.filter((r) => r.online).length,
    hoursCounted: Math.round(hours * 10) / 10,
    bonesPerHour: per(sum((r) => Number(r.bones_all))),
    pawsPerHour: per(sum((r) => Number(r.paws_all))),
    marksPerHour24h: hours24 > 0 ? Math.round((sum((r) => Number(r.marks24h)) / hours24) * 10) / 10 : null,
    indexMean: ranked.length
      ? Math.round(ranked.reduce((a, r) => a + Number(r.happy_weight_s) / Number(r.active_s), 0) / ranked.length)
      : null,
    hungerMean: rows.length ? Math.round(mean((r) => Number(r.hunger))!) : null,
    happinessMean: rows.length ? Math.round(mean((r) => Number(r.happiness))!) : null,
  };
}

export async function buildBotReport(nowMs = Date.now()): Promise<BotReport> {
  const now = new Date(nowMs);
  const [bots, people] = await Promise.all([aggregate(true, now), aggregate(false, now)]);
  const rows: BotRow[] = bots.map((r) => {
    const active = Number(r.active_s);
    return {
      id: r.id,
      name: r.name,
      online: r.online,
      hunger: Number(r.hunger),
      happiness: Number(r.happiness),
      level: xpProgress(Number(r.xp)).level,
      xp: Number(r.xp),
      hoursCounted: Math.round((active / 3600) * 10) / 10,
      index: active >= balance.happinessIndex.minActiveS ? Math.round(Number(r.happy_weight_s) / active) : null,
      bones24h: Number(r.bones24h),
      paws24h: Number(r.paws24h),
      bonesAll: Number(r.bones_all),
      pawsAll: Number(r.paws_all),
      marksLive: Number(r.marks_live),
      marks24h: Number(r.marks24h),
    };
  });
  rows.sort((a, b) => (b.index ?? -1) - (a.index ?? -1) || b.hoursCounted - a.hoursCounted);
  return {
    at: now.toISOString(),
    rules: {
      onlineWindowMs: balance.happinessIndex.onlineWindowMs,
      collectReachM: balance.collectMaxDistanceM,
      tokensInUserArea: balance.tokensInUserArea,
      bonesPerPark: balance.bonesPerPark,
      foodCount: balance.foodCount,
      hungerDecayPer8s: balance.hunger.decay,
      happinessDecayPer8s: balance.happiness.decay,
      markMinHappiness: balance.territory.minHappiness,
      markMinHunger: balance.territory.minHunger,
      luckyPawThreshold: balance.xp.luckyPawHappinessThreshold,
    },
    bots: rows,
    botsTotal: cohort(bots),
    people: cohort(people),
  };
}

const pad = (s: string | number, n: number) => String(s).padStart(n);
const fmt = (v: number | null) => (v === null ? '—' : String(v));

export function formatBotReport(r: BotReport): string {
  const L: string[] = [];
  L.push(`bots' life — ${r.at}`);
  L.push('');
  L.push(
    `rules: online window ${r.rules.onlineWindowMs / 1000}s · reach ${r.rules.collectReachM}m · paws/area ${r.rules.tokensInUserArea} · bones/park ${r.rules.bonesPerPark} (no park: ${r.rules.foodCount}) · ` +
      `decay per 8s hunger −${r.rules.hungerDecayPer8s} happiness −${r.rules.happinessDecayPer8s} · mark needs happiness ≥ ${r.rules.markMinHappiness}, hunger ≥ ${r.rules.markMinHunger} · lucky paw at ≥ ${r.rules.luckyPawThreshold}`,
  );
  L.push('');
  const co = (label: string, c: Cohort) =>
    `${label}: ${c.walkers} walkers, ${c.online} online now, ${c.hoursCounted} h counted · per online hour: ${fmt(c.bonesPerHour)} bones, ${fmt(c.pawsPerHour)} paws, ${fmt(c.marksPerHour24h)} marks (24h) · index mean ${fmt(c.indexMean)} · hunger ${fmt(c.hungerMean)} · happiness ${fmt(c.happinessMean)}`;
  L.push(co('bots  ', r.botsTotal));
  L.push(co('people', r.people));
  L.push('');
  L.push(`${'bot'.padEnd(10)} ${'name'.padEnd(10)} on  hun hap lvl ${pad('h', 6)} ${pad('idx', 4)} ${pad('bones24', 7)} ${pad('paws24', 6)} ${pad('marks', 5)} ${pad('m24', 4)}`);
  for (const b of r.bots) {
    L.push(
      `${b.id.padEnd(10)} ${b.name.padEnd(10)} ${b.online ? '●' : '·'}  ${pad(b.hunger, 3)} ${pad(b.happiness, 3)} ${pad(b.level, 3)} ${pad(b.hoursCounted, 6)} ${pad(fmt(b.index), 4)} ${pad(b.bones24h, 7)} ${pad(b.paws24h, 6)} ${pad(b.marksLive, 5)} ${pad(b.marks24h, 4)}`,
    );
  }
  L.push('');
  L.push('on = online now · h = hours counted (with the person) · idx = happiness index, — until an hour · marks = live marks · m24 = marks in the last day');
  return L.join('\n') + '\n';
}
