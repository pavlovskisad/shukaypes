// Fixture check for the walk-stop planner. Run it after touching
// loreWalk.ts — `pnpm --filter @shukajpes/server check:lore-walk`.
//
// The planner decides where a walk goes. Its failures are quiet ones:
// three stops crammed into the first block still returns three stops, a
// stop spliced into the wrong leg of a roundtrip still returns a route,
// and a detour that doubles the walk still draws a line on the map. None
// of those throw, so none of them show up anywhere except in a walk that
// is worse than the one before the feature existed.
//
// Geometry is built from METRE OFFSETS around a real Kyiv origin rather
// than from remembered coordinates, so every expectation below is
// arithmetic rather than a claim about where something in Kyiv actually
// is. The one thing that matters about the origin is its latitude — it
// sets the longitude scale the planner works in.

import {
  pathLengthM,
  planStops,
  waypointsThrough,
  type LorePoint,
  type LoreStop,
} from './loreWalk.js';
import { distanceMeters, type LatLng } from '../utils/geo.js';

// Podil, roughly. Only the latitude does any work here.
const ORIGIN: LatLng = { lat: 50.4612, lng: 30.5172 };

const M_PER_LAT = 111_320;
const M_PER_LNG = 111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

// A point `eastM` east and `northM` north of the origin.
function at(eastM: number, northM: number): LatLng {
  return {
    lat: ORIGIN.lat + northM / M_PER_LAT,
    lng: ORIGIN.lng + eastM / M_PER_LNG,
  };
}

let seq = 0;
function poi(
  eastM: number,
  northM: number,
  extra: Partial<LorePoint> = {},
): LorePoint {
  const p = at(eastM, northM);
  seq++;
  return {
    id: `osm:node:${seq}`,
    name: extra.name ?? `poi-${seq}`,
    category: 'historic',
    story: 'a sentence about it',
    hasDetail: false,
    wikipediaTitle: null,
    sourceLang: null,
    lat: p.lat,
    lng: p.lng,
    ...extra,
  };
}

let failures = 0;
let checks = 0;

function ok(cond: boolean, label: string, detail = ''): void {
  checks++;
  if (cond) return;
  failures++;
  console.error(`✗ ${label}${detail ? `\n    ${detail}` : ''}`);
}

// ---------------------------------------------------------------------
// A straight 1200 m walk due east, landmarks strung along it.
// ---------------------------------------------------------------------
{
  const path = [ORIGIN, at(1200, 0)];
  const pool = [
    poi(50, 10), // under the walker's feet — inside the start headroom
    poi(300, 40),
    poi(600, -30),
    poi(900, 60),
    poi(1180, 5), // stacked on the destination — inside the end headroom
    poi(600, 900), // a kilometre off the line
  ];
  const stops = planStops({
    path,
    pool,
    corridorM: 200,
    maxStops: 3,
    minSpacingM: 180,
    maxDetourM: 400,
  });

  ok(stops.length === 3, 'three spread landmarks give three stops', `got ${stops.length}`);
  ok(
    stops.every((s, i) => i === 0 || s.alongM >= stops[i - 1]!.alongM),
    'stops come back in walking order',
    stops.map((s) => s.alongM).join(' → '),
  );
  ok(
    stops.every((s) => s.offRouteM <= 200),
    'no stop sits outside the corridor',
    stops.map((s) => `${s.name}:${s.offRouteM}m`).join(', '),
  );
  ok(
    stops.every((s) => s.alongM >= 120 && s.alongM <= 1080),
    'nothing is picked from the headroom at either end',
    stops.map((s) => `${s.name}@${s.alongM}m`).join(', '),
  );
  ok(
    !stops.some((s) => s.offRouteM > 800),
    'the far-off-route landmark is not a stop',
  );
}

