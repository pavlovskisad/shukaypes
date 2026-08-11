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
import { evaluateIngestHealth } from './ingestAlert.js';
import { scrapeProxyDescription } from '../lib/scrapeFetch.js';

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

export async function runAllSources(log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>): Promise<SourceRunSummary[]> {
  const results: SourceRunSummary[] = [];
  for (const s of sources()) {
    try {
      const summary = await s.runOnce();
      // "tick complete" at info level was how a source being 403'd off
      // the internet came to look like a healthy run. OLX sits behind
      // CloudFront's WAF, which blocks datacentre IPs; every listing and
      // every ad fetch failed, and the tick still logged as complete
      // with the errors folded into a field nobody greps for.
      //
      // A tick that discovered things but ingested none of them, or that
      // recorded errors at all, is not a complete tick. Say so at a
      // level that shows up.
      const nothingLanded =
        summary.discovered > 0 && summary.parsed === 0 && summary.errors > 0;
      if (nothingLanded) {
        log.error(
          { kind: 'scrape_tick', ...summary },
          `[${s.name}] tick INGESTED NOTHING — ${summary.errors} error(s), source may be blocked`,
        );
      } else if (summary.errors > 0) {
        log.warn(
          { kind: 'scrape_tick', ...summary },
          `[${s.name}] tick complete with ${summary.errors} error(s)`,
        );
      } else {
        log.info({ kind: 'scrape_tick', ...summary }, `[${s.name}] tick complete`);
      }
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

export function startScrapeCron(log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>): () => void {
  if (!process.env.ANTHROPIC_API_KEY) {
    log.warn('[scrape] ANTHROPIC_API_KEY missing — scrape cron disabled');
    return () => {};
  }

  // Say at boot which way scrape traffic leaves the box. Whether the
  // proxy is actually in use is the first question anyone will ask when
  // the 403s do or don't stop, and "is the env var set on this machine"
  // should not require an SSH session to answer. Host only — the URL
  // carries credentials.
  log.info(`[scrape] outbound: ${scrapeProxyDescription()}`);

  let interval: NodeJS.Timeout | null = null;
  const initialDelay = INITIAL_DELAY_MIN_MS + Math.random() * (INITIAL_DELAY_MAX_MS - INITIAL_DELAY_MIN_MS);

  // Health evaluation hangs off the CRON path only, not off
  // runAllSources itself — the admin route calls that too, and a human
  // triggering a run by hand is already watching. Letting a manual run
  // feed the streak counters would let three impatient clicks report a
  // source as blocked.
  const tick = (label: string) =>
    runAllSources(log)
      .then((summaries) => evaluateIngestHealth(summaries, log))
      .catch((err) => log.warn({ err: (err as Error).message }, `[scrape] ${label} errored`));

  const startTimeout = setTimeout(() => {
    void tick('initial run');
    interval = setInterval(() => {
      void tick('tick');
    }, INTERVAL_MS);
    interval.unref?.();
  }, initialDelay);
  startTimeout.unref?.();

  return () => {
    clearTimeout(startTimeout);
    if (interval) clearInterval(interval);
  };
}
