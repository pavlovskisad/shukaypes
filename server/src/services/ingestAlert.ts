// Tells somebody when pets stop arriving.
//
// This exists because of a measured failure, not a hypothetical one. OLX
// went behind CloudFront's WAF and every tick 403'd; the table simply
// stopped growing, and nothing said so. The evidence surfaced weeks
// later, by hand, from an ingest heartbeat somebody thought to read.
// Meanwhile the app kept serving a map that looked fine and was quietly
// going stale — which for a lost-pet search is the failure that matters,
// because the pets missing from it are the ones nobody is looking for.
//
// Two questions, deliberately separate:
//
//   is a SOURCE blocked?    per-source, catches "OLX is 403ing" within
//                           hours even while other sources still work.
//   has EVERYTHING stopped? pipeline-wide, catches the case where each
//                           source fails in its own way and no single
//                           one looks dramatic.
//
// EDGE-TRIGGERED, both of them. An alert fires on the transition into a
// bad state and then shuts up until the state changes back, at which
// point it says so. A monitor that repeats itself hourly gets muted by
// the person receiving it, and a muted monitor is worse than none —
// it is the same silence with a false sense of coverage.
//
// State lives in redis rather than in memory because deploys are
// frequent and restart the process. An in-memory flag would re-announce
// every existing problem on every deploy, which is precisely the noise
// that gets a channel muted. Redis being unavailable degrades to
// logging, never to throwing: this is called from the scrape cron, and
// the watcher must not be able to break the work it watches.

import type { FastifyBaseLogger } from 'fastify';
import { redis } from '../db/redis.js';
import type { SourceRunSummary } from '../pipeline/source.js';
import { notifyOwner, alertChatId } from './telegramNotify.js';

type Log = Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;

// The state store and the notifier are injectable so the state machine
// can be exercised without a redis and without messaging anybody. This
// is not test scaffolding for its own sake: the whole value of this
// module is that it speaks up exactly once at the right moment, and
// "alerts once, then goes quiet, then says all-clear" is a claim that
// has to be checked rather than reasoned about. See ingestAlert.check.ts.
export interface AlertStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
  incr(key: string): Promise<number>;
}

export interface AlertDeps {
  nowMs?: number;
  store?: AlertStore;
  notify?: (text: string, log: Log) => Promise<boolean>;
}

const redisStore: AlertStore = {
  get: (k) => redis.get(k),
  set: async (k, v) => {
    await redis.set(k, v);
  },
  del: async (k) => {
    await redis.del(k);
  },
  incr: (k) => redis.incr(k),
};

// How long the whole pipeline may insert nothing before that is news.
//
// Measured baseline over 21 days: 2–9 pets inserted per day, never a
// zero day. So 24h of silence is already anomalous — but a quiet
// weekend plus a slow morning could stack, and the first false alarm is
// what teaches somebody to ignore the channel. 36h is comfortably past
// anything observed and still catches a real outage inside two days.
const DEFAULT_STALL_HOURS = 36;

// Consecutive blocked-looking ticks before we call a source blocked.
// One is noise: a single 5xx, a redeploy mid-tick, a transient DNS
// failure. Three consecutive hours is a pattern.
const BLOCKED_TICKS_BEFORE_ALERT = 3;

const K_LAST_INSERT = 'ingest:lastInsertAt';
const K_STALL_ALERTED = 'ingest:stallAlerted';
const K_BLOCKED_COUNT = (source: string) => `ingest:blocked:${source}`;
const K_BLOCKED_ALERTED = (source: string) => `ingest:blockedAlerted:${source}`;

