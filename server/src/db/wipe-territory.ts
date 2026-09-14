// Wipe the territory layer, for a fresh city — and, with --progress,
// the happiness index that was measured under the old rhythm.
//
// The owner's call (14 Sep, D-78): thirty bots on the map twenty-two
// hours a day for weeks had taken every street in the centre, and the
// picture the bigger pool on an owner's hours (D-77) is meant to give —
// a city being claimed at a human pace — cannot be seen on ground that
// is already all somebody's. So the ground goes, once, and the bots walk
// it back from nothing on the new rhythm.
//
// Built the way CLAUDE.md asks: dry by default, `--apply` explicit, and
// the dry run prints exactly what the apply would do.
//
// WHAT GOES. For the chosen owners: their marks (`territory_marks`),
// their ground (`territory_ground`), the raids on them
// (`territory_raids`), and on their companion row the last-mark spacing
// (`last_mark_*`) and the home-ground flag — so the first mark after
// the wipe is not refused for being too close to a mark that no longer
// exists. Nothing else: points, XP, levels, bones, the happiness index
// are progression, not territory, and stay.
//
// WHOSE. Bots (`bot:N`) by default — they are what filled the map.
// `--all` includes people's ground too; the dry run prints both cohorts
// either way so the choice is made with the numbers in view.
//
// --progress ALSO RESETS THE HAPPINESS INDEX (D-79). The owner, after
// the first wipe: "hapines didnt wipe i think". Correct, and on purpose
// — territory is not progression. But the index (D-75) is an all-time
// time-weighted average, and every counted hour the bots hold was
// measured under the old round-the-clock regime (D-76 → D-77), when a
// dog was never left alone long enough to get hungry. Those hours are
// not a picture of the game as it is now played, and the ninety new
// bots have none at all, so the board starts crooked either way. With
// the flag the chosen owners' `happy_weight_s` and `active_s` go to
// zero and their meters go back to the starting hunger and happiness,
// with the decay clock reset so nothing catches up in one tick.
// Everything else — XP, level, points, bones collected — is untouched;
// `wipe:stats` is the tool for those.
//
// NOT REVERSIBLE. There is no undo and the free-tier database has no
// point-in-time recovery. `--snapshot=<path>` writes the ground and mark
// rows to a JSON file before the delete, as the cheapest insurance.
//
// Usage:
//   pnpm wipe:territory                       dry run, bots
//   pnpm wipe:territory --all                 dry run, everyone
//   pnpm wipe:territory --apply               wipe the bots' territory
//   pnpm wipe:territory --progress --apply    …and their happiness index
//   pnpm wipe:territory --all --apply --snapshot=/tmp/territory.json
//   production: fly ssh console -a shukajpes-api -C "node dist/db/wipe-territory.js [--apply]"

import 'dotenv/config';
import fs from 'node:fs';
import { sql } from 'drizzle-orm';
import { db, pg } from './index.js';
import { balance } from '../config/balance.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const all = args.includes('--all');
const progress = args.includes('--progress');
const snapshot = args.find((a) => a.startsWith('--snapshot='))?.slice('--snapshot='.length);

// Whose rows go. Bots are the `bot:N` users; `--all` is everybody.
const chosen = all ? sql`true` : sql`user_id like 'bot:%'`;

async function count(q: ReturnType<typeof sql>): Promise<number> {
  const r = (await db.execute(q)) as unknown as Array<{ n: number }>;
  return r[0]?.n ?? 0;
}

async function cohort(label: string, who: ReturnType<typeof sql>) {
  const marks = await count(sql`select count(*)::int as n from territory_marks where ${who}`);
  const ground = await count(sql`select count(*)::int as n from territory_ground where ${who}`);
  const holders = await count(sql`select count(distinct user_id)::int as n from territory_ground where ${who}`);
  const area = await count(sql`select coalesce(sum(area_m2), 0)::int as n from territory_ground where ${who}`);
  const raids = await count(
    sql`select count(*)::int as n from territory_raids where ${sql.raw(all ? 'true' : "victim_id like 'bot:%'")}`,
  );
  console.log(
    `  ${label.padEnd(7)} ${String(marks).padStart(6)} marks  ${String(ground).padStart(5)} ground pieces  ${String(holders).padStart(4)} holders  ${(area / 1e6).toFixed(2).padStart(7)} km²  ${String(raids).padStart(5)} raids`,
  );
  return { marks, ground, holders, area, raids };
}

