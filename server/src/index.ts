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
import { startDecayCron } from './services/decay.js';
import { startScrapeCron } from './services/scrape.js';
import { balance } from './config/balance.js';
import { pg } from './db/index.js';
import { redis } from './db/redis.js';
import { seedOnBootIfEmpty } from './db/seed-dogs.js';

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

  return app;
}

async function main() {
  const app = await buildServer();
  await seedOnBootIfEmpty(app.log);
  const stopDecay = startDecayCron();
  const stopScrape = startScrapeCron(app.log);
  try {
    await app.listen({ port: PORT, host: HOST });
  } catch (err) {
    app.log.error(err);
    stopDecay();
    stopScrape();
    process.exit(1);
  }

  const shutdown = async () => {
    stopDecay();
    stopScrape();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
