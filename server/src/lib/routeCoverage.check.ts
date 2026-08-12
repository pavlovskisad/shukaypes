// Every route must carry a rate limit, or be named here as knowingly
// exempt. Run with: pnpm --filter @shukajpes/server check:route-coverage
//
// This exists because I already made the mistake it catches. The first
// pass at limiting routes went through the ones I could think of and
// missed six — including /state, which the client polls every five
// seconds, and /dogs/nearby, which haversines every active pet on every
// call. Nothing failed and nothing warned: `global: false` means a route
// without a config is simply unlimited, and an unlimited route is
// indistinguishable from a limited one until somebody abuses it.
//
// A grep over the source cannot do this reliably — the declarations span
// several lines in several shapes, which is exactly why a hand-written
// list missed some. So this asks Fastify what it actually registered.
//
// Adding a route now fails until somebody decides its ceiling. That
// decision may well be "none, because X" — write it into EXEMPT and the
// reason travels with the exemption.

import type { RouteObserver } from '../index.js';

// Routes deliberately without a limit, each with its reason.
const EXEMPT = new Map<string, string>([
  ['/health', 'Fly polls this every 30s to decide if the machine lives.'],
  ['/health/deep', 'The endpoint an uptime monitor is supposed to hammer.'],
  [
    '*',
    'CORS preflight, registered by @fastify/cors. Throttling OPTIONS would ' +
      'break real requests before they are even sent.',
  ],
]);

// Set BEFORE the server module is loaded, which is why the import of
// buildServer below is dynamic: ESM hoists static imports above every
// statement, so db/index.ts would run its `DATABASE_URL is required`
// throw before this line executed. Nothing connects — the postgres
// client is lazy and no query runs here.
process.env.DATABASE_URL ??= 'postgres://check:check@localhost:5432/check';

interface Seen {
  url: string;
  method: string;
  limited: boolean;
}

async function main() {
  const seen: Seen[] = [];
  const observe: RouteObserver = (r) => {
    const method = Array.isArray(r.method) ? r.method.join(',') : r.method;
    // HEAD is registered automatically alongside every GET and inherits
    // the same config; counting it would just double the output.
    if (method === 'HEAD') return;
    seen.push({ url: r.url, method, limited: r.hasRateLimit });
  };

  const { buildServer } = await import('../index.js');
  const app = await buildServer(observe);
  await app.close();

  if (seen.length === 0) {
    console.error('✗ no routes observed — the onRoute hook is not firing, so this check proves nothing');
    process.exit(1);
  }

  let failures = 0;
  for (const r of seen) {
    if (r.limited || EXEMPT.has(r.url)) continue;
    failures++;
    console.error(`✗ ${r.method.padEnd(6)} ${r.url} has no rate limit`);
  }

  const limited = seen.filter((r) => r.limited).length;
  const exempt = seen.filter((r) => !r.limited && EXEMPT.has(r.url)).length;

  if (failures === 0) {
    console.log(
      `✓ every route is rate limited (${seen.length} routes: ${limited} limited, ${exempt} knowingly exempt)`,
    );
  } else {
    console.error(
      `\n✗ ${failures} route(s) unlimited. Give each a tier from lib/rateLimit.ts,\n` +
        `  or add it to EXEMPT in this file along with the reason.`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
