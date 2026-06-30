import { memo } from 'react';
import type { LatLng } from '@shukajpes/shared';
import { MapLibreMarker } from './MapLibreMarker';

// Deterministic 0..1 phase from the item's position so every collectible
// bobs on its own offset instead of the whole field pulsing in unison.
// Negative animation-delay starts it mid-cycle immediately (no wait).
function bobDelay(p: LatLng): number {
  const h = Math.abs(p.lat * 73_856 + p.lng * 19_349) % 1000;
  return -((h / 1000) * 2.4);
}

// 🐾 paw token — a live game pickup, not a flat decal: floats with a
// gentle bob, casts a soft ground shadow, and carries a lime glow so it
// reads as collectible at a glance. Memoized — ~30 render and the map
// re-renders on every pan. `inverted` flips the black silhouette to
// white via CSS filter on sniff mode's dark map.
function TokenMarkerImpl({
  position,
  onTap,
  inverted = false,
}: {
  position: LatLng;
  onTap: () => void;
  inverted?: boolean;
}) {
  // Glow lives in the filter chain with the optional invert. On the dark
  // sniff map a white halo lifts the paw off the ground; on the light map
  // a lime glow + faint drop shadow give it the "pickup" sheen.
  const filter = inverted
    ? 'invert(1) drop-shadow(0 0 5px rgba(255,255,255,0.55))'
    : 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.3)) drop-shadow(0 0 4px rgba(150,220,70,0.75))';
  return (
    <MapLibreMarker position={position} onClick={onTap} cullNearHorizon>
      {/* Wrapper is the tap-pop target (MapLibreMarker pops firstChild);
          keeping the bob on the inner icon avoids fighting that scale. */}
      <div
        role="button"
        tabIndex={0}
        aria-label="paw token"
        style={{ position: 'relative', width: 22, height: 22, cursor: 'pointer', userSelect: 'none' }}
      >
        {/* Soft ground shadow — sells the floating-above-ground look. */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: '50%',
            bottom: -3,
            width: 13,
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
            width: 22,
            height: 22,
            backgroundImage: 'url(/icons/paws.svg)',
            backgroundRepeat: 'no-repeat',
            backgroundSize: 'contain',
            filter,
            animation: `collectible-bob 2.4s ease-in-out ${bobDelay(position)}s infinite`,
            willChange: 'transform',
          }}
        />
      </div>
    </MapLibreMarker>
  );
}

export const TokenMarker = memo(TokenMarkerImpl);
