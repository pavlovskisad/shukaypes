// Wipe every human account, for the fresh start the door ships with.
//
// The owner's call (12 Sep): there are no real users yet, so instead of
// carrying ~543 anonymous device-id rows across the door, the table is
// emptied once the door is live and everybody registers fresh. This is
// the one tool that does it, and it is built the way CLAUDE.md asks:
// dry by default, `--apply` explicit, and the dry run prints exactly
// what the apply would do — counts for every table that hangs off
// `users`, and the rows themselves with `--list`.
//
// WHAT GOES. Every row in `users` except the multiplayer bots
// (`bot:N`), and by cascade everything that is THEIRS: companion state,
// paws, bones, collect events, chat messages and memory, quests, daily
// tasks, territory marks / ground / raids, hearted landmarks, invite
// redemptions, account tokens and logins. Bots are kept so the map is
// not empty on day one; they are re-seeded at boot anyway.
//
// WHAT STAYS. The pet table and the sightings table are NOT the users'
// — `lost_dogs.reported_by`, `sightings.reporter_id` and
// `search_results.user_id` are ON DELETE SET NULL, so a pet an owner
// posted from the app keeps its pin, its photo and its ad text, and a
// sighting keeps its position; only the link to who posted it goes.
// The dry run prints how many such rows will lose their reporter. That
// link is the one thing here that cannot be put back, which is why the
// rows are listed before anything is written.
//
// NOT REVERSIBLE. There is no undo; the free-tier database has no
// point-in-time recovery. `--snapshot=<path>` writes the users rows
// (without password hashes) to a JSON file before the delete, as the
// cheapest possible insurance.
//
// Usage:
//   dry run:     pnpm --filter @shukajpes/server wipe:users
//   list rows:   pnpm --filter @shukajpes/server wipe:users --list
//   apply:       pnpm --filter @shukajpes/server wipe:users --apply [--snapshot=users.json]
//   production:  fly ssh console -a shukajpes-api -C "node dist/db/wipe-users.js"
//                …read it, then the same with --apply.

import 'dotenv/config';
import fs from 'fs';
import { sql } from 'drizzle-orm';
import { pathToFileURL } from 'url';
import { db, pg } from './index.js';

const BOT_PREFIX = 'bot:';

async function count(query: ReturnType<typeof sql>): Promise<number> {
  const rows = (await db.execute(query)) as unknown as Array<{ n: number | string }>;
  return Number(rows[0]?.n ?? 0);
}

interface UserRow {
  id: string;
  device_id: string;
  username: string;
  telegram_id: number | null;
  email: string | null;
  registered_at: string | null;
  points: number;
  created_at: string;
  last_seen_at: string;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const list = process.argv.includes('--list');
  const snapshotArg = process.argv.find((a) => a.startsWith('--snapshot='));
  const snapshot = snapshotArg ? snapshotArg.slice('--snapshot='.length) : null;
  console.log(apply ? '▶ APPLY — writes are real and NOT reversible' : '▶ dry run — pass --apply to write');

  const human = sql`id not like ${BOT_PREFIX + '%'}`;
  const bots = await count(sql`select count(*)::int as n from users where id like ${BOT_PREFIX + '%'}`);
  const total = await count(sql`select count(*)::int as n from users where ${human}`);
  const telegram = await count(sql`select count(*)::int as n from users where ${human} and telegram_id is not null`);
  const registered = await count(sql`select count(*)::int as n from users where ${human} and registered_at is not null`);
  const active7d = await count(
    sql`select count(*)::int as n from users where ${human} and last_seen_at > now() - interval '7 days'`,
  );

  console.log(`\nusers to delete: ${total}  (telegram ${telegram}, device ${total - telegram}; registered ${registered}; seen in last 7d ${active7d})`);
  console.log(`bots kept:       ${bots}`);

  // What cascades with them.
  const cascades: Array<[string, string]> = [
    ['companion_state', 'user_id'],
    ['tokens', 'owner_id'],
    ['food_items', 'owner_id'],
    ['collect_events', 'user_id'],
    ['messages', 'user_id'],
    ['quests', 'user_id'],
    ['daily_tasks', 'user_id'],
    ['territory_marks', 'user_id'],
    ['territory_ground', 'user_id'],
    ['territory_raids', 'victim_id'],
    ['lore_favourites', 'user_id'],
    ['invite_redemptions', 'user_id'],
    ['auth_tokens', 'user_id'],
    ['auth_sessions', 'user_id'],
  ];
  console.log('\ncascade (deleted with their owner):');
  for (const [table, col] of cascades) {
    const n = await count(
      sql`select count(*)::int as n from ${sql.identifier(table)} where ${sql.identifier(col)} in (select id from users where ${human})`,
    );
    console.log(`  ${table.padEnd(20)} ${n}`);
  }

  // What stays, minus its link to a person.
  const setNull: Array<[string, string, string]> = [
    ['lost_dogs', 'reported_by', 'pets keep pin, photo, ad text; lose who posted them'],
    ['sightings', 'reporter_id', 'sightings keep position and time; lose who saw'],
    ['search_results', 'user_id', 'searches keep their verdict and paws; lose who walked'],
  ];
  console.log('\nset null (rows stay, link to the account goes — this part cannot be undone):');
  for (const [table, col, note] of setNull) {
    const n = await count(
      sql`select count(*)::int as n from ${sql.identifier(table)} where ${sql.identifier(col)} in (select id from users where ${human})`,
    );
    console.log(`  ${table.padEnd(20)} ${String(n).padEnd(6)} ${note}`);
  }

  const rows = (await db.execute(sql`
    select id, device_id, username, telegram_id, email, registered_at, points, created_at, last_seen_at
    from users where ${human} order by created_at
  `)) as unknown as UserRow[];

  if (list) {
    console.log('\nrows:');
    for (const r of rows) {
      const who = r.telegram_id ? `tg:${r.telegram_id}` : r.device_id.slice(0, 10) + '…';
      console.log(
        `  ${r.id}  ${who.padEnd(16)} ${r.username.padEnd(20)} ${r.email ?? '-'}  pts ${r.points}  seen ${String(r.last_seen_at).slice(0, 10)}`,
      );
    }
  }

  if (registered > 0) {
    console.log(
      `\n⚠ ${registered} account(s) have already REGISTERED through the door. This wipe deletes them too. ` +
        'If the door is already live for real people, stop and think before --apply.',
    );
  }

  if (!apply) {
    console.log('\n✓ dry run, nothing written.');
    return;
  }

  if (snapshot) {
    fs.writeFileSync(snapshot, JSON.stringify(rows, null, 2));
    console.log(`\nsnapshot of ${rows.length} users → ${snapshot}`);
  }

  const deleted = (await db.execute(sql`delete from users where ${human} returning id`)) as unknown as unknown[];
  console.log(`\ndeleted ${deleted.length} users (cascades and set-nulls applied by the database).`);
  const left = await count(sql`select count(*)::int as n from users`);
  console.log(`users now: ${left} (bots)`);
  console.log('✓ done. Every device that opens the app is a new account at the door.');
}

const isEntry = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isEntry) {
  main()
    .then(() => pg.end())
    .catch((err) => {
      console.error(err);
      pg.end().finally(() => process.exit(1));
    });
}
