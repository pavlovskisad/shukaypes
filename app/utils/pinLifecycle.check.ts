// Fixture check for the pinned-guest lifecycle (utils/pinLifecycle.ts).
// Replays the exact sequence a real tap produces, because both bugs this
// file exists to prevent were sequence bugs that every static reading of
// the condition looked fine. Run with `pnpm check:pin`. No network, no
// database, no React.

import { PIN_START, stepPin, type PinLifecycle, type PinInput } from './pinLifecycle.js';

function fail(msg: string): never {
  console.error(`✗ pin: ${msg}`);
  process.exit(1);
}

const KEEP = 1500;

/** Run a sequence; returns the step index that retired, or -1. */
function replay(steps: Omit<PinInput, 'keepM'>[]): number {
  let st: PinLifecycle = PIN_START;
  for (let i = 0; i < steps.length; i++) {
    const r = stepPin(st, { ...steps[i]!, keepM: KEEP });
    if (r.retire) return i;
    st = r.next;
  }
  return -1;
}

// ------------------------------------------------- the real tap, in order

// THE BUG THAT SHIPPED. Tap on the tasks tab (map not focused yet), with
// viewportCenter still holding the walker's own neighbourhood 6 km from
// the district being flown to. Then the router navigates, then the ease
// settles and bounds finally publish near the dog.
const firstTap = replay([
  { onMapScreen: false, distanceM: 6000 }, // set on the tasks tab
  { onMapScreen: false, distanceM: 6000 }, // router still navigating
  { onMapScreen: true, distanceM: 6000 }, // map focused, viewport STALE
  { onMapScreen: true, distanceM: null }, // bounds invalidated mid-ease
  { onMapScreen: true, distanceM: 40 }, // arrived
]);
if (firstTap !== -1) fail(`a fresh tap retired at step ${firstTap} — it must survive the flight`);

// And having arrived, panning home lets it go.
const thenHome = replay([
  { onMapScreen: false, distanceM: 6000 },
  { onMapScreen: true, distanceM: 6000 },
  { onMapScreen: true, distanceM: 40 }, // arrived
  { onMapScreen: true, distanceM: 900 }, // still in range, pan around
  { onMapScreen: true, distanceM: 4000 }, // gone home
]);
if (thenHome !== 4) fail(`panning home should retire at step 4, got ${thenHome}`);

// Leaving the map retires it — but only after it has been on the map.
const leftMap = replay([
  { onMapScreen: false, distanceM: 6000 },
  { onMapScreen: true, distanceM: 40 },
  { onMapScreen: false, distanceM: 40 }, // switched to another tab
]);
if (leftMap !== 2) fail(`leaving the map should retire at step 2, got ${leftMap}`);

// A tap that never leaves the tasks tab is never retired by that tab.
if (replay([{ onMapScreen: false, distanceM: 10 }, { onMapScreen: false, distanceM: 9000 }]) !== -1) {
  fail('a pin still on the tasks tab must not retire itself');
}

// Missing bounds are never "far".
if (replay([{ onMapScreen: true, distanceM: null }, { onMapScreen: true, distanceM: null }]) !== -1) {
  fail('null distance must hold the pin, not drop it');
}

// Arrival is sticky across a null: bounds going away mid-pan must not
// make a pin un-retirable afterwards.
const nullAfterArrival = replay([
  { onMapScreen: true, distanceM: 40 }, // arrived
  { onMapScreen: true, distanceM: null }, // bounds momentarily gone
  { onMapScreen: true, distanceM: 5000 }, // away
]);
if (nullAfterArrival !== 2) fail(`arrival must survive a null, expected retire at 2, got ${nullAfterArrival}`);

// The boundary itself: exactly at the radius is still "here".
if (replay([{ onMapScreen: true, distanceM: KEEP }, { onMapScreen: true, distanceM: KEEP }]) !== -1) {
  fail('exactly keepM must count as arrived');
}
if (replay([{ onMapScreen: true, distanceM: KEEP }, { onMapScreen: true, distanceM: KEEP + 1 }]) !== 1) {
  fail('one metre past keepM after arriving must retire');
}

// A pin set while already standing on the district (you tapped a
// neighbour) arrives immediately and behaves normally.
const alreadyThere = replay([
  { onMapScreen: true, distanceM: 200 },
  { onMapScreen: true, distanceM: 2000 },
]);
if (alreadyThere !== 1) fail(`a near pin should retire on leaving, got ${alreadyThere}`);

console.log(
  '✓ pin: survives the flight from a stale viewport, retires on going away or leaving the map, never on missing bounds',
);