function stallHours(): number {
  const raw = Number(process.env.INGEST_STALL_HOURS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_STALL_HOURS;
}

// Every redis call in this file goes through here. Returns null on any
// failure, and the callers all treat null as "don't know, do nothing" —
// which is the correct behaviour for a monitor whose state store is
// down. It must not start alerting because it lost its memory.
async function safe<T>(op: () => Promise<T>, log: Log, what: string): Promise<T | null> {
  try {
    return await op();
  } catch (err) {
    log.warn({ kind: 'alert_state_failed', what, err: (err as Error).message }, '[alert] redis unavailable');
    return null;
  }
}

// A tick that went looking, found things, ingested none of them, and
// recorded errors. Same shape the cron already logs at error level —
// the condition that made a WAF block look like a healthy run.
function looksBlocked(s: SourceRunSummary): boolean {
  return s.discovered > 0 && s.parsed === 0 && s.errors > 0;
}

function describeAge(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

/**
 * Evaluates the health of one scrape round and alerts on transitions.
 * Never throws.
 */
export async function evaluateIngestHealth(
  summaries: SourceRunSummary[],
  log: Log,
  deps: AlertDeps = {},
): Promise<void> {
  const store = deps.store ?? redisStore;
  const notify = deps.notify ?? notifyOwner;
  const nowMs = deps.nowMs ?? Date.now();
  try {
    await perSourceBlocked(summaries, log, store, notify);
    await pipelineStall(summaries, log, store, notify, nowMs);
  } catch (err) {
    // Belt and braces. Nothing above should throw, and if something new
    // does, it still must not take the scrape cron down with it.
    log.warn({ kind: 'alert_failed', err: (err as Error).message }, '[alert] health evaluation failed');
  }
}

async function perSourceBlocked(
  summaries: SourceRunSummary[],
  log: Log,
  store: AlertStore,
  notify: NonNullable<AlertDeps['notify']>,
): Promise<void> {
  for (const s of summaries) {
    if (looksBlocked(s)) {
      const count = await safe(() => store.incr(K_BLOCKED_COUNT(s.source)), log, 'incr blocked');
      if (count === null || count < BLOCKED_TICKS_BEFORE_ALERT) continue;
      const already = await safe(() => store.get(K_BLOCKED_ALERTED(s.source)), log, 'get blockedAlerted');
      if (already) continue;
      const sample = s.errorMessages?.[0]?.slice(0, 160) ?? 'no error text';
      await fire(
        log,
        notify,
        `⚠️ шукайпес: ${s.source} looks blocked\n\n` +
          `${count} ticks in a row found ${s.discovered} item(s) and ingested none.\n` +
          `First error: ${sample}\n\n` +
          `New pets from this source are not arriving.`,
        { kind: 'ingest_source_blocked', source: s.source, ticks: count },
      );
      await safe(() => store.set(K_BLOCKED_ALERTED(s.source), '1'), log, 'set blockedAlerted');
      continue;
    }

    // A clean tick clears the streak. Recovery is only announced if we
    // had actually complained — otherwise every transient blip would
    // produce an all-clear for a problem nobody heard about.
    const wasAlerted = await safe(() => store.get(K_BLOCKED_ALERTED(s.source)), log, 'get blockedAlerted');
    await safe(() => store.del(K_BLOCKED_COUNT(s.source)), log, 'del blocked');
    if (wasAlerted) {
      await safe(() => store.del(K_BLOCKED_ALERTED(s.source)), log, 'del blockedAlerted');
      await fire(
        log,
        notify,
        `✅ шукайпес: ${s.source} is working again\n\n` +
          `Last tick: ${s.discovered} discovered, ${s.inserted} inserted, ${s.errors} error(s).`,
        { kind: 'ingest_source_recovered', source: s.source },
      );
    }
  }
}

async function pipelineStall(
  summaries: SourceRunSummary[],
  log: Log,
  store: AlertStore,
  notify: NonNullable<AlertDeps['notify']>,
  nowMs: number,
): Promise<void> {
  const insertedNow = summaries.reduce((n, s) => n + s.inserted, 0);

  if (insertedNow > 0) {
    await safe(() => store.set(K_LAST_INSERT, String(nowMs)), log, 'set lastInsert');
    const wasAlerted = await safe(() => store.get(K_STALL_ALERTED), log, 'get stallAlerted');
    if (wasAlerted) {
      await safe(() => store.del(K_STALL_ALERTED), log, 'del stallAlerted');
      await fire(
        log,
        notify,
        `✅ шукайпес: pets are arriving again\n\n` +
          `${insertedNow} inserted this tick.`,
        { kind: 'ingest_recovered', inserted: insertedNow },
      );
    }
    return;
  }

  const raw = await safe(() => store.get(K_LAST_INSERT), log, 'get lastInsert');
  if (raw === null) return; // redis down — don't guess.
  if (!raw) {
    // First run against a fresh redis. Seed the clock rather than
    // treating "no memory" as "no pets since the epoch" — a monitor
    // that alerts on its own first boot is a monitor nobody trusts.
    await safe(() => store.set(K_LAST_INSERT, String(nowMs)), log, 'seed lastInsert');
    return;
  }

  const age = nowMs - Number(raw);
  if (!Number.isFinite(age) || age < stallHours() * 3_600_000) return;

  const already = await safe(() => store.get(K_STALL_ALERTED), log, 'get stallAlerted');
  if (already) return;

  const perSource = summaries
    .map((s) => `  ${s.source}: ${s.discovered} found, ${s.errors} error(s)`)
    .join('\n');
  await fire(
    log,
    notify,
    `🚨 шукайпес: no new pets for ${describeAge(age)}\n\n` +
      `Nothing has been inserted by any source since then. Last tick:\n${perSource}\n\n` +
      `The map is going stale.`,
    { kind: 'ingest_stalled', ageHours: age / 3_600_000 },
  );
  await safe(() => store.set(K_STALL_ALERTED, '1'), log, 'set stallAlerted');
}

// One place where an alert becomes both a log line and a message. The
// log line is unconditional: if ALERT_CHAT_ID is unset, or Telegram is
// down, the finding still has to land somewhere durable.
async function fire(
  log: Log,
  notify: NonNullable<AlertDeps['notify']>,
  text: string,
  fields: Record<string, unknown>,
): Promise<void> {
  log.error(fields, text.split('\n')[0]);
  const sent = await notify(text, log);
  if (!sent && alertChatId() === null) {
    log.warn({ kind: 'alert_not_delivered' }, '[alert] ALERT_CHAT_ID unset — logged only');
  }
}