// ---------------------------------------------------------------------
// Density: the old centre puts a dozen plaques on one square. A walk
// through it must still unfold along its length rather than spend every
// slot in its first block.
// ---------------------------------------------------------------------
{
  const path = [ORIGIN, at(2000, 0)];
  const pool = [
    // Eleven landmarks packed into the first 250 m…
    ...Array.from({ length: 11 }, (_, i) => poi(100 + i * 15, (i % 3) - 1)),
    // …and two out along the rest of the walk, further off the line.
    poi(1000, 120),
    poi(1700, -140),
  ];
  const stops = planStops({
    path,
    pool,
    corridorM: 200,
    maxStops: 3,
    minSpacingM: 240,
    maxDetourM: 600,
  });

  ok(stops.length === 3, 'a dense cluster does not cost the later slots', `got ${stops.length}`);
  const clustered = stops.filter((s) => s.alongM < 400).length;
  ok(clustered <= 1, 'at most one stop comes out of the cluster', `got ${clustered}`);
  ok(
    stops.every((s, i) => i === 0 || s.alongM - stops[i - 1]!.alongM >= 240),
    'stops keep their minimum spacing',
    stops.map((s) => s.alongM).join(' → '),
  );
}

// ---------------------------------------------------------------------
// The detour budget. Landmarks far off the line are droppable, and the
// planner has to drop them rather than return a "close" walk that is
// half again as long as the one that was asked for.
// ---------------------------------------------------------------------
{
  const path = [ORIGIN, at(1000, 0)];
  const pool = [poi(300, 320), poi(500, -330), poi(750, 340)];
  const budget = 300;
  const stops = planStops({
    path,
    pool,
    corridorM: 350,
    maxStops: 3,
    minSpacingM: 150,
    maxDetourM: budget,
  });
  const replotted = [path[0]!, ...waypointsThrough(path, stops)];
  const added = pathLengthM(replotted) - pathLengthM(path);
  ok(
    added <= budget + 1,
    'stops never add more walking than the detour budget',
    `added ${Math.round(added)} m against a ${budget} m budget with ${stops.length} stop(s)`,
  );
  ok(stops.length < 3, 'the budget actually drops something here', `kept ${stops.length}`);
}

// ---------------------------------------------------------------------
// Roundtrip. The path doubles back, so "along the walk" is the only
// ordering that makes sense — a landmark near the return leg has to be
// visited AFTER the far point, not on the way out.
// ---------------------------------------------------------------------
{
  const dest = at(800, 0);
  const via = at(400, 400); // the perpendicular nudge that varies the way home
  const path = [ORIGIN, dest, via, ORIGIN];
  const outbound = poi(400, -40, { name: 'outbound' });
  const homeward = poi(300, 350, { name: 'homeward' });
  const stops = planStops({
    path,
    pool: [outbound, homeward],
    corridorM: 200,
    maxStops: 2,
    minSpacingM: 150,
    maxDetourM: 500,
  });

  ok(stops.length === 2, 'both legs of a roundtrip get a stop', `got ${stops.length}`);
  const order = stops.map((s) => s.name).join(',');
  ok(order === 'outbound,homeward', 'the return-leg stop comes second', order);

  const waypoints = waypointsThrough(path, stops);
  const idx = (p: { lat: number; lng: number }) =>
    waypoints.findIndex((w) => distanceMeters(w, p) < 1);
  ok(
    idx(outbound) < idx(dest) && idx(dest) < idx(homeward),
    'the replotted walk goes out past one, turns, and comes home past the other',
    waypoints.map((w, i) => `${i}:${w.lat.toFixed(5)},${w.lng.toFixed(5)}`).join(' '),
  );
  ok(
    distanceMeters(waypoints[waypoints.length - 1]!, ORIGIN) < 1,
    'a roundtrip still ends where it started',
  );
}

// ---------------------------------------------------------------------
// The destination is not a stop on the way to itself.
//
// A real Troieshchyna walk found this: the walk ended at a church, and
// the same church came back as its first stop, so the dog offered to
// show the walker the place they were already walking to. The end
// headroom does not catch it, because a ROUNDTRIP's destination sits in
// the middle of the path, not at the end of it.
// ---------------------------------------------------------------------
{
  const dest = at(800, 0);
  const via = at(400, 400);
  const path = [ORIGIN, dest, via, ORIGIN];
  // The same church, as the gazetteer has it and as kyiv_lore has it —
  // two sources, one place, coordinates tens of metres apart.
  const asLandmark = poi(830, 25, { name: 'the destination itself' });
  const onTheWay = poi(400, -30, { name: 'genuinely on the way' });
  const stops = planStops({
    path,
    pool: [asLandmark, onTheWay],
    corridorM: 200,
    maxStops: 3,
    minSpacingM: 150,
    maxDetourM: 500,
  });
  ok(
    !stops.some((s) => s.name === 'the destination itself'),
    'a landmark sitting on the destination is not offered as a stop',
    stops.map((s) => s.name).join(', ') || '(none)',
  );
  ok(
    stops.some((s) => s.name === 'genuinely on the way'),
    'and the one actually on the way survives',
  );

  // Same rule at the turn: a roundtrip's via-point is a corner too.
  const onTheTurn = poi(400, 380, { name: 'on the turn' });
  const turnStops = planStops({
    path,
    pool: [onTheTurn],
    corridorM: 200,
    maxStops: 3,
    minSpacingM: 150,
    maxDetourM: 500,
  });
  ok(turnStops.length === 0, 'a landmark sitting on the turn is not a stop either');
}

