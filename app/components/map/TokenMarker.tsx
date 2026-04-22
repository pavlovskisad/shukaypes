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
          filter: 'drop-shadow(0 0 6px rgba(200,255,0,0.6))',
          animation: 'tok-float 2s ease-in-out infinite',
          userSelect: 'none',
        }}
      >
        🐾
        <style>{`
          @keyframes tok-float {
            0%, 100% { transform: translateY(0) scale(1); }
            50% { transform: translateY(-2px) scale(1.02); }
          }
        `}</style>
      </div>
    </OverlayViewF>
  );
}

export const TokenMarker = memo(TokenMarkerImpl);
