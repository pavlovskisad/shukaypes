// EXPIRE THE PETS WHOSE ADS ARE GONE FROM OLX.
//
// The second half of a base refresh. `reopen:ads` deletes the ledger rows
// so ads become fetchable again; the ingest ticks then re-read every
// listing that still exists and store its text. This pass clears out what
// is left over.
//
// AND WHAT IS LEFT OVER IS THE ANSWER, not a shortfall. A lost-pet listing
// comes down when the pet is found. "We asked OLX again and it had
// nothing" is the closest thing to a found-signal this data has, and it is
// far better evidence than an age threshold: a 90-day cutoff expires a pet
// still being searched for and keeps one that went home in April.
//
// THE PREDICATE, and why it is not the obvious one.
//
// Not `created_at < refresh_started`: a pet whose ad is still live often
// keeps its ORIGINAL row, because upsert dedupes the re-ingest onto the
// existing pet rather than inserting a new one. created_at stays months
// old while the pet is current and now has a body. A timestamp cutoff
// expires exactly those.
//
// Not "has no stored body" either, which was the first version of this
// file and was wrong in a quieter way. Before the refresh, EVERY legacy
// pet has no body — so that predicate matches the whole base, and the
// only thing standing between it and a catastrophic --apply was a
// percentage heuristic guessing at whether the refresh had run.
//
// The exact signal is in the ledger. After `reopen:ads`, a pet is in
// exactly one of three states:
//
//   ledger row WITH a body     the ad came back      → keep
//   NO ledger row at all       reopened, never came back → EXPIRE
//   ledger row, still no body  never reopened        → keep, and say so
//
// So the third state excludes itself. A pet that `reopen:ads` has not
// touched — because it has not been run, or was capped by --limit, or
// this pet was skipped — still holds its body-less row and is never
// expired by this script. That removes the ordering footgun entirely:
// running this first does nothing rather than emptying the table.
//
// status = 'expired', never a delete. It hides the pet from every query
// the app makes — indistinguishable from removal, from the outside — and
// it is one UPDATE from reversible, with sightings left attached rather
// than cascaded away. There is no upside to deleting.
//
// Dry run by default. Nothing is written without --apply.
//
// Usage:
//   local:       pnpm --filter @shukajpes/server expire:no-post
//                pnpm --filter @shukajpes/server expire:no-post --apply
//   production:  fly ssh console -a shukajpes-api -C "node dist/db/expire-no-post.js"
//                fly ssh console -a shukajpes-api -C "node dist/db/expire-no-post.js --apply"

import 'dotenv/config';
import { eq, sql } from 'drizzle-orm';
import { pathToFileURL } from 'url';
import { db, schema, pg } from './index.js';

// Pets that came from a scraped ad. Anything else — a sideloaded report,
// an in-app one — never had an OLX listing, so "no ad came back" says
// nothing about it and it must never be swept up here.
function fromScrapedAd(source: string): boolean {
  return source === 'olx' || source.startsWith('telegram:') || source === 'facebook';
}

// The ungeocoded fallback pin. Pets sitting on it are already invisible
// (/dogs/nearby filters them), so expiring one costs nothing that works
// today; pets elsewhere are drawn, and expiring one takes a pin off the
// map. Reported separately for that reason — same split as
// expire:out-of-area, and for the same reason.
const FALLBACK_LAT = 50.4501;
const FALLBACK_LNG = 30.5234;
const FALLBACK_TOLERANCE = 0.0005;

