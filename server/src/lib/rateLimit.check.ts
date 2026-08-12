// Proves the rate limiter counts per user, not per everybody.
// Run with: pnpm --filter @shukajpes/server check:rate-limit
//
// This check exists because the bug it guards was invisible and
// inverted. @fastify/rate-limit installs at `onRequest` by default;
// the auth plugin sets `req.userId` at `preHandler`, which runs later.
// So `keyGenerator: (req) => req.userId || req.ip` never saw a userId,
// fell through to `req.ip`, and — behind Fly's proxy, with `trustProxy`
// unset — every user in the world shared one bucket. `max: 30` on /chat
// was thirty requests per minute for the entire service.
//
// Nothing about that is visible in a code review of the keyGenerator,
// which reads exactly right. It only shows up if you run it, so this
// runs it: a real Fastify instance with the same hook wiring as
// index.ts, no database, no network, no production.

import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';

declare module 'fastify' {
  interface FastifyRequest {
    checkUserId?: string;
  }
}

const MAX = 2;

async function build() {
  const app = Fastify();

  // Mirrors index.ts. Included because the error handler sits in front
  // of the limiter's 429s, and a handler that swallowed or rewrote them
  // into a 500 would turn "you are going too fast" into "the server is
  // broken" — while every status assertion below still passed if the
  // handler were absent from this harness.
  app.setErrorHandler((err: { statusCode?: number; message: string }, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      reply.code(status);
      return { error: 'internal error' };
    }
    reply.code(status);
    return { error: err.message };
  });

  await app.register(rateLimit, {
    global: false,
    max: MAX,
    timeWindow: '1 minute',
    // The two lines under test.
    hook: 'preHandler',
    keyGenerator: (req) => req.checkUserId || req.ip,
  });

  // Stands in for auth.ts: a GLOBAL preHandler that resolves identity.
  // Fastify runs instance-level hooks before route-level ones, which is
  // the ordering the fix depends on — if that ever changes, this check
  // fails rather than the production limiter silently going global.
  app.addHook('preHandler', async (req) => {
    const header = req.headers['x-device-id'];
    req.checkUserId = Array.isArray(header) ? header[0] : header;
  });

  app.get('/limited', { config: { rateLimit: { max: MAX, timeWindow: '1 minute' } } }, async () => ({
    ok: true,
  }));

  await app.ready();
  return app;
}

async function hit(app: Awaited<ReturnType<typeof build>>, deviceId: string): Promise<number> {
  const res = await app.inject({
    method: 'GET',
    url: '/limited',
    headers: { 'x-device-id': deviceId },
  });
  return res.statusCode;
}

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    failures++;
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  const app = await build();

  // Alice spends her whole budget.
  const alice = [await hit(app, 'alice'), await hit(app, 'alice'), await hit(app, 'alice')];
  check('first request allowed', alice[0] === 200, `got ${alice[0]}`);
  check('second request allowed', alice[1] === 200, `got ${alice[1]}`);
  check('third request refused', alice[2] === 429, `got ${alice[2]}`);

  // THE ACTUAL POINT: Bob must be unaffected by Alice exhausting hers.
  // Before the fix this returned 429 — one bucket for everyone.
  const bob = await hit(app, 'bob');
  check('a different user still has their own budget', bob === 200, `got ${bob}`);

  // And Bob's budget is his own size, not the remainder of Alice's.
  const bob2 = await hit(app, 'bob');
  const bob3 = await hit(app, 'bob');
  check('second user gets a full budget', bob2 === 200, `got ${bob2}`);
  check('second user is refused after their own limit', bob3 === 429, `got ${bob3}`);

  await app.close();

  if (failures === 0) {
    console.log('✓ rate limiting is per-user, not global');
  } else {
    console.error(`\n✗ ${failures} case(s) failed`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
