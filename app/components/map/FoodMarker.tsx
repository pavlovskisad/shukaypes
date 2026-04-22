import { memo } from 'react';
import { OverlayViewF, FLOAT_PANE } from '@react-google-maps/api';
import type { LatLng } from '@shukajpes/shared';

// 🦴 bone with warm amber glow (demo line 353). Memoized — ~8 of these
// render but the map re-renders on every pan so it's still worth it.
function FoodMarkerImpl({ position, onTap }: { position: LatLng; onTap: () => void }) {
  return (
    <OverlayViewF
      position={position as unknown as google.maps.LatLngLiteral}
      mapPaneName={FLOAT_PANE}
      getPixelPositionOffset={() => ({ x: -12, y: -12 })}
    >
      {/* text-shadow instead of filter:drop-shadow — same paint-cost
          reasoning as TokenMarker. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onTap}
        style={{
          width: 24,
          height: 24,
          fontSize: 18,
          lineHeight: '24px',
          textAlign: 'center',
          cursor: 'pointer',
          textShadow: '0 0 6px rgba(255,200,100,0.6), 0 0 10px rgba(255,200,100,0.35)',
          userSelect: 'none',
        }}
      >
        🦴
      </div>
    </OverlayViewF>
  );
}

export const FoodMarker = memo(FoodMarkerImpl);
