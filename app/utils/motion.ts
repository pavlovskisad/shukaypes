// The OS "reduce motion" setting, read live.
//
// Three things in this app react to that setting, and until now each
// read it on its own terms: MapLibre checks it on every camera move,
// Reanimated snapshots it once at module load, and the repaint governor
// snapshotted it once per layer. A person who toggles the setting with
// the app open got three different answers. This is the one place the
// question is asked, and it tracks changes.
//
// What the setting MEANS here is decided by the callers — see
// components/map/camera.ts for the camera policy and D-61 in
// docs/project/05-decisions.md for the reasoning. In one line: fewer
// flourishes, never a hopping camera.

let mql: MediaQueryList | null | undefined;
let current = false;

function query(): MediaQueryList | null {
  if (mql !== undefined) return mql;
  try {
    mql =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
  } catch {
    mql = null;
  }
  if (mql) {
    current = mql.matches;
    try {
      mql.addEventListener('change', (e) => {
        current = e.matches;
      });
    } catch {
      /* an engine without addEventListener on MediaQueryList keeps the load-time value */
    }
  }
  return mql;
}

export function prefersReducedMotion(): boolean {
  query();
  return current;
}

// Shared timings. One sheet duration for every sheet: the top sheets
// and the map's deck ran 280 ms while the lost-pet sheet and the three
// list sheets ran 240, so two sheets opened back to back moved at
// visibly different speeds. Each sheet's unmount timer reads the same
// number as its animation, so they cannot drift apart either.
export const MOTION = {
  sheetMs: 280,
} as const;

// Spread onto an RN <View> whose CSS animation is an endless loop, so
// the reduce-motion rule in public/index.html (`[data-loop]`) stills
// it. RN-web renders `dataSet` as data-* attributes; RN's own types do
// not know the prop, hence the cast. Plain DOM elements just take a
// `data-loop` attribute.
export const LOOP_VIEW_PROPS = { dataSet: { loop: 'true' } } as object;
