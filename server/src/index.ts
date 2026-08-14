import 'dotenv/config';
import { pathToFileURL } from 'url';
import Fastify from 'fastify';
import type { FastifyError } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import authPlugin from './auth.js';
import stateRoute from './routes/state.js';
import tokensRoute from './routes/tokens.js';
import foodRoute from './routes/food.js';
import dogsRoute from './routes/dogs.js';
import chatRoute from './routes/chat.js';
import adminRoute from './routes/admin.js';
import sightingsRoute from './routes/sightings.js';
import questsRoute from './routes/quests.js';
import statsRoute from './routes/stats.js';
import profileRoute from './routes/profile.js';
import pathRoute from './routes/path.js';
import syncMapRoute from './routes/syncMap.js';
import pokeRoute from './routes/poke.js';
import dailyTasksRoute from './routes/dailyTasks.js';
import loreRoute from './routes/lore.js';
import placesRoute from './routes/places.js';
import photosRoute from './routes/photos.js';
import clientErrorsRoute from './routes/clientErrors.js';
import devRoute from './routes/dev.js';
import adminMetricsRoute from './routes/adminMetrics.js';
import telegramRoute, { registerTelegramWebhook } from './routes/telegram.js';
import { startDecayCron } from './services/decay.js';
import { startWatchdog } from './services/watchdog.js';
import { warmGroundWorker } from './services/groundWorker.js';
import { startZoneExpansionCron } from './services/searchZoneExpansion.js';
import { runMemoryCleanupOnce } from './services/memoryCleanup.js';
import { startScrapeCron } from './services/scrape.js';
import { startLostDogCleanupCron } from './services/lostDogCleanup.js';
import { startMultiplayerCron } from './services/bots.js';
import { balance } from './config/balance.js';
import { pg } from './db/index.js';
import { redis } from './db/redis.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';

export interface RouteObserver {
  (route: { url: string; method: string | string[]; hasRateLimit: boolean }): void;
}

// `observe` is exported for the route-coverage check, which asks Fastify
// what it actually registered rather than grepping the source for it.
// The hook goes on before any route is added, and onRoute is inherited
// by the encapsulated plugin contexts below, so it sees all of them.
export async function buildServer(observe?: RouteObserver) {
  const app = Fastify({
    logger: {
      transport:
        process.env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
    // Behind Fly's proxy, the socket peer is the proxy — not the user.
    // Without this every request in the fleet shares one or two source
    // addresses, so an IP-keyed rate limit is a limit on the whole
    // world at once rather than on anybody in particular.
    trustProxy: true,
  });

  if (observe) {
    app.addHook('onRoute', (routeOptions) => {
      const cfg = routeOptions.config as { rateLimit?: unknown } | undefined;
      observe({
        url: routeOptions.url,
        method: routeOptions.method,
        hasRateLimit: cfg?.rateLimit != null,
      });
    });
  }

  await app.register(cors, { origin: true });
  await app.register(rateLimit, {
    global: false,
    max: balance.collectRateLimitPerMin,
    timeWindow: '1 minute',
    // MUST run at preHandler, not the plugin's default onRequest.
    //
    // req.userId is set by the auth plugin in a preHandler hook. The
    // rate limiter's default hook is onRequest, which runs BEFORE that
    // — so keyGenerator saw the decorator default (an empty string),
    // fell through to req.ip every single time, and with the proxy in
    // front that collapsed every user in the world into one bucket.
    //
    // The effect was not a loose limit, it was an inverted one: `max: 30`
    // on /chat meant thirty requests per minute TOTAL across all users,
    // so a handful of people talking to their dogs at once would 429
    // each other, and one abuser could lock everybody out. Moving the
    // hook is what makes every per-route number below mean what it says.
    hook: 'preHandler',
    keyGenerator: (req) => req.userId || req.ip,
  });

  app.get('/health', async () => ({ ok: true, ts: new Date().toISOString() }));

  app.get('/health/deep', async (_req, reply) => {
    const checks: Record<string, string> = {};
    try {
      await pg`select 1`;
      checks.db = 'ok';
    } catch (err) {
      checks.db = `fail: ${(err as Error).message}`;
    }
    try {
      if (redis.status !== 'ready') await redis.connect().catch(() => {});
      checks.redis = (await redis.ping()) === 'PONG' ? 'ok' : 'fail';
    } catch (err) {
      checks.redis = `fail: ${(err as Error).message}`;
    }
    const ok = Object.values(checks).every((v) => v === 'ok');
    reply.code(ok ? 200 : 503);
    return { ok, checks, ts: new Date().toISOString() };
  });

  // Never hand a database error to a client.
  //
  // Fastify's default handler serialises `err.message` into the response
  // body, and for anything that reaches here from Drizzle that message
  // is raw Postgres: constraint names, column names, sometimes the
  // offending value. That is free schema reconnaissance for anyone
  // poking at the API, and it is meaningless to the app besides.
  //
  // The full error still goes to the log, where it is useful.
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const status = err.statusCode ?? 500;
    // 4xx are deliberate — validation, rate limits, auth — and their
    // messages are written for the caller. Only mask the 5xx.
    if (status >= 500) {
      req.log.error({ err, url: req.url }, 'unhandled route error');
      reply.code(status);
      return { error: 'internal error' };
    }
    reply.code(status);
    return { error: err.message };
  });

  await app.register(authPlugin);
  await app.register(stateRoute);
  await app.register(tokensRoute);
  await app.register(foodRoute);
  await app.register(dogsRoute);
  await app.register(chatRoute);
  await app.register(adminRoute);
  await app.register(sightingsRoute);
  await app.register(questsRoute);
  await app.register(statsRoute);
  await app.register(profileRoute);
  await app.register(pathRoute);
  await app.register(syncMapRoute);
  await app.register(pokeRoute);
  await app.register(dailyTasksRoute);
  await app.register(loreRoute);
  await app.register(placesRoute);
  await app.register(photosRoute);
  await app.register(clientErrorsRoute);
  await app.register(devRoute);
  await app.register(adminMetricsRoute);
  await app.register(telegramRoute);

  return app;
}

