// EXPIRE PETS THAT WERE NEVER IN KYIV.
//
// The map is Kyiv-only. upsert refuses coords outside the Greater Kyiv
// bbox — but it lets the city-centre fallback coord through on purpose,
// and a post about a cat in Uzhhorod is exactly the post that can't be
// geocoded, so it lands on the fallback and stays active. Measured on
// production: 89 active pets sit on that pin, and at least 9 of them are
// in other cities.
//
// The gate for new arrivals is pipeline/outOfArea.ts, wired into upsert.
// Guards only ever apply to what comes next, though, so this is the
// catch-up pass for rows already in the table.
//
// WHY THIS EXISTS ALONGSIDE clean:lost-dogs, which already has a
// wrong-city path: that one answers the question by FETCHING each ad
// page, and OLX is behind a WAF that 403s this host. Its city half is
// not merely slow from production, it cannot run at all — it gives up
// after 8 consecutive blocks and truthfully reports that it read zero
// ads. This script asks a weaker question of data we already hold (the
// stored ad title, the stored description), needs no network, and so
// works from the app host today. Weaker evidence, but evidence that
// exists. When the proxy from PR #407 is configured, clean:lost-dogs
// becomes the better tool and this one stays useful as the fast pass.
//
// Dry run by default. Nothing is written without --apply, and the dry
// run prints every row it would touch along with the token that
// triggered the match — the point is that a human can see WHY each pet
// was flagged and catch a bad rule before it expires a real report.
//
// status = 'expired', never a delete. Sightings cascade from lost_dogs,
// and a real person walked a real street to report those. Expiring hides
// the pet from every query the app makes and is one UPDATE from
// reversible.
//
// Usage:
//   local:       pnpm --filter @shukajpes/server expire:out-of-area
//                pnpm --filter @shukajpes/server expire:out-of-area --apply
//   production:  fly ssh console -a shukajpes-api -C "node dist/db/expire-out-of-area.js"
//                fly ssh console -a shukajpes-api -C "node dist/db/expire-out-of-area.js --apply"

import 'dotenv/config';
import { eq, isNotNull } from 'drizzle-orm';
import { pathToFileURL } from 'url';
import { db, schema, pg } from './index.js';
import { detectOtherCity, type OtherCityHit } from '../pipeline/outOfArea.js';

// The ungeocoded fallback pin. Rows here are invisible on the map
// already (/dogs/nearby filters them out), so expiring one costs
// nothing that is currently working; rows elsewhere are drawn, and
// expiring one takes a visible pet off the map. Reported separately for
// that reason.
const FALLBACK_LAT = 50.4501;
const FALLBACK_LNG = 30.5234;
const FALLBACK_TOLERANCE = 0.0005;

function onFallbackPin(lat: number, lng: number): boolean {
  return (
    Math.abs(lat - FALLBACK_LAT) < FALLBACK_TOLERANCE &&
    Math.abs(lng - FALLBACK_LNG) < FALLBACK_TOLERANCE
  );
}

interface Flagged {
  id: string;
  name: string;
  hit: OtherCityHit;
  // Which stored field the city name came from. Only 'title' is ever
  // written — see the split below, which is not a style choice but a
  // conclusion from reading real rows.
  evidence: 'title' | 'description';
  text: string;
  onPin: boolean;
}

// WHY DESCRIPTIONS ARE REPORTED AND NEVER APPLIED.
//
// The title is what the poster wrote about where their pet is. The
// description is an English sentence the parser wrote, and it narrates
// the pet's history as readily as its location. Both failure modes
// showed up in the first run against production:
//
//   "scared dog recently evacuated from Kramatorsk, slipped leash near
//    Olimpiiska stadium"       — a Kyiv dog, titled "КИЇВ!!! ЗНИК собака!!"
//   "lost near Ozerne village in Chernihiv district"
//                              — coords in Obolon, genuinely ambiguous
//
// Expiring the first would have taken a real, correctly-placed Kyiv pet
// off the map. A named city in a description is a reason for a person
// to look, not a reason for a script to write.


