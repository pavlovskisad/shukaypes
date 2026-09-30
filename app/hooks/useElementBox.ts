import { useLayoutEffect, useState } from 'react';

// The bottom edge (viewport px) and height of the element with this DOM
// id, kept current as it RESIZES. null while `id` is null or no such
// element exists.
//
// ResizeObserver reports size, not position: `bottom` is right for an
// element that does not move (the HUD rows are pinned under the safe
// area), and a caller whose element moves should use `height`.
//
// By id rather than by ref because the rows the map's overlays have to
// clear are rendered by a SIBLING of MapView (the HUD in
// app/(tabs)/index.tsx), which MapView holds no ref to. Looked up in a
// layout effect, i.e. after the commit, so a sibling mounted in the same
// render is already there. Pass null while the thing is not rendered so
// the lookup runs again when it is.
//
// Measured rather than assumed because these rows grow: the quest pill
// wraps a long pet name onto a second line, and the pill row wraps when
// a walk, a quest and a GPS status are all live on a 320px screen.
export interface ElementBox {
  bottom: number;
  height: number;
}

export function useElementBox(id: string | null): ElementBox | null {
  const [box, setBox] = useState<ElementBox | null>(null);
  useLayoutEffect(() => {
    const el = id && typeof document !== 'undefined' ? document.getElementById(id) : null;
    if (!el) {
      setBox(null);
      return;
    }
    const read = () => {
      const r = el.getBoundingClientRect();
      setBox((prev) =>
        prev && prev.bottom === r.bottom && prev.height === r.height
          ? prev
          : { bottom: r.bottom, height: r.height },
      );
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [id]);
  return box;
}
