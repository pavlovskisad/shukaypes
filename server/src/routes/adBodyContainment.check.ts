// The ad body must stay on ONE route, and this is the check that says so.
// Run with: pnpm --filter @shukajpes/server check:ad-body
//
// WHY THIS IS WORTH A CHECK RATHER THAN A CODE REVIEW.
//
// `scrape_log.raw_body` holds the owner's post verbatim — phone number,
// Viber, Telegram handle, all of it. That is fine, and it is the point:
// somebody who has just reported seeing the animal should be able to ring
// the owner without leaving the app.
//
// It stops being fine the moment it rides along in a payload that goes to
// everybody. `/sync/map` is sent to every walker every fifteen seconds. A
// body joined into THAT query turns "one walker reads one ad" into a
// contact list anyone with a device id can download in a loop, and it does
// it silently — the map keeps working, nothing errors, the payload is just
// bigger. There is no failing test to notice, which is exactly why this
// file exists.
//
// So: the read path is an allowlist of one route, and any new file that
// touches the column has to come here and say why. Adding a name below is
// a deliberate act; joining a column is not.
//
// This checks the SOURCE, not a live response, on purpose. A response
// check can only see the pets a seeded database happens to contain, and
// passes happily if the leak is behind a branch nothing in the fixture
// takes.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('../', import.meta.url).pathname;

// Files allowed to name the column, and what each is allowed to do.
const ALLOWED = new Map<string, string>([
  ['db/schema.ts', 'declares the column'],
  ['pipeline/adBody.ts', 'caps the text on the way in'],
  ['pipeline/sources/olx.ts', 'writes it at ingest'],
  ['services/telegramIngest.ts', 'writes it at ingest'],
  // THE ONLY READER OF THE TEXT. Gated on a sightings row for this user,
  // and it redacts contacts when there is not one.
  ['routes/dogs.ts', 'serves it from GET /dogs/:id/post, gated'],
  // The refresh CLIs, operator-run and not reachable over HTTP.
  // expire:no-post only ever asks `raw_body is not null` — whether we
  // hold an ad, never what it says. backfill:ad-bodies is a WRITER: it
  // fetches an ad we already have the URL for and stores the text, the
  // same job olx.ts does at ingest. Neither returns a body to anybody.
  ['db/backfill-ad-bodies.ts', 'fetches a known ad URL and writes the text'],
  // Same job as backfill-ad-bodies, on the other half of the base: it
  // fetches an expired pet's ad to find out whether the search is still
  // running, and stores the text from the response it already holds
  // rather than making a second request for it. A WRITER — it never
  // prints a body, and the one thing it does print (the listing title)
  // goes through redactContacts.
  ['db/revive-live-ads.ts', 'stores the text of an ad it fetched to prove the search is live'],
  // Rewrites stored bodies to take OLX's section labels off them. It
  // reads the column and writes it back, but the only thing it PRINTS is
  // the text it removed — a section label by construction — and that
  // still goes through redactContacts. Operator-run, no HTTP surface.
  ['db/clean-ad-bodies.ts', 'strips OLX section labels out of stored bodies'],
  ['db/expire-no-post.ts', 'tests null-ness to find pets whose ad is gone'],
  // Only asks `raw_body is not null` to PICK a candidate ad to probe —
  // it never selects the column. And it masks every digit it prints, so
  // even what it does report cannot carry a contact.
  ['db/probe-ad-phone.ts', 'tests null-ness to choose one ad to probe'],
  // THE ONE GENUINE READER besides the route. It scans stored bodies for
  // rehoming phrasing — that is the question it answers — but everything
  // it prints goes through redactContacts first, so its output carries a
  // matched keyword and a redacted title and nothing else. Operator-run,
  // never reachable over HTTP.
  ['db/audit-ingest.ts', 'scans bodies for rehoming phrasing, prints redacted'],
]);

// Nothing here may ever read it. These are the payloads that go out in
// bulk or without a user attached; listing them by name makes the failure
// message say which door was left open rather than just "a file changed".
const FORBIDDEN_HINTS = new Map<string, string>([
  ['services/mapData.ts', '/sync/map and /dogs/nearby — every walker, every 15s'],
  ['routes/syncMap.ts', '/sync/map — every walker, every 15s'],
  ['services/metrics.ts', '/admin/metrics — an unauthenticated console'],
  ['routes/admin.ts', '/admin/* — an unauthenticated console'],
  ['routes/stats.ts', '/stats — unauthenticated'],
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

let failures = 0;
const offenders: string[] = [];

for (const full of walk(SRC)) {
  const rel = full.slice(SRC.length);
  // A check that asserts things about the column has to be able to spell
  // its name.
  if (rel.endsWith('.check.ts')) continue;

  const text = readFileSync(full, 'utf8');
  if (!/\brawBody\b|\braw_body\b/.test(text)) continue;
  if (ALLOWED.has(rel)) continue;

  failures++;
  const hint = FORBIDDEN_HINTS.get(rel);
  offenders.push(hint ? `${rel} — this feeds ${hint}` : rel);
}

if (failures > 0) {
  console.error('✗ the ad body escaped GET /dogs/:id/post:\n');
  for (const o of offenders) console.error(`    ${o}`);
  console.error(
    '\n  The body carries the owner\'s phone number. If this file genuinely\n' +
      '  needs it, add it to ALLOWED in this check WITH the reason — and be\n' +
      '  sure it is not a payload that goes out in bulk or unauthenticated.\n',
  );
  process.exit(1);
}

// The reader also has to still BE the gated one. A rename or a refactor
// that drops the sightings lookup would leave the allowlist happy and the
// contacts ungated, so check the gate is still standing.
const dogsRoute = readFileSync(join(SRC, 'routes/dogs.ts'), 'utf8');
for (const [needle, why] of [
  ['redactContacts', 'masks the contacts when there is no sighting'],
  ['schema.sightings', 'the sightings lookup that decides which of the two you get'],
] as const) {
  if (!dogsRoute.includes(needle)) {
    console.error(`✗ routes/dogs.ts no longer mentions ${needle} — ${why}`);
    process.exit(1);
  }
}

console.log(`✓ ad body: one gated reader of the text, ${ALLOWED.size - 1} other files, no bulk payload`);
