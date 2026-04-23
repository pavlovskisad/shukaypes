import { memo } from 'react';
import { OverlayViewF, FLOAT_PANE } from '@react-google-maps/api';
import type { LatLng } from '@shukajpes/shared';

// 🐾 token with lime glow (demo line 319 / TO class). Memoized — ~30 of
// these render, map re-renders on every pan.
function TokenMarkerImpl({ position, onTap }: { position: LatLng; onTap: () => void }) {
  return (
    <OverlayViewF
      position={position as unknown as google.maps.LatLngLiteral}
      mapPaneName={FLOAT_PANE}
      getPixelPositionOffset={() => ({ x: -8, y: -8 })}
    >
      {/* Small footprint — literal tiny pawprints the walker picks up.
          40% smaller than before so a cluster of them reads as a trail
          rather than a grid of emoji badges. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onTap}
        style={{
          width: 16,
          height: 16,
          fontSize: 13,
          lineHeight: '16px',
          textAlign: 'center',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        🐾
      </div>
    </OverlayViewF>
  );
}

export const TokenMarker = memo(TokenMarkerImpl);