async function main() {
  const apply = process.argv.includes('--apply');
  console.log(apply ? '▶ APPLY — writes are real' : '▶ dry run — pass --apply to write');

  const rows = await db
    .select({
      id: schema.lostDogs.id,
      name: schema.lostDogs.name,
      lat: schema.lostDogs.lastSeenLat,
      lng: schema.lostDogs.lastSeenLng,
      description: schema.lostDogs.lastSeenDescription,
      source: schema.lostDogs.source,
    })
    .from(schema.lostDogs)
    .where(eq(schema.lostDogs.status, 'active'));

  // Titles in a second query joined through a Map, rather than a
  // correlated subquery in a raw sql`` fragment — drizzle renders
  // interpolated columns unqualified inside those, which has already
  // produced one silently-wrong join in this directory.
  const logs = await db
    .select({
      dogId: schema.scrapeLog.dogId,
      title: schema.scrapeLog.title,
      firstSeenAt: schema.scrapeLog.firstSeenAt,
    })
    .from(schema.scrapeLog)
    .where(isNotNull(schema.scrapeLog.dogId));
  const titleByDog = new Map<string, string>();
  for (const l of logs.sort((a, b) => a.firstSeenAt.getTime() - b.firstSeenAt.getTime())) {
    // Earliest wins: the ad we first ingested the pet from.
    if (l.dogId && l.title && !titleByDog.has(l.dogId)) titleByDog.set(l.dogId, l.title);
  }

  const flagged: Flagged[] = [];
  let withTitle = 0;
  for (const row of rows) {
    const title = titleByDog.get(row.id) ?? null;
    if (title) withTitle++;
    const onPin = onFallbackPin(row.lat, row.lng);

    const titleHit = title ? detectOtherCity(title) : null;
    if (titleHit) {
      flagged.push({ id: row.id, name: row.name, hit: titleHit, evidence: 'title', text: title!, onPin });
      continue;
    }
    const descHit = row.description ? detectOtherCity(row.description) : null;
    if (descHit) {
      flagged.push({
        id: row.id,
        name: row.name,
        hit: descHit,
        evidence: 'description',
        text: row.description!,
        onPin,
      });
    }
  }

  const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));

  console.log(`\nactive pets:            ${rows.length}`);
  console.log(`  … with a stored title: ${withTitle}`);
  console.log(`  … on the fallback pin: ${rows.filter((r) => onFallbackPin(r.lat, r.lng)).length}`);

  // A check that read nothing must never look like a check that found
  // nothing — the one mistake this codebase has already made twice.
  if (withTitle === 0) {
    console.log(
      `\n!! NO STORED TITLES AT ALL — the title half of this check read nothing.\n` +
        `   Any "0 flagged" below reflects that, not a clean table.`,
    );
  }

  const byTitle = flagged.filter((f) => f.evidence === 'title');
  const byDescription = flagged.filter((f) => f.evidence === 'description');

  const render = (items: Flagged[]) => {
    const byCity = new Map<string, Flagged[]>();
    for (const f of items) byCity.set(f.hit.city, [...(byCity.get(f.hit.city) ?? []), f]);
    for (const [city, group] of [...byCity].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${city} — ${group.length}`);
      for (const f of group) {
        const where = f.onPin ? 'pin' : 'MAP';
        console.log(
          `    [${where}] ${pad(f.name, 20)} via "${f.hit.token}"  ${pad(f.text.replace(/\s+/g, ' '), 60)}`,
        );
      }
    }
  };

  const drawn = byTitle.filter((f) => !f.onPin).length;
  console.log(
    `\nWILL EXPIRE — city named in the ad title: ${byTitle.length}` +
      `  (${byTitle.length - drawn} on the pin, ${drawn} currently drawn on the map)`,
  );
  render(byTitle);

  console.log(`\nREPORT ONLY — city named only in the parser's description: ${byDescription.length}`);
  console.log('  Not written by --apply. Read them and decide by hand.');
  render(byDescription);

  // Rows currently drawn deserve a second look before an --apply takes
  // them off the map: those pins work today.
  if (drawn > 0) {
    console.log(
      `\n!! ${drawn} of the rows above are DRAWN ON THE MAP right now, not sitting\n` +
        `   invisibly on the pin. Expiring one removes a working pin, so read those\n` +
        `   [MAP] lines specifically before --apply.`,
    );
  }

  if (!apply) {
    console.log('\n✓ dry run, nothing written.');
    console.log(`  --apply would set status = 'expired' on ${byTitle.length} row(s).`);
    return;
  }

  for (const f of byTitle) {
    await db.update(schema.lostDogs).set({ status: 'expired' }).where(eq(schema.lostDogs.id, f.id));
  }
  console.log(`\n  ${byTitle.length} status → expired`);
  console.log('  reversible: UPDATE lost_dogs SET status = \'active\' WHERE id IN (…)');
  console.log('\n✓ done.');
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
