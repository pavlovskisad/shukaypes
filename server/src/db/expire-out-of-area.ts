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
import { isConfidentPlacement } from '../services/placementConfidence.js';
import { redactContacts } from '../pipeline/redactContacts.js';

// The ungeocoded fallback pin. Still worth counting — it says how much
// of the table the parser could not place at all — but it is NO LONGER
// the test for whether a walker can see a pet. Being off this pin used
// to mean "drawn on the map"; since the confidence bar it means only
// "has a coordinate", and most of those coordinates are model guesses
// that no surface shows. `visible` below asks the question this comment
// used to answer.
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
  evidence: 'title' | 'description' | 'body';
  text: string;
  onPin: boolean;
  /** Whether a walker can actually see this pet — see placementConfidence.ts. */
  visible: boolean;
}

// WHY THE AD BODY IS READ, AND WHY IT IS NEVER APPLIED EITHER.
//
// Ten pets were measured sitting on the Kyiv map from other cities:
// «на хтз» (Kharkiv), «в районі молдованка» and «4, 5 станции
// Люстдорфской дороги» (Odesa), «в районі левандівки» (Lviv). The words
// that give them away are in the BODY — a neighbourhood, a road, a tram
// stop — because that is where people write directions. This CLI read
// only the title and the description, so it saw one of the ten.
//
// It stays REPORT ONLY, for the same reason descriptions do and one
// more. A body is a paragraph, and a paragraph about a Kyiv pet can
// mention another city in passing — where the family evacuated from,
// where the dog was bought, which shelter called. The title is one line
// about this animal now; a body is a story. Auto-expiring on a story
// takes real searches off the map.

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
      placementSource: schema.lostDogs.placementSource,
      isFoundReport: schema.lostDogs.isFoundReport,
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
      body: schema.scrapeLog.rawBody,
      firstSeenAt: schema.scrapeLog.firstSeenAt,
    })
    .from(schema.scrapeLog)
    .where(isNotNull(schema.scrapeLog.dogId));
  const titleByDog = new Map<string, string>();
  const bodyByDog = new Map<string, string>();
  for (const l of logs.sort((a, b) => a.firstSeenAt.getTime() - b.firstSeenAt.getTime())) {
    // Earliest wins: the ad we first ingested the pet from.
    if (l.dogId && l.title && !titleByDog.has(l.dogId)) titleByDog.set(l.dogId, l.title);
    if (l.dogId && l.body && !bodyByDog.has(l.dogId)) bodyByDog.set(l.dogId, l.body);
  }

  const flagged: Flagged[] = [];
  let withTitle = 0;
  let withBody = 0;
  for (const row of rows) {
    const title = titleByDog.get(row.id) ?? null;
    const body = bodyByDog.get(row.id) ?? null;
    if (title) withTitle++;
    if (body) withBody++;
    const onPin = onFallbackPin(row.lat, row.lng);
    // WHAT A WALKER CAN ACTUALLY SEE, not what has a coordinate.
    //
    // This used to be `!onPin`, which meant "not on the fall-through"
    // and was the same question until the confidence bar landed. It is
    // not any more: a model-guessed pet has a real coordinate and is
    // still hidden. The first run after the bar warned that expiring
    // «котик» would remove a working pin; it was model-geo, invisible,
    // and the warning was telling the reader something untrue about the
    // one thing it exists to protect.
    const visible =
      !row.isFoundReport && isConfidentPlacement(row.placementSource);

    const titleHit = title ? detectOtherCity(title) : null;
    if (titleHit) {
      flagged.push({
        id: row.id, name: row.name, hit: titleHit, evidence: 'title', text: title!, onPin, visible,
      });
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
        visible,
      });
      continue;
    }
    const bodyHit = body ? detectOtherCity(body) : null;
    if (bodyHit) {
      flagged.push({
        id: row.id, name: row.name, hit: bodyHit, evidence: 'body', text: body!, onPin, visible,
      });
    }
  }

  const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));

  console.log(`\nactive pets:            ${rows.length}`);
  console.log(`  … with a stored title: ${withTitle}`);
  console.log(`  … with a stored body:  ${withBody}`);
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
  const byBody = flagged.filter((f) => f.evidence === 'body');

  const render = (items: Flagged[]) => {
    const byCity = new Map<string, Flagged[]>();
    for (const f of items) byCity.set(f.hit.city, [...(byCity.get(f.hit.city) ?? []), f]);
    for (const [city, group] of [...byCity].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${city} — ${group.length}`);
      for (const f of group) {
        const where = f.visible ? 'SHOWN' : 'hidden';
        // REDACTED, because one of these three fields is now the ad
        // body. A title is a line about the animal; a body is the whole
        // post, phone number included, and the first sixty characters
        // of it are as likely to be a contact as a place. The evidence
        // a reader needs is the matched token and enough words around
        // it to judge the match — never the poster's number.
        const excerpt = redactContacts(f.text.replace(/\s+/g, ' '));
        console.log(`    [${where}] ${pad(f.name, 20)} via "${f.hit.token}"  ${pad(excerpt, 60)}`);
      }
    }
  };

  const drawn = byTitle.filter((f) => f.visible).length;
  console.log(
    `\nWILL EXPIRE — city named in the ad title: ${byTitle.length}` +
      `  (${byTitle.length - drawn} hidden, ${drawn} shown to walkers)`,
  );
  render(byTitle);

  console.log(`\nREPORT ONLY — city named only in the parser's description: ${byDescription.length}`);
  console.log('  Not written by --apply. Read them and decide by hand.');
  render(byDescription);

  console.log(`\nREPORT ONLY — city named only in the ad body: ${byBody.length}`);
  console.log('  Not written by --apply — a body is a paragraph, and a Kyiv pet\'s');
  console.log('  story can name another city in passing. Read them, then expire the');
  console.log('  real ones by id with expire:pet.');
  render(byBody);

  // Rows currently drawn deserve a second look before an --apply takes
  // them off the map: those pins work today.
  if (drawn > 0) {
    console.log(
      `\n!! ${drawn} of the rows above are SHOWN TO WALKERS right now — they pass\n` +
        `   the placement bar, so they are on the map and offerable as searches.\n` +
        `   Expiring one takes a working pin away, so read those [SHOWN] lines\n` +
        `   specifically before --apply.`,
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
