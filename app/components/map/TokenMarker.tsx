import { memo } from 'react';
import type { LatLng } from '@shukajpes/shared';
import { MapLibreMarker } from './MapLibreMarker';

// 🐾 token with lime glow (demo line 319 / TO class). Memoized — ~30 of
// these render, map re-renders on every pan. `inverted` flips the
// black silhouette to white via CSS filter when sniff mode + dark
// map are active, so the paws don't disappear into the dark land.
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
    <MapLibreMarker position={position} onClick={onTap}>
      {/* Footprint sized to read at zoom 16 — small enough that a
          cluster reads as a trail of paws, big enough that a single
          token is obviously tappable on touch. Slightly under the
          bone marker (24) since paws are denser. */}
      <div
        role="button"
        tabIndex={0}
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
    </MapLibreMarker>
  );
}

export const TokenMarker = memo(TokenMarkerImpl);
