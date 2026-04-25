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
import { FacebookSource } from '../pipeline/sources/facebook.js';
import type { Source, SourceRunSummary } from '../pipeline/source.js';
import { recordTick } from './scrape-history.js';

const INTERVAL_MS = 60 * 60 * 1000; // 1h
const INITIAL_DELAY_MIN_MS = 30_000;
const INITIAL_DELAY_MAX_MS = 120_000;

function sources(): Source[] {
  // Telegram is env-gated (TELEGRAM_CHANNELS); empty = no-op.
  // Facebook ships with two seed group IDs hard-coded as defaults
  // and override via FACEBOOK_GROUP_IDS — also a cheap no-op when
  // the bridge can't reach the groups. Shelter-registry sources
  // slot in here next.
  return [new OlxSource(), new TelegramSource(), new FacebookSource()];
}

export async function runAllSources(log: Pick<FastifyBaseLogger, 'info' | 'warn'>): Promise<SourceRunSummary[]> {
  const results: SourceRunSummary[] = [];
  for (const s of sources()) {
    try {
      const summary = await s.runOnce();
      log.info({ kind: 'scrape_tick', ...summary }, `[${s.name}] tick complete`);
      recordTick(summary);
      results.push(summary);
    } catch (err) {
      log.warn({ kind: 'scrape_tick_failed', source: s.name, err: (err as Error).message }, 'scrape source failed');
      // Record a synthetic failed tick so /stats can show source ran
      // and threw, instead of silently absent. errors=1 + a single
      // errorMessage carrying the throw.
      recordTick({
        source: s.name,
        discovered: 0,
        skipped: 0,
        parsed: 0,
        inserted: 0,
        updated: 0,
        duplicate: 0,
        errors: 1,
        errorMessages: [(err as Error).message.slice(0, 200)],
      });
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
