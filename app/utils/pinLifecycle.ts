// WHEN THE DOG YOU JUMPED TO IS LET GO.
//
// Tapping a row on the standing pins that owner's dog and their ground
// (gameStore.pinnedGuest) so the jump lands on something: presence only
// carries dogs that are ONLINE, and the map's sync is centred on the
// walker, so a far offline owner has neither a sprite nor a district
// without this.
//
// The rule reads as one sentence — "keep it until you go away" — and it
// shipped wrong twice, both times because the state it reads is not true
// yet at the moment the pin is set. Hence a pure function with a fixture
// check (`pnpm check:pin`) rather than a condition inlined in an effect:
//
//   1. The pin is set on the TASKS tab, and MapView stays mounted behind
//      the other tabs. A bare "clear when off the map" fires instantly,
//      before the router has even navigated. So leaving the map only
//      counts once the pin has BEEN on the map.
//
//   2. viewportCenter comes from mapBounds, which only updates when the
//      map settles. At the instant of the pin it still holds the old
//      centre — beside the walker, far from the district being flown to
//      — so a bare distance test retires the pin mid-flight. The jump
//      then arrives at a dog with no ground, or at nothing at all, and a
//      SECOND tap appears to fix it only because the first left the
//      viewport near the dog. So going away only counts once the camera
//      has ARRIVED.
//
// Both are the same shape: a latch has to be set before the condition
// that reads it can mean anything.

export interface PinLifecycle {
  /** The pin has been on screen with the map focused. */
  seenOnMap: boolean;
  /** The camera has actually been within keepM of it. */
  arrived: boolean;
}

export const PIN_START: PinLifecycle = { seenOnMap: false, arrived: false };

export interface PinInput {
  onMapScreen: boolean;
  /**
   * Metres from the viewport centre to the pinned dog, or null when the
   * map has not published bounds yet. Null is "no opinion", never "far".
   */
  distanceM: number | null;
  keepM: number;
}

/**
 * One step of the pin's life. Returns the next latch state and whether
 * the pin should be let go now.
 */
export function stepPin(
  prev: PinLifecycle,
  input: PinInput,
): { next: PinLifecycle; retire: boolean } {
  const { onMapScreen, distanceM, keepM } = input;

  if (!onMapScreen) {
    // Gone from the map — but only a pin that got there can be retired
    // for leaving. Before that this is just the tab it was set from.
    return { next: prev, retire: prev.seenOnMap };
  }

  const next: PinLifecycle = { ...prev, seenOnMap: true };

  // No bounds yet: hold. A pin is never dropped on missing information.
  if (distanceM == null) return { next, retire: false };

  if (distanceM <= keepM) return { next: { ...next, arrived: true }, retire: false };

  // Outside the radius. That is "away" only if we were ever there; until
  // then it is the stale pre-flight viewport.
  return { next, retire: prev.arrived };
}