async function main() {
  const app = await buildServer();

  // A rejected promise nobody awaited should not take the server down.
  //
  // Node's default for an unhandled rejection is to crash the process,
  // and this file alone launches several deliberately unawaited jobs —
  // the memory cleanup, the Telegram webhook registration — with more
  // inside chat and the crons. The watchdog cannot help here: it catches
  // a wedged event loop, not a clean exit.
  //
  // Logged loudly rather than swallowed. A restart loop is easier to
  // diagnose than a silent outage, but a restart on a background job's
  // failed fetch is not a trade worth making.
  process.on('unhandledRejection', (reason) => {
    app.log.error({ err: reason, kind: 'unhandled_rejection' }, 'unhandled promise rejection');
  });

  // An uncaught exception leaves the process in an unknown state, so
  // this one does NOT keep running: it logs, then lets Fly restart into
  // a clean boot. The log line is the point — the default is a stack
  // trace on stderr with no context and no `kind` to grep for.
  process.on('uncaughtException', (err) => {
    app.log.error({ err, kind: 'uncaught_exception' }, 'uncaught exception — exiting for restart');
    process.exit(1);
  });

  // Eagerly connect Redis at boot (it's lazyConnect). This keeps the DB
  // actually in use — an idle free-tier Redis gets reaped by the provider —
  // and makes the `redis.status === 'ready'` guards throughout the code
  // reliable (they'd otherwise skip forever if nothing ever connected). A
  // failure here is non-fatal: everything degrades gracefully without Redis.
  if (redis.status === 'wait') {
    redis
      .connect()
      .catch((err) => app.log.warn({ err }, '[redis] initial connect failed; will retry lazily'));
  }
  // Boot-seed dropped — pilot now runs on real scraped pets only.
  // The seedLostDogs() CLI in db/seed-dogs.ts still works for local dev.

  // First thing armed, last thing stood down: everything below this line
  // is something that could hang, and a hang is what took the server out
  // for eleven hours on 2026-08-05. See services/watchdog.ts.
  const stopWatchdog = startWatchdog();
  // Pay the worker's spawn cost here rather than inside the first claim's
  // transaction, where it would be held under the advisory locks.
  warmGroundWorker();

  const stopDecay = startDecayCron(app.log);
  const stopScrape = startScrapeCron(app.log);
  const stopZoneExpansion = startZoneExpansionCron(app.log);
  const stopLostDogCleanup = startLostDogCleanupCron(app.log);
  // Multiplayer presence maintenance: purge stale walkers, and (if
  // MULTIPLAYER_BOTS>0) step + publish the bot walkers that populate the
  // presence set. Purge-only when no bots, so real presence still works.
  const stopMultiplayer = startMultiplayerCron(
    app.log,
    Number(process.env.MULTIPLAYER_BOTS ?? 0) || 0,
  );
  // One-shot retrofit: strip transcript prefixes from any existing
  // memory notes written before PR #158 added the filter to new
  // writes. Fire-and-forget so it doesn't delay listen().
  void runMemoryCleanupOnce(app.log);
  // Register the Telegram webhook every boot — idempotent on TG's
  // side, makes the bot's subscription survive Fly rolling deploys.
  // TELEGRAM_PUBLIC_URL is set to the canonical fly.dev host; falls
  // back to a sensible default.
  const publicUrl = process.env.TELEGRAM_PUBLIC_URL ?? 'https://shukajpes-api.fly.dev';
  void registerTelegramWebhook(publicUrl, app.log);
  try {
    await app.listen({ port: PORT, host: HOST });
  } catch (err) {
    app.log.error(err);
    stopDecay();
    stopScrape();
    stopZoneExpansion();
    stopLostDogCleanup();
    stopMultiplayer();
    stopWatchdog();
    process.exit(1);
  }

  const shutdown = async () => {
    stopDecay();
    stopScrape();
    stopLostDogCleanup();
    stopZoneExpansion();
    stopMultiplayer();
    // The watchdog stays armed THROUGH app.close(), and is only stood down
    // once we know we got past it. A close that hangs is the same outage
    // as any other hang — the machine stays up, unreachable, looking fine.
    // Better it gets killed and restarted.
    await app.close();
    stopWatchdog();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Only boot when run directly. Without this, importing buildServer from
// a check or a script would start the whole server — crons, bots,
// watchdog and all — as a side effect of the import.
const isEntry = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isEntry) main();
