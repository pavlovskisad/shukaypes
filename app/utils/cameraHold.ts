// WHEN THE CAMERA MAY NOT MOVE ITSELF.
//
// The map has two things that take the camera away from whatever the
// walker is looking at, and both are right to exist:
//
//   THE FOLLOW. In explore and territory view the camera glides back to
//   the dog, so a walk never leaves you staring at where you were.
//   A gesture or a one-shot command (a planned route, a district jumped
//   to from the standing) buys a grace window — but a window is a
//   timer, and a timer expires while somebody is still reading. It is
//   8 seconds.
//
//   THE HINTS. Each chained map hint snaps the camera to the dog so the
//   bubble lands framed, wherever the dog had drifted.
//
// Both were gated on a hand-written list of "is the user busy", and
// there were TWO such lists, in two places, which had already drifted
// apart: the follow's held nine things, the hints' held seven, and
// NEITHER held another walker's card (D-73) or a pet's advert. The
// advert is the worst of them, because the handler that opens it does
// `setSelectedDog(null)` on the way in — it releases the one flag that
// was holding the camera, at the exact moment it puts up the longest
// read in the app.
//
// So: one list, and a shape that will not let the next surface be
// forgotten. Every field is REQUIRED, so a new overlay that is not
// named here fails to compile at the call site rather than silently
// joining the ones the camera ignores. Adding the field is the whole
// of remembering.
//
// Pure, and fixture-checked (`pnpm check` in app/), because the two
// bugs this replaces were both invisible to a careful reading of the
// condition: nothing looks wrong about a list, only about what is
// missing from it.

export interface ReadingSurfaces {
  /** A lost pet's card is up (gameStore.selectedDogId). */
  lostPetCard: boolean;
  /** The owner's advert for that pet is up (MapView postDog). Reached
   *  from the card, which CLOSES itself on the way — so this flag is
   *  the only one left holding the camera while it is read. */
  petAdvert: boolean;
  /** A saved place's sheet is up (gameStore.selectedSpotId). */
  spotCard: boolean;
  /** A stop on a planned walk is open, with its story and its
   *  «read more» (gameStore.openWalkStopId). */
  walkStop: boolean;
  /** A sniff-press discovery is on the map — the landmark bubble and
   *  its «read more» (gameStore.sniffActive). Also covers a landmark
   *  opened from the saved list, which routes through the same
   *  discovery state. */
  loreDiscovery: boolean;
  /** Another walker's card is up (MapView cardPlayer). */
  walkerCard: boolean;
  /** A stranger's district is pinned and being looked at — the jump
   *  from the standing, or a tap on their dog (gameStore.pinnedGuest).
   *  Retires itself on going away or leaving the map (D-91), so it
   *  cannot hold the camera indefinitely. */
  pinnedDistrict: boolean;
  /** «what is this app» is open (gameStore.aboutOpen). */
  about: boolean;
  /** The report-a-lost-pet flow is open (gameStore.lostFlowOpen). */
  lostPetFlow: boolean;
  /** The account sheet is up (accessStore.doorSheet). */
  accountDoor: boolean;
}

/**
 * Is the walker reading or answering something on the map right now?
 *
 * True means the camera must not move itself — no follow tick, no hint
 * snap — until it is closed.
 */
export function isReading(s: ReadingSurfaces): boolean {
  return (
    s.lostPetCard ||
    s.petAdvert ||
    s.spotCard ||
    s.walkStop ||
    s.loreDiscovery ||
    s.walkerCard ||
    s.pinnedDistrict ||
    s.about ||
    s.lostPetFlow ||
    s.accountDoor
  );
}

/** Nothing open. Exported for the fixture check and as the base a
 *  caller spreads over, so a new field cannot be left undefined. */
export const NOTHING_OPEN: ReadingSurfaces = {
  lostPetCard: false,
  petAdvert: false,
  spotCard: false,
  walkStop: false,
  loreDiscovery: false,
  walkerCard: false,
  pinnedDistrict: false,
  about: false,
  lostPetFlow: false,
  accountDoor: false,
};
