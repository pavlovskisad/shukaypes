// Fixture check for the camera hold (utils/cameraHold.ts). Run with
// `pnpm check`. No network, no database, no React.
//
// The point of this file is not that `||` works. It is that EVERY
// surface the walker can read on the map is in the list — the two that
// were missing had been missing for weeks, and every reading of the
// condition looked fine, because a list only looks wrong once you know
// what is not in it.
//
// So the check walks the type: it asserts that each key of
// ReadingSurfaces, on its own, holds the camera. A field added to the
// interface and forgotten in isReading fails here.

import { isReading, NOTHING_OPEN, type ReadingSurfaces } from './cameraHold.js';

function fail(msg: string): never {
  console.error(`✗ camera: ${msg}`);
  process.exit(1);
}

// Nothing open — the camera is free to follow the dog. That is the
// whole point of the follow, and a hold that never releases is as
// broken as one that never holds.
if (isReading(NOTHING_OPEN)) fail('an empty map must not hold the camera');

// Every surface, one at a time.
const keys = Object.keys(NOTHING_OPEN) as (keyof ReadingSurfaces)[];
if (keys.length < 10) fail(`expected at least 10 surfaces, found ${keys.length}`);
for (const k of keys) {
  if (!isReading({ ...NOTHING_OPEN, [k]: true })) {
    fail(`${k} is in ReadingSurfaces but isReading ignores it — the camera will snap while it is open`);
  }
}

// The sequences that shipped broken, spelled out, so the regression
// has a name and not just a field.

// THE ADVERT. Tapping «read the advert» on a lost pet's card closes the
// card on the way in (MapView onOpenPost: setSelectedDog(null), then
// setPostDog). For one commit the card's flag is already false and the
// advert's is not yet true; from then on the advert alone is what holds
// the camera. Before this file it held nothing, and the longest read in
// the app was the one the camera interrupted.
if (!isReading({ ...NOTHING_OPEN, petAdvert: true })) {
  fail('the pet advert must hold the camera on its own — the card that opened it has already closed');
}

// ANOTHER WALKER. Tapped from the standing or on the map: the card, the
// pin, or both. Each alone has to hold.
if (!isReading({ ...NOTHING_OPEN, walkerCard: true })) fail("another walker's card must hold the camera");
if (!isReading({ ...NOTHING_OPEN, pinnedDistrict: true })) {
  fail('a pinned district must hold the camera — the jump from the standing opens no card');
}

// THE LANDMARK. Both ways in — a long press on the map, and a saved
// place opened from the list — land in the same discovery state, so one
// flag covers the pair.
if (!isReading({ ...NOTHING_OPEN, loreDiscovery: true })) fail('a landmark discovery must hold the camera');
if (!isReading({ ...NOTHING_OPEN, walkStop: true })) fail("a walk stop's story must hold the camera");

console.log(
  `✓ camera: all ${keys.length} reading surfaces hold it, an empty map does not`,
);
