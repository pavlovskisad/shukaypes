import { OverlayView } from '@react-google-maps/api';
import type { LatLng } from '@shukajpes/shared';

// Black dot with a subtle breathing ring (demo lines 172-177).
export function UserMarker({ position }: { position: LatLng }) {
  return (
    <OverlayView
      position={position as unknown as google.maps.LatLngLiteral}
      mapPaneName={OverlayView.FLOAT_PANE}
      getPixelPositionOffset={() => ({ x: -6, y: -6 })}
    >
      <div style={{ position: 'relative', width: 12, height: 12 }}>
        <div
          style={{
            position: 'absolute',
            left: -54,
            top: -54,
            width: 120,
            height: 120,
            borderRadius: '50%',
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
            borderRadius: '50%',
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
    </OverlayView>
  );
}
