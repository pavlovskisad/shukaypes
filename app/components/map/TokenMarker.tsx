import { memo } from 'react';
import { OverlayViewF, FLOAT_PANE } from '@react-google-maps/api';
import type { LatLng } from '@shukajpes/shared';

// 🐾 token with lime glow (demo line 319 / TO class). Memoized — ~30 of
// these render, map re-renders on every pan. Sniff mode's "white on
// dark" appearance is now produced by an app-wide body filter (see
// app/_layout.tsx), so the per-marker `inverted` prop is gone.
function TokenMarkerImpl({ position, onTap }: { position: LatLng; onTap: () => void }) {
  return (
    <OverlayViewF
      position={position as unknown as google.maps.LatLngLiteral}
      mapPaneName={FLOAT_PANE}
      getPixelPositionOffset={() => ({ x: -11, y: -11 })}
    >
      {/* Footprint sized to read at zoom 16 — small enough that a
          cluster reads as a trail of paws, big enough that a single
          token is obviously tappable on touch. Slightly under the
          bone marker (24) since paws are denser. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onTap}
        aria-label="paw token"
        style={{
          width: 22,
          height: 22,
          backgroundImage: 'url(/icons/paws.svg)',
          backgroundRepeat: 'no-repeat',
          backgroundSize: 'contain',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      />
    </OverlayViewF>
  );
}

export const TokenMarker = memo(TokenMarkerImpl);