function onFallbackPin(lat: number, lng: number): boolean {
  return (
    Math.abs(lat - FALLBACK_LAT) < FALLBACK_TOLERANCE &&
    Math.abs(lng - FALLBACK_LNG) < FALLBACK_TOLERANCE
  );
}

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(apply ? '▶ APPLY — writes are real' : '▶ dry run — pass --apply to write');

  const pets = await db
    .select({
      id: schema.lostDogs.id,
      name: schema.lostDogs.name,
      source: schema.lostDogs.source,
      lat: schema.lostDogs.lastSeenLat,
      lng: schema.lostDogs.lastSeenLng,
      lastSeenAt: schema.lostDogs.lastSeenAt,
    })
    .from(schema.lostDogs)
    .where(eq(schema.lostDogs.status, 'active'));

  if (pets.length === 0) {
    // A check that read nothing must never be reported as a check that
    // found nothing.
    console.log('\n!! NO ACTIVE PETS AT ALL. Nothing here read a populated table —');
    console.log('   check which database this is pointed at before believing any zero.');
    await pg.end();
    return;
  }

  // Ledger state per pet, in one pass. A second query joined through Maps
  // rather than a correlated subquery in a raw sql`` fragment: drizzle
  // renders interpolated columns unqualified inside those, which has
  // already produced one silently-wrong join in this directory.
  const logs = await db
    .select({
      dogId: schema.scrapeLog.dogId,
      hasBody: sql<boolean>`${schema.scrapeLog.rawBody} is not null`,
    })
    .from(schema.scrapeLog);
  const withBody = new Set<string>();
  const withoutBody = new Set<string>();
  for (const l of logs) {
    if (!l.dogId) continue;
    if (l.hasBody) withBody.add(l.dogId);
    else withoutBody.add(l.dogId);
  }

  // How many real user reports hang off the rows this would expire.
  // Expiring keeps them attached, so this is not a loss — but it is the
  // number that says whether anybody has been using the app, and that
  // belongs on screen rather than in an assumption.
  const sightingRows = await db
    .select({ dogId: schema.sightings.dogId, n: sql<number>`count(*)::int` })
    .from(schema.sightings)
    .groupBy(schema.sightings.dogId);
  const sightingsByDog = new Map<string, number>();
  for (const s of sightingRows) sightingsByDog.set(s.dogId, Number(s.n));
  const sightingsTotal = [...sightingsByDog.values()].reduce((a, b) => a + b, 0);

  const scraped = pets.filter((p) => fromScrapedAd(p.source));
  const notScraped = pets.filter((p) => !fromScrapedAd(p.source));

  const kept = scraped.filter((p) => withBody.has(p.id));
  // Still holding a body-less ledger row: reopen:ads has not reached it.
  const notYetReopened = scraped.filter((p) => !withBody.has(p.id) && withoutBody.has(p.id));
  // Reopened, and no ad came back.
  const flagged = scraped.filter((p) => !withBody.has(p.id) && !withoutBody.has(p.id));

  const drawn = flagged.filter((p) => !onFallbackPin(p.lat, p.lng));
  const onPin = flagged.length - drawn.length;
  const affectedSightings = flagged.reduce((n, p) => n + (sightingsByDog.get(p.id) ?? 0), 0);

  const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));
  const days = (d: Date) => Math.floor((Date.now() - d.getTime()) / 86_400_000);

  console.log(`\nactive pets:                 ${pets.length}`);
  console.log(`  … from a scraped ad:       ${scraped.length}`);
  console.log(`  … from elsewhere (immune): ${notScraped.length}`);
  console.log(`\nof the scraped ones:`);
  console.log(`  ad came back, has body:    ${kept.length}`);
  console.log(`  never reopened yet:        ${notYetReopened.length}`);
  console.log(`  reopened, no ad returned:  ${flagged.length}   ← this is the expiry set`);
  console.log(`\nsightings in the table:      ${sightingsTotal}`);
  console.log(`  … on pets flagged here:    ${affectedSightings}  (kept — expiring does not cascade)`);

  if (notYetReopened.length > 0) {
    console.log(
      `\n!! ${notYetReopened.length} scraped pet(s) still hold a body-less ledger row, meaning\n` +
        `   reopen:ads has not covered them. They are NOT in the expiry set — but it\n` +
        `   also means this refresh is INCOMPLETE. Run reopen:ads --apply and let the\n` +
        `   ingest ticks finish, or these pets simply stay as they are.`,
    );
  }

  if (kept.length === 0 && flagged.length > 0) {
    console.log(
      `\n!! NOT ONE scraped pet has a stored body, yet ${flagged.length} are flagged for expiry.\n` +
        `   That is not what a completed refresh looks like — it is what an empty or\n` +
        `   wrong database looks like. Do not --apply until this line is gone.`,
    );
  }

  console.log(
    `\nWILL EXPIRE: ${flagged.length}  (${onPin} on the fallback pin, ${drawn.length} drawn on the map)`,
  );
  const byAge = [...flagged].sort((a, b) => a.lastSeenAt.getTime() - b.lastSeenAt.getTime());
  for (const p of byAge.slice(0, 60)) {
    const where = onFallbackPin(p.lat, p.lng) ? 'pin' : 'MAP';
    const s = sightingsByDog.get(p.id) ?? 0;
    console.log(
      `  [${where}] ${pad(p.name, 22)} ${pad(p.source, 9)} last seen ${String(days(p.lastSeenAt)).padStart(4)}d ago` +
        (s ? `  ${s} sighting(s)` : ''),
    );
  }
  if (byAge.length > 60) {
    // Never let a listing bound read as completeness.
    console.log(
      `  … and ${byAge.length - 60} more (listing capped at 60; ALL ${byAge.length} would be expired)`,
    );
  }

  if (drawn.length > 0) {
    console.log(
      `\n!! ${drawn.length} of these are DRAWN ON THE MAP right now. Expiring one removes a\n` +
        `   working pin, so read the [MAP] lines before --apply.`,
    );
  }

  if (!apply) {
    console.log('\n✓ dry run, nothing written.');
    console.log(`  --apply would set status = 'expired' on ${flagged.length} row(s).`);
    await pg.end();
    return;
  }

  // The one refusal left. Everything else is expressed in the predicate:
  // a pet this script cannot justify expiring is simply not in the set.
  if (kept.length === 0) {
    console.error(
      `\n✗ REFUSING TO WRITE.\n\n` +
        `  Not one scraped pet has a stored ad body, so there is no evidence any\n` +
        `  refresh has run. Expiring ${flagged.length} pet(s) on that basis would be a guess.\n` +
        `  Run reopen:ads --apply, let the ingest ticks finish, then come back.`,
    );
    await pg.end();
    process.exit(1);
  }

  for (const p of flagged) {
    await db.update(schema.lostDogs).set({ status: 'expired' }).where(eq(schema.lostDogs.id, p.id));
  }

  console.log(`\n  ${flagged.length} status → expired`);
  console.log(`  ${affectedSightings} sighting(s) left attached and intact.`);
  console.log("  reversible: UPDATE lost_dogs SET status = 'active' WHERE id IN (…)");
  console.log('\n✓ done.');
  await pg.end();
}

const isEntry = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isEntry) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
