import { memo } from 'react';
import { OverlayViewF, FLOAT_PANE } from '@react-google-maps/api';
import type { LatLng } from '@shukajpes/shared';

// 🐾 token with lime glow (demo line 319 / TO class). Memoized — ~30 of
// these render, map re-renders on every pan. `inverted` is set when
// sniff mode is on and the map is on the dark style — black-ink paw
// silhouettes would disappear into the dark land fill, so we CSS-
// invert them to white via `filter: invert(1)`.
function TokenMarkerImpl({
  position,
  onTap,
  inverted = false,
}: {
  position: LatLng;
  onTap: () => void;
  inverted?: boolean;
}) {
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
          filter: inverted ? 'invert(1)' : undefined,
          cursor: 'pointer',
          userSelect: 'none',
        }}
      />
    </OverlayViewF>
  );
}

export const TokenMarker = memo(TokenMarkerImpl);
