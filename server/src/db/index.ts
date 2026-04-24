import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');

// Disable prepared statements — Drizzle + some PgBouncer configs don't play well.
export const pg = postgres(url, { prepare: false });
export const db = drizzle(pg, { schema });
export { schema };
export type { StoredWaypoint } from './schema.js';
