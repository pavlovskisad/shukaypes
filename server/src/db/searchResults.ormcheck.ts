// Inserts through the REAL Drizzle schema rather than hand-written SQL.
// Catches a column named one thing in schema.ts and another in the
// migration — a mismatch that typechecks fine and fails at runtime, on the
// one write path that records whether anybody searched.
//
// NOT part of `pnpm check`: it needs a live database, and every check in
// that suite is deliberately pure so it runs in CI with no credentials.
// Point DATABASE_URL at a throwaway Postgres and run it by hand.

// REFUSES TO RUN ANYWHERE BUT A LOCAL DATABASE, and the refusal is the
// most important line in the file. This script inserts a fake pet and a
// fake user to satisfy the foreign keys. Pointed at production by a stale
// DATABASE_URL in a shell — which is exactly how it would happen — it
// would put a pet nobody lost into the table the app reads. The check is
// on the connection string rather than on a flag, because a flag is
// something you forget and a hostname is something you cannot.
import { db, pg, schema } from './index.js';

const url = process.env.DATABASE_URL ?? '';
const host = (() => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
})();
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  // Print the host and nothing else — never the credentials in the URL.
  console.error(`refusing to run against host "${host || '(unparseable)'}" — local only`);
  process.exit(1);
}

const DOG = 'ormcheck-dog';
const USER = 'ormcheck-user';

await pg`insert into lost_dogs (id) values (${DOG}) on conflict do nothing`;
await pg`insert into users (id) values (${USER}) on conflict do nothing`;

await db.insert(schema.searchResults).values({
  id: 'ormcheck-found',
  dogId: DOG,
  userId: USER,
  seen: true,
  paws: 20,
  lat: 50.45,
  lng: 30.52,
});

// The answer that had nowhere to go before this table existed.
await db.insert(schema.searchResults).values({
  id: 'ormcheck-empty',
  dogId: DOG,
  userId: USER,
  seen: false,
  paws: 10,
  lat: null,
  lng: null,
});

const rows = await db.select().from(schema.searchResults);
for (const r of rows) {
  console.log(
    `${r.id} seen=${r.seen} paws=${r.paws} lat=${r.lat ?? 'null'} ts=${r.createdAt ? 'set' : 'MISSING'}`,
  );
}
console.log(`rows: ${rows.length}`);
await pg.end();
