// Fixture check for the gathering-place clustering. Run it after touching
// gatheringSpots.ts — `pnpm --filter @shukajpes/server check:gathering`.
//
// This decides where «meet» sends people, and every way it can be wrong is
// quiet. Sending a walker to their OWN most-walked street returns a
// perfectly good route to somewhere they will meet nobody. Splitting one
// park across two grid cells returns two half-strength places, or none if
// the halves fall under the walker minimum. A cluster that never ages
// returns whatever was busiest the week the feature shipped, forever.
// None of those throw.
//
// Geometry is metre offsets from a real Kyiv latitude, so the numbers
// below are arithmetic rather than claims about the city.

import {
  clusterGatherings,
  distanceM,
  type GatheringOptions,
  type WalkerMark,
} from './gatheringSpots.js';

const ORIGIN = { lat: 50.4612, lng: 30.5172 };
const M_PER_LAT = 111_320;
const M_PER_LNG = 111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

function at(eastM: number, northM: number): { lat: number; lng: number } {
  return {
    lat: ORIGIN.lat + northM / M_PER_LAT,
    lng: ORIGIN.lng + eastM / M_PER_LNG,
  };
}

const NOW = new Date('2026-09-30T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

function mark(
  userId: string,
  eastM: number,
  northM: number,
  ageH = 1,
): WalkerMark {
  const p = at(eastM, northM);
  return { userId, lat: p.lat, lng: p.lng, at: hoursAgo(ageH) };
}

const OPTS: GatheringOptions = {
  now: NOW,
  radiusM: 200,
  halfLifeH: 72,
  minWalkers: 2,
  limit: 10,
};

let checks = 0;
let failures = 0;
function ok(cond: boolean, label: string, detail = ''): void {
  checks++;
  if (cond) return;
  failures++;
  console.error(`✗ ${label}${detail ? `\n    ${detail}` : ''}`);
}

// ---------------------------------------------------------------------
// THE CENTRAL RULE: many dogs once beats one dog many times.
// ---------------------------------------------------------------------
{
  const marks: WalkerMark[] = [
    // One walker pacing their own block, 40 times.
    ...Array.from({ length: 40 }, (_, i) => mark('solo', 20 + (i % 5) * 10, 0)),
    // Four different dogs crossing a park 1 km east, once each.
    mark('a', 1000, 0),
    mark('b', 1020, 20),
    mark('c', 980, -20),
    mark('d', 1010, 10),
  ];
  const spots = clusterGatherings(marks, OPTS);
  ok(spots.length === 1, 'the one-walker block is not a gathering place', `got ${spots.length}`);
  ok(
    spots[0] !== undefined && distanceM(spots[0].position, at(1000, 0)) < 60,
    'the four-dog park is the place returned',
  );
  ok(spots[0]?.walkers === 4, 'it reports four distinct walkers', `got ${spots[0]?.walkers}`);
}

// ---------------------------------------------------------------------
// …and the same rule as a score, not just a filter: a place with more
// distinct walkers outranks a busier place with fewer, however many marks
// the busier one has.
// ---------------------------------------------------------------------
{
  const marks: WalkerMark[] = [
    // Two dogs, 30 marks between them.
    ...Array.from({ length: 15 }, () => mark('a', 0, 0)),
    ...Array.from({ length: 15 }, () => mark('b', 20, 0)),
    // Five dogs, one mark each, a kilometre away.
    ...['p', 'q', 'r', 's', 't'].map((u, i) => mark(u, 1000 + i * 10, 0)),
  ];
  const spots = clusterGatherings(marks, OPTS);
  ok(spots.length === 2, 'both places qualify', `got ${spots.length}`);
  ok(
    spots[0] !== undefined && spots[0].walkers === 5,
    'the five-dog place ranks first despite a sixth of the marks',
    `first had ${spots[0]?.walkers} walkers / ${spots[0]?.marks} marks`,
  );
}

// ---------------------------------------------------------------------
// A cluster straddling a grid line is ONE place, not two halves — this is
// the bug the second pass exists to stop, and the one that would quietly
// drop a real park under the walker minimum.
// ---------------------------------------------------------------------
{
  // Put the crowd hard on a cell boundary: cells are radiusM wide, so a
  // multiple of 200 m east of the origin is a line.
  const spots = clusterGatherings(
    [
      mark('a', 395, 0),
      mark('b', 398, 5),
      mark('c', 402, -5),
      mark('d', 405, 0),
    ],
    OPTS,
  );
  ok(spots.length === 1, 'a crowd on a grid line is one place', `got ${spots.length}`);
  ok(spots[0]?.walkers === 4, 'with all four walkers, not a split half', `got ${spots[0]?.walkers}`);
}

// ---------------------------------------------------------------------
// Ageing. The same crowd, one seen today and one seen a fortnight ago:
// both are places, and today's ranks first.
// ---------------------------------------------------------------------
{
  const spots = clusterGatherings(
    [
      mark('a', 0, 0, 1),
      mark('b', 20, 0, 1),
      mark('c', 1000, 0, 24 * 14),
      mark('d', 1020, 0, 24 * 14),
    ],
    OPTS,
  );
  ok(spots.length === 2, 'the old place is still a place', `got ${spots.length}`);
  ok(
    spots[0] !== undefined && distanceM(spots[0].position, at(10, 0)) < 60,
    "today's crowd outranks a fortnight-old one",
  );
  ok(
    (spots[1]?.score ?? 1) < 0.2,
    'and the old one has decayed to a fraction of its weight',
    `score ${spots[1]?.score}`,
  );
}

// ---------------------------------------------------------------------
// The walker minimum is a floor, not a suggestion: one dog is never a
// gathering place however fresh or however many marks it left.
// ---------------------------------------------------------------------
{
  const spots = clusterGatherings(
    Array.from({ length: 100 }, () => mark('lonely', 0, 0, 0.1)),
    OPTS,
  );
  ok(spots.length === 0, 'one walker alone is never a gathering place', `got ${spots.length}`);
}

// ---------------------------------------------------------------------
// One place is returned once. Two adjacent nominations looking at the
// same park must not come back as two walks to the same park.
// ---------------------------------------------------------------------
{
  // A broad smear of walkers across ~300 m — wide enough to nominate
  // several cells, close enough to be one place.
  const marks: WalkerMark[] = [];
  for (let i = 0; i < 12; i++) marks.push(mark(`u${i}`, i * 25, 0));
  const spots = clusterGatherings(marks, OPTS);
  ok(spots.length === 1, 'one smear of walkers is one place', `got ${spots.length}`);
  ok(
    spots.every((s, i) => spots.every((o, j) => i === j || distanceM(s.position, o.position) > OPTS.radiusM)),
    'no two returned places sit inside one radius of each other',
  );
}

// ---------------------------------------------------------------------
// Degenerate inputs return nothing rather than throwing.
// ---------------------------------------------------------------------
{
  ok(clusterGatherings([], OPTS).length === 0, 'no marks, no places');
  ok(
    clusterGatherings([mark('a', 0, 0)], { ...OPTS, minWalkers: 1 }).length === 1,
    'a single mark is a place when one walker is enough',
  );
  ok(
    clusterGatherings([mark('a', 0, 0, -5)], { ...OPTS, minWalkers: 1 })[0]?.score === 1,
    'a mark dated in the future weighs 1, not more',
  );
}

// ---------------------------------------------------------------------
// The limit is respected, and it cuts the weakest.
// ---------------------------------------------------------------------
{
  const marks: WalkerMark[] = [];
  for (let k = 0; k < 5; k++) {
    // Five separate places, k+2 walkers each, 1 km apart.
    for (let w = 0; w <= k + 1; w++) marks.push(mark(`k${k}w${w}`, k * 1000, 0));
  }
  const spots = clusterGatherings(marks, { ...OPTS, limit: 3 });
  ok(spots.length === 3, 'the limit caps the list', `got ${spots.length}`);
  ok(
    spots[0] !== undefined && spots[0].walkers === 6,
    'and keeps the strongest',
    `first had ${spots[0]?.walkers} walkers`,
  );
}

if (failures === 0) {
  console.log(`✓ ${checks} gathering-place expectations hold`);
} else {
  console.error(`\n✗ ${failures} of ${checks} expectations failed`);
  process.exit(1);
}
