import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');

// Pool size is written down rather than inherited. postgres-js defaults to
// ten connections, and every /sync/map spends several of its round trips
// on the spawn top-up, so under a launch-day burst the pool is the wall
// (open issue L-2). Ten is still the default — Supabase's session pooler
// has its own ceiling and a bigger local pool only moves the queue — but
// it is now an env knob, so it can be tuned on the live API without a
// code change. A missing or unparseable value falls back to ten, never
// to zero.
//
// connect_timeout bounds how long a fresh connection may sit in TCP/TLS
// before the query behind it fails; without it a database that stops
// answering SYNs (a pooler restart, a network blip) holds every caller
// for the OS default, which on Linux is over two minutes.
function poolMax(): number {
  const n = Number(process.env.PG_POOL_MAX);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 10;
}

// Disable prepared statements — Drizzle + some PgBouncer configs don't play well.
export const pg = postgres(url, {
  prepare: false,
  max: poolMax(),
  connect_timeout: 10,
});
export const db = drizzle(pg, { schema });
export { schema };
export type { StoredWaypoint, CachedPlace } from './schema.js';
