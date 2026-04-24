// Hourly scrape cron. Runs every source in sequence so failures in one
// don't starve another. We jitter the initial run 30–120s after boot to
// avoid a thundering herd on deploy, and skip entirely if ANTHROPIC_API_KEY
// is missing (the parser would throw anyway).
//
// Multi-machine Fly note: with min_machines_running=1 there is usually one
// instance, so no leader election. If we scale beyond that, move to a
// redis-based lock — not needed yet.

import type { FastifyBaseLogger } from 'fastify';
import { OlxSource } from '../pipeline/sources/olx.js';
import { TelegramSource } from '../pipeline/sources/telegram.js';
import type { Source, SourceRunSummary } from '../pipeline/source.js';

const INTERVAL_MS = 60 * 60 * 1000; // 1h
const INITIAL_DELAY_MIN_MS = 30_000;
const INITIAL_DELAY_MAX_MS = 120_000;

function sources(): Source[] {
  // Telegram is env-gated: when TELEGRAM_CHANNELS is empty it's a
  // cheap no-op (returns on first line of runOnce), so it's safe to
  // register unconditionally. Shelter-registry sources slot in here
  // next.
  return [new OlxSource(), new TelegramSource()];
}

export async function runAllSources(log: Pick<FastifyBaseLogger, 'info' | 'warn'>): Promise<SourceRunSummary[]> {
  const results: SourceRunSummary[] = [];
  for (const s of sources()) {
    try {
      const summary = await s.runOnce();
      log.info({ kind: 'scrape_tick', ...summary }, `[${s.name}] tick complete`);
      results.push(summary);
    } catch (err) {
      log.warn({ kind: 'scrape_tick_failed', source: s.name, err: (err as Error).message }, 'scrape source failed');
    }
  }
  return results;
}

export function startScrapeCron(log: Pick<FastifyBaseLogger, 'info' | 'warn'>): () => void {
  if (!process.env.ANTHROPIC_API_KEY) {
    log.warn('[scrape] ANTHROPIC_API_KEY missing — scrape cron disabled');
    return () => {};
  }

  let interval: NodeJS.Timeout | null = null;
  const initialDelay = INITIAL_DELAY_MIN_MS + Math.random() * (INITIAL_DELAY_MAX_MS - INITIAL_DELAY_MIN_MS);

  const startTimeout = setTimeout(() => {
    runAllSources(log).catch((err) => log.warn({ err: (err as Error).message }, '[scrape] initial run errored'));
    interval = setInterval(() => {
      runAllSources(log).catch((err) => log.warn({ err: (err as Error).message }, '[scrape] tick errored'));
    }, INTERVAL_MS);
    interval.unref?.();
  }, initialDelay);
  startTimeout.unref?.();

  return () => {
    clearTimeout(startTimeout);
    if (interval) clearInterval(interval);
  };
}
