import { memo } from 'react';
import type { LatLng } from '@shukajpes/shared';
import { MapLibreMarker } from './MapLibreMarker';

// Deterministic 0..1 phase from the item's position so bones bob on their
// own offset rather than all together. Slightly longer cycle than paws so
// the two item types don't lockstep. Negative delay starts mid-cycle.
function bobDelay(p: LatLng): number {
  const h = Math.abs(p.lat * 12_911 + p.lng * 50_021) % 1000;
  return -((h / 1000) * 2.8);
}

// 🦴 bone — a live game pickup matching the paw treatment: gentle float,
// soft ground shadow, warm amber glow. Memoized — ~8 render but the map
// re-renders on every pan. `inverted` flips the silhouette to white on
// sniff mode's dark map.
function FoodMarkerImpl({
  position,
  onTap,
  inverted = false,
}: {
  position: LatLng;
  onTap: () => void;
  inverted?: boolean;
}) {
  const filter = inverted
    ? 'invert(1) drop-shadow(0 0 5px rgba(255,255,255,0.55))'
    : 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.3)) drop-shadow(0 0 5px rgba(245,180,70,0.8))';
  return (
    <MapLibreMarker position={position} onClick={onTap} cullNearHorizon>
      <div
        role="button"
        tabIndex={0}
        aria-label="bone"
        style={{ position: 'relative', width: 24, height: 24, cursor: 'pointer', userSelect: 'none' }}
      >
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: '50%',
            bottom: -3,
            width: 14,
            height: 4,
            transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.18)',
            borderRadius: '50%',
            filter: 'blur(1.5px)',
            pointerEvents: 'none',
          }}
        />
        <div
          style={{
            width: 24,
            height: 24,
            backgroundImage: 'url(/icons/bone.svg)',
            backgroundRepeat: 'no-repeat',
            backgroundSize: 'contain',
            filter,
            animation: `collectible-bob 2.8s ease-in-out ${bobDelay(position)}s infinite`,
            willChange: 'transform',
          }}
        />
      </div>
    </MapLibreMarker>
  );
}

export const FoodMarker = memo(FoodMarkerImpl);
