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
