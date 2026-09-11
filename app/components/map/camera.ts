// Every camera move in the app goes through here, so that what the OS
// "reduce motion" setting does to the map is one policy rather than
// twenty-one call sites' worth of accident.
//
// THE ACCIDENT IT REPLACES. MapLibre honours prefers-reduced-motion by
// itself: any easeTo without `essential: true` has its duration forced
// to zero. That is the right default for a web page and the wrong one
// for a chase camera. Supersniff keeps the camera on the dog by issuing
// one easeTo per tick, each lasting exactly one tick with a linear
// curve, so successive calls chain into a continuous glide. With the
// setting on, every one of those became an instant hop — the camera
// stuttered across the map at the tick rate, which is more motion, not
// less, for the person who asked for less. Every other camera move in
// the app snapped too, for the same reason.
//
// THE POLICY. Reduce-motion guidance (Apple's, and WCAG 2.3.3) is to
// remove non-essential, sweeping movement — not to make the interface
// jump. So moves are one of three kinds:
//
//   follow    The camera tracking the dog, tick by tick. Essential:
//             always smooth, because the alternative is the hop.
//   short     A recentre or a nudge of under about a second, with no
//             big change of pitch or zoom. Essential too: a 400ms slide
//             to the dog is not the kind of motion the setting is about,
//             and a snap here reads as a glitch.
//   cinematic The swings: entering and leaving supersniff (pitch and
//             zoom together), the dog view FIRST pulling up over a pet,
//             the cross-city jump to a territory or a poke. These are
//             exactly the sweeping moves the setting exists for, so under
//             reduce motion they become a clean cut — the same end state,
//             no journey. A cut for a one-off transition is what a
//             reduce-motion user expects; a hopping chase is not.
//
// A move the FINGER asked for is never cinematic. Swiping the pet carousel
// to the next pet, or the supersniff fragment carousel to the next spot,
// re-aims a camera that is already in that view; it continues the gesture
// and is `short`. The call sites decide by whether the view was already
// open — the same rule the card stack applies to its own settle.
//
// With the setting off, all three are plain easeTo and nothing changes.
//
// MapLibre itself is constructed with `reduceMotion: false` (MapView), so
// it never second-guesses a move on its own — that also keeps drag-pan
// inertia, which it would otherwise drop under the setting. The
// `essential` flag below is therefore belt-and-braces rather than the
// mechanism; the policy lives in this file and nowhere else.

import type { Map as MlMap, EaseToOptions } from 'maplibre-gl';
import { prefersReducedMotion } from '../../utils/motion';

export type CameraMoveKind = 'follow' | 'short' | 'cinematic';

export function easeCamera(
  map: MlMap | null | undefined,
  kind: CameraMoveKind,
  opts: EaseToOptions,
): void {
  if (!map) return;
  if (!prefersReducedMotion()) {
    map.easeTo(opts);
    return;
  }
  // `essential` stops MapLibre from zeroing the duration on its own; the
  // cut is a zero duration WE choose. Done as easeTo rather than jumpTo
  // so `offset` and `padding` — which jumpTo does not take — still land
  // the target where the caller framed it.
  map.easeTo({
    ...opts,
    essential: true,
    ...(kind === 'cinematic' ? { duration: 0 } : {}),
  });
}
