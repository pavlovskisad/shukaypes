import { memo } from 'react';
import { OverlayViewF, FLOAT_PANE } from '@react-google-maps/api';
import type { LatLng } from '@shukajpes/shared';

// 🦴 bone with warm amber glow (demo line 353). Memoized — ~8 of these
// render but the map re-renders on every pan so it's still worth it.
// Sniff mode's "white on dark" appearance is now produced by an
// app-wide body filter (see app/_layout.tsx), so the per-marker
// `inverted` prop is gone.
function FoodMarkerImpl({ position, onTap }: { position: LatLng; onTap: () => void }) {
  return (
    <OverlayViewF
      position={position as unknown as google.maps.LatLngLiteral}
      mapPaneName={FLOAT_PANE}
      getPixelPositionOffset={() => ({ x: -12, y: -12 })}
    >
      {/* No glow, no animation — keep it light for the paint budget. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onTap}
        aria-label="bone"
        style={{
          width: 24,
          height: 24,
          backgroundImage: 'url(/icons/bone.svg)',
          backgroundRepeat: 'no-repeat',
          backgroundSize: 'contain',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      />
    </OverlayViewF>
  );
}

export const FoodMarker = memo(FoodMarkerImpl);
