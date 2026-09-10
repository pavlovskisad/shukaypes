// A throttle for the layers that ask the map to redraw itself.
//
// Two of the custom layers animate — the sun's rays in the game render's
// ground fog, and the drifting particles in the classic fog — and an
// animating custom layer has no frame loop of its own: it asks MapLibre
// for the next frame from inside the current one. That request redraws
// the WHOLE map, every tile and every building, and until now it was
// made on a fixed timer whenever the effect was on screen — 20 frames a
// second for the sun, 30 for the classic fog, for as long as the map tab
// was open. On a flagship that is warmth in the pocket; on a four-year-
// old Android, which is exactly the device the classic fallback exists
// for, it is a phone that cannot keep up with its own map, and a
// battery that does not last the walk.
//
// This module makes the request adaptive, in three ways:
//
//   1. It measures whether the frame it asked for arrived on time. A
//      frame that lands well after the timer fired means the main thread
//      or the GPU was still busy with the last one, so the next request
//      waits longer — up to six times the base interval. Frames that
//      arrive promptly let it creep back. A phone that can do 20fps gets
//      20fps; a phone that cannot is not asked to.
//   2. It honours prefers-reduced-motion. The user has said they do not
//      want things moving; the sun holds still. (Camera moves still
//      repaint — that is the map, not an animation. What the setting
//      does to the camera itself is a separate policy: camera.ts.)
//   3. It goes quiet when the tab is hidden and wakes the animation when
//      it comes back. setTimeout is already clamped in a background tab,
//      but "clamped" is still a redraw a second for a screen nobody sees.
//
// One governor per layer, created in onAdd and disposed in onRemove.

import type { Map as MlMap } from 'maplibre-gl';
import { prefersReducedMotion } from '../../utils/motion';

export interface RepaintGovernor {
  /** Ask for another frame, subject to the throttle. Safe to call every frame. */
  request(): void;
  /** Call at the top of the layer's render() so the governor can time its frames. */
  noteRender(): void;
  dispose(): void;
}

// A frame more than this late counts as the device falling behind.
const LATE_MS = 40;
// Below this it is keeping up comfortably and the interval can shrink again.
const PROMPT_MS = 12;
const MAX_FACTOR = 6;

function hidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

export function createRepaintGovernor(map: MlMap, baseMs: number): RepaintGovernor {
  let timer: ReturnType<typeof setTimeout> | null = null;
  // When the timer fired and asked the map for a frame; 0 when no frame
  // of ours is outstanding.
  let firedAt = 0;
  let factor = 1;
  // Smoothed lateness, so one hitch (a GC pause, a tile decode) does not
  // throttle the animation and one quick frame does not un-throttle it.
  let late = 0;
  let disposed = false;

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  const fire = () => {
    timer = null;
    if (disposed || hidden()) return;
    firedAt = now();
    try {
      map.triggerRepaint();
    } catch {
      /* map tearing down */
    }
  };

  // Coming back to the tab: one repaint restarts the loop, since the
  // layer only asks for the next frame from inside a frame.
  const onVisible = () => {
    if (!hidden() && !disposed && timer == null) fire();
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisible);
  }

  return {
    request() {
      // Read live, not snapshotted: toggling the setting with the map
      // open takes effect on the next frame.
      if (disposed || prefersReducedMotion() || timer != null || hidden()) return;
      timer = setTimeout(fire, baseMs * factor);
    },
    noteRender() {
      if (!firedAt) return;
      const lateness = now() - firedAt;
      firedAt = 0;
      late = late * 0.7 + lateness * 0.3;
      if (late > LATE_MS) factor = Math.min(MAX_FACTOR, factor * 1.5);
      else if (late < PROMPT_MS) factor = Math.max(1, factor * 0.9);
    },
    dispose() {
      disposed = true;
      if (timer != null) clearTimeout(timer);
      timer = null;
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisible);
      }
    },
  };
}
