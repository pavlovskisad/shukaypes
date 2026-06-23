import { memo } from 'react';
import type { LatLng } from '@shukajpes/shared';
import { R } from '../../constants/radius';
import { MapLibreMarker } from './MapLibreMarker';

// Black dot with a subtle breathing ring (demo lines 172-177). Memoized so
// GPS ticks don't force the other overlays to flicker.
function UserMarkerImpl({ position }: { position: LatLng }) {
  return (
    <MapLibreMarker position={position}>
      <div style={{ position: 'relative', width: 12, height: 12 }}>
        <div
          style={{
            position: 'absolute',
            left: -54,
            top: -54,
            width: 120,
            height: 120,
            borderRadius: R.pill,
            background: 'rgba(160,160,160,0.1)',
            animation: 'u-breathe 8s ease-in-out infinite',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: 12,
            height: 12,
            borderRadius: R.pill,
            background: '#1a1a1a',
            border: '2px solid #ffffff',
            boxShadow: '0 0 4px rgba(0,0,0,0.3)',
          }}
        />
        <style>{`
          @keyframes u-breathe {
            0%, 100% { transform: scale(1); opacity: 0.12; }
            50% { transform: scale(1.12); opacity: 0.06; }
          }
        `}</style>
      </div>
    </MapLibreMarker>
  );
}

export const UserMarker = memo(UserMarkerImpl);
