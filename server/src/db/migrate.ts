import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql);

  // Ensure PostGIS is available before running Drizzle migrations.
  await sql`CREATE EXTENSION IF NOT EXISTS postgis`;

  await migrate(db, { migrationsFolder: './migrations' });
  console.log('migrations applied.');
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
