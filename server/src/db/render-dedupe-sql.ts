// Renders the dedupe candidate query without touching a database.
//
// This exists because a raw `sql` fragment in drizzle renders an
// interpolated COLUMN unqualified — `${schema.scrapeLog.dogId} =
// ${schema.lostDogs.id}` once came out as `"dog_id" = "id"` and was
// silently wrong for months. The candidate query interpolates a
// distance expression into both WHERE and ORDER BY, so it is exactly
// the shape that goes wrong quietly.
//
// Needs no connection: DATABASE_URL only has to parse.
//
//   DATABASE_URL=postgres://u:p@localhost:5432/x \
//     pnpm --filter @shukajpes/server render:dedupe-sql

import 'dotenv/config';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema, pg } from './index.js';
import { DEDUPE_RADIUS_M } from '../pipeline/samePet.js';

const lat = 50.4501;
const lng = 30.5234;

// Kept character-for-character in step with upsert.ts.
const distExpr = sql<number>`(6371000 * acos(cos(radians(${lat})) * cos(radians(last_seen_lat)) * cos(radians(last_seen_lng) - radians(${lng})) + sin(radians(${lat})) * sin(radians(last_seen_lat))))`;

const query = db
  .select({
    id: schema.lostDogs.id,
    name: schema.lostDogs.name,
    species: schema.lostDogs.species,
    breed: schema.lostDogs.breed,
    lastSeenAt: schema.lostDogs.lastSeenAt,
    source: schema.lostDogs.source,
    dist: distExpr,
  })
  .from(schema.lostDogs)
  .where(and(eq(schema.lostDogs.status, 'active'), sql`${distExpr} < ${DEDUPE_RADIUS_M}`))
  .orderBy(distExpr, schema.lostDogs.id)
  .limit(20);

const { sql: text, params } = query.toSQL();
console.log(text);
console.log('\nparams:', JSON.stringify(params));

// The thing to eyeball: every column inside the distance expression is
// a real lost_dogs column, and ORDER BY carries the expression rather
// than a bare name that Postgres would resolve to something else.
const orderBy = text.slice(text.indexOf('order by'));
console.log('\norder by clause:\n ', orderBy.slice(0, 220));

await pg.end();