async function main() {
  console.log(
    `▶ territory wipe — ${apply ? 'APPLY' : 'dry run'} — ${all ? 'EVERYONE' : 'bots only'}${progress ? ' — AND the happiness index' : ''}`,
  );
  console.log('\nwhat is held now:');
  const bots = await cohort('bots', sql`user_id like 'bot:%'`);
  const people = await cohort('people', sql`user_id not like 'bot:%'`);

  const top = (await db.execute(sql`
    select g.user_id, coalesce(u.username, g.user_id) as name, round(sum(g.area_m2))::int as area_m2, count(*)::int as pieces
    from territory_ground g left join users u on u.id = g.user_id
    group by g.user_id, u.username order by sum(g.area_m2) desc limit 8
  `)) as unknown as Array<{ user_id: string; name: string; area_m2: number; pieces: number }>;
  console.log('\nbiggest holders:');
  for (const t of top) {
    console.log(`  ${t.user_id.padEnd(14)} ${t.name.padEnd(14)} ${(t.area_m2 / 1e6).toFixed(3)} km²  ${t.pieces} pieces`);
  }

  const going = all ? { marks: bots.marks + people.marks, ground: bots.ground + people.ground, raids: bots.raids } : bots;
  const companions = await count(
    sql`select count(*)::int as n from companion_state where ${chosen} and (last_mark_at is not null or on_home_ground)`,
  );
  console.log(`\nthe apply would delete: ${going.marks} marks, ${going.ground} ground pieces, ${going.raids} raids;`);
  console.log(`and reset last-mark spacing + home-ground flag on ${companions} companion rows.`);
  if (!all && people.ground > 0) {
    console.log(`(people's ${people.ground} pieces stay — pass --all to include them)`);
  }

  // The happiness index, counted under the old rhythm.
  const idx = (await db.execute(sql`
    select count(*)::int as rows,
           count(*) filter (where active_s >= ${balance.happinessIndex.minActiveS})::int as ranked,
           round(sum(active_s) / 3600)::int as hours,
           round(avg(case when active_s > 0 then happy_weight_s / active_s end))::int as idx
    from companion_state where ${chosen}
  `)) as unknown as Array<{ rows: number; ranked: number; hours: number; idx: number | null }>;
  const i = idx[0]!;
  console.log(
    `\nhappiness index held by these ${i.rows} rows: ${i.hours ?? 0} counted hours, ${i.ranked} on the board, mean index ${i.idx ?? '—'}`,
  );
  console.log(
    progress
      ? `the apply would ALSO zero those counters and set hunger ${balance.hunger.start} / happiness ${balance.happiness.start}.`
      : 'those stay — pass --progress to zero them and start the measurement on the new rhythm.',
  );

  if (!apply) {
    console.log('\ndry run — nothing written. Re-run with --apply to do it.');
    return;
  }

  if (snapshot) {
    const marks = await db.execute(sql`select * from territory_marks where ${chosen}`);
    const ground = await db.execute(sql`select * from territory_ground where ${chosen}`);
    fs.writeFileSync(snapshot, JSON.stringify({ at: new Date().toISOString(), all, marks, ground }, null, 1));
    console.log(`\nsnapshot → ${snapshot}`);
  }

  await db.transaction(async (tx) => {
    const raids = await tx.execute(
      sql`delete from territory_raids where ${sql.raw(all ? 'true' : "victim_id like 'bot:%'")}`,
    );
    const marks = await tx.execute(sql`delete from territory_marks where ${chosen}`);
    const ground = await tx.execute(sql`delete from territory_ground where ${chosen}`);
    await tx.execute(sql`
      update companion_state
      set last_mark_at = null, last_mark_lat = null, last_mark_lng = null, on_home_ground = false
      where ${chosen}
    `);
    console.log(`\n✓ deleted ${marks.count} marks, ${ground.count} ground pieces, ${raids.count} raids`);
    if (progress) {
      // last_decay_at with it: a row that comes back online after this
      // should start its next drain now, not settle a gap in one tick.
      const reset = await tx.execute(sql`
        update companion_state
        set happy_weight_s = 0,
            active_s = 0,
            hunger = ${balance.hunger.start},
            happiness = ${balance.happiness.start},
            last_decay_at = NOW()
        where ${chosen}
      `);
      console.log(`✓ reset the happiness index and meters on ${reset.count} companion rows`);
    }
  });
  console.log('done. The bots re-mark from their homes on their next walk; nothing re-seeds at boot (botSeedMarks = 0).');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pg.end());