// ---------------------------------------------------------------------
// Preference: given two equally convenient landmarks, take the one the
// walker can read more about.
// ---------------------------------------------------------------------
{
  const path = [ORIGIN, at(1000, 0)];
  const plain = poi(500, 30, { name: 'plain' });
  const linked = poi(520, 90, {
    name: 'linked',
    wikipediaTitle: 'Софійський собор',
    sourceLang: 'uk',
  });
  const stops = planStops({
    path,
    pool: [plain, linked],
    corridorM: 200,
    maxStops: 1,
    minSpacingM: 150,
    maxDetourM: 500,
  });
  ok(
    stops.length === 1 && stops[0]!.name === 'linked',
    'a landmark with a read-more wins a close call',
    stops.map((s) => s.name).join(','),
  );
  ok(
    stops[0]?.wikipediaTitle === 'Софійський собор' && stops[0]?.sourceLang === 'uk',
    'the read-more handles survive into the stop',
  );

  // The dog's own longer telling is a read-more too — a row enrich-lore
  // wrote a detail for, with no article behind it, is just as worth the
  // extra metres.
  const told = poi(520, 90, { name: 'told', hasDetail: true });
  const stops2 = planStops({
    path,
    pool: [poi(500, 30, { name: 'plain2' }), told],
    corridorM: 200,
    maxStops: 1,
    minSpacingM: 150,
    maxDetourM: 500,
  });
  ok(
    stops2.length === 1 && stops2[0]!.name === 'told',
    'a landmark with a detail wins the same close call',
    stops2.map((s) => s.name).join(','),
  );
}

// ---------------------------------------------------------------------
// Nothing to say. Every one of these has to come back empty rather than
// reach for something out of range — a walk with no landmarks near it is
// a normal walk, not an error.
// ---------------------------------------------------------------------
{
  const path = [ORIGIN, at(1000, 0)];
  ok(planStops({ path, pool: [], corridorM: 200, maxStops: 3, minSpacingM: 150, maxDetourM: 400 }).length === 0, 'an empty pool gives no stops');
  ok(
    planStops({
      path,
      pool: [poi(500, 900)],
      corridorM: 200,
      maxStops: 3,
      minSpacingM: 150,
      maxDetourM: 400,
    }).length === 0,
    'a landmark outside the corridor gives no stops',
  );
  ok(
    planStops({
      path: [ORIGIN, at(150, 0)],
      pool: [poi(75, 10)],
      corridorM: 200,
      maxStops: 3,
      minSpacingM: 150,
      maxDetourM: 400,
    }).length === 0,
    'a walk shorter than its own headroom gets no stops',
  );
  ok(
    planStops({
      path: [ORIGIN],
      pool: [poi(75, 10)],
      corridorM: 200,
      maxStops: 3,
      minSpacingM: 150,
      maxDetourM: 400,
    }).length === 0,
    'a path with one point gets no stops',
  );
}

// ---------------------------------------------------------------------
// With no stops, the replotted walk must be the walk that was planned.
// This is the path every landmark-poor district takes, and it has to be
// a no-op rather than a subtly different route.
// ---------------------------------------------------------------------
{
  const path = [ORIGIN, at(800, 0), at(400, 400), ORIGIN];
  const untouched = waypointsThrough(path, [] as LoreStop[]);
  ok(untouched.length === path.length - 1, 'no stops leaves the waypoint count alone');
  ok(
    untouched.every((w, i) => distanceMeters(w, path[i + 1]!) < 0.5),
    'no stops leaves every waypoint where it was',
  );
}

if (failures === 0) {
  console.log(`✓ ${checks} walk-stop expectations hold`);
} else {
  console.error(`\n✗ ${failures} of ${checks} expectations failed`);
  process.exit(1);
}
