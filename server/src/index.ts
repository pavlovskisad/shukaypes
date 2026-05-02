import 'dotenv/config';
import Fastify from 'fastify';
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
import { startDecayCron } from './services/decay.js';
import { startZoneExpansionCron } from './services/searchZoneExpansion.js';
import { runMemoryCleanupOnce } from './services/memoryCleanup.js';
import { startScrapeCron } from './services/scrape.js';
import { balance } from './config/balance.js';
import { pg } from './db/index.js';
import { redis } from './db/redis.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';

async function buildServer() {
  const app = Fastify({
    logger: {
      transport:
        process.env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
  });

  await app.register(cors, { origin: true });
  await app.register(rateLimit, {
    global: false,
    max: balance.collectRateLimitPerMin,
    timeWindow: '1 minute',
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

  return app;
}

async function main() {
  const app = await buildServer();
  // Boot-seed dropped — pilot now runs on real scraped pets only.
  // The seedLostDogs() CLI in db/seed-dogs.ts still works for local dev.
  const stopDecay = startDecayCron(app.log);
  const stopScrape = startScrapeCron(app.log);
  const stopZoneExpansion = startZoneExpansionCron(app.log);
  // One-shot retrofit: strip transcript prefixes from any existing
  // memory notes written before PR #158 added the filter to new
  // writes. Fire-and-forget so it doesn't delay listen().
  void runMemoryCleanupOnce(app.log);
  try {
    await app.listen({ port: PORT, host: HOST });
  } catch (err) {
    app.log.error(err);
    stopDecay();
    stopScrape();
    stopZoneExpansion();
    process.exit(1);
  }

  const shutdown = async () => {
    stopDecay();
    stopScrape();
    stopZoneExpansion();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
