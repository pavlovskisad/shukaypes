// Tiny wrapper for cron ticks that adds timing + structured logging.
// Replaces the previous `console.error` ad-hoc handlers in decay.ts /
// searchZoneExpansion.ts so per-tick durations + errors flow through
// Fastify's pino logger and into Fly's log aggregation.
//
// Logs at debug level on success (kept quiet by default — pin to
// `info` in development if you want every tick) and `error` on
// failure, with the cron name + duration_ms tag for easy grepping.

import type { FastifyBaseLogger } from 'fastify';

interface CronLogger {
  info: FastifyBaseLogger['info'];
  warn: FastifyBaseLogger['warn'];
  error: FastifyBaseLogger['error'];
  debug?: FastifyBaseLogger['debug'];
}

export async function runCronTick(
  name: string,
  fn: () => Promise<void>,
  log: CronLogger,
): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    const durationMs = Date.now() - start;
    // Tick durations are usually ms-scale and uninteresting; only log
    // at info if the tick took longer than a sensible threshold (1s),
    // which signals the DB is under pressure or a query plan flipped.
    if (durationMs >= 1000) {
      log.warn({ kind: 'cron_slow', name, durationMs }, `cron tick ${name} took ${durationMs}ms`);
    } else {
      log.debug?.({ kind: 'cron_tick', name, durationMs }, `cron tick ${name}`);
    }
  } catch (err) {
    const durationMs = Date.now() - start;
    log.error({ kind: 'cron_error', name, durationMs, err }, `cron tick ${name} failed`);
  }
}
