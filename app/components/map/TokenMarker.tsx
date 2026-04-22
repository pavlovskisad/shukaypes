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
      getPixelPositionOffset={() => ({ x: -13, y: -13 })}
    >
      {/* No glow, no animation — tokens are static collectibles, low
          paint cost so the map scrolls smoothly. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onTap}
        style={{
          width: 26,
          height: 26,
          fontSize: 20,
          lineHeight: '26px',
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
