import { memo } from 'react';
import type { LatLng } from '@shukajpes/shared';
import { MapLibreMarker } from './MapLibreMarker';

// 🦴 bone with warm amber glow (demo line 353). Memoized — ~8 of these
// render but the map re-renders on every pan so it's still worth it.
// `inverted` flips the black silhouette to white when sniff mode is
// on and the map is on the dark style, so bones don't vanish.
function FoodMarkerImpl({
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
      {/* No glow, no animation — keep it light for the paint budget. */}
      <div
        role="button"
        tabIndex={0}
        aria-label="bone"
        style={{
          width: 24,
          height: 24,
          backgroundImage: 'url(/icons/bone.svg)',
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

export const FoodMarker = memo(FoodMarkerImpl);
