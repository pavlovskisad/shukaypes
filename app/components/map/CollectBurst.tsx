import { memo } from 'react';
import type { LatLng } from '@shukajpes/shared';
import { MapLibreMarker } from './MapLibreMarker';

// One-shot pickup celebration anchored at a collected paw/bone's spot:
// a shockwave ring, the icon popping up + swelling as it fades, and a
// rising "+1". Purely visual — pointer-events off — and self-expiring
// (the parent drops it from its list once the animation is done). The
// @keyframes (collect-burst-ring / -icon / -plus) live in MapView's
// global <style> block so each burst doesn't ship its own copy.
function CollectBurstImpl({
  position,
  kind,
}: {
  position: LatLng;
  kind: 'paw' | 'bone';
}) {
  const icon = kind === 'paw' ? '/icons/paws.svg' : '/icons/bone.svg';
  const accent = kind === 'paw' ? 'rgba(120,205,60,0.9)' : 'rgba(245,175,55,0.95)';
  const size = kind === 'paw' ? 22 : 24;
  return (
    <MapLibreMarker position={position}>
      {/* Zero-size box pinned on the point (center anchor); each child
          centers itself via the keyframe's translate(-50%, …). */}
      <div style={{ position: 'relative', width: 0, height: 0, pointerEvents: 'none' }} aria-hidden>
        {/* Shockwave ring */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: 30,
            height: 30,
            marginLeft: -15,
            marginTop: -15,
            borderRadius: '50%',
            border: `2px solid ${accent}`,
            animation: 'collect-burst-ring 0.6s ease-out forwards',
          }}
        />
        {/* The collected icon, popping up + fading */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: size,
            height: size,
            marginLeft: -size / 2,
            marginTop: -size / 2,
            backgroundImage: `url(${icon})`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: 'contain',
            filter: `drop-shadow(0 0 5px ${accent})`,
            animation: 'collect-burst-icon 0.7s ease-out forwards',
          }}
        />
        {/* Rising "+1" */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            fontSize: 14,
            fontWeight: 800,
            color: kind === 'paw' ? '#5fa92e' : '#d99327',
            textShadow: '0 1px 2px rgba(0,0,0,0.25)',
            whiteSpace: 'nowrap',
            animation: 'collect-burst-plus 0.8s ease-out forwards',
          }}
        >
          +1
        </div>
      </div>
    </MapLibreMarker>
  );
}

export const CollectBurst = memo(CollectBurstImpl);
