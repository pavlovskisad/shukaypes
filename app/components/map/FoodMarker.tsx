import { OverlayView } from '@react-google-maps/api';
import type { LatLng } from '@shukajpes/shared';

// 🦴 bone with warm amber glow (demo line 353).
export function FoodMarker({ position, onTap }: { position: LatLng; onTap: () => void }) {
  return (
    <OverlayView
      position={position as unknown as google.maps.LatLngLiteral}
      mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
      getPixelPositionOffset={() => ({ x: -12, y: -12 })}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onTap}
        style={{
          width: 24,
          height: 24,
          fontSize: 18,
          lineHeight: '24px',
          textAlign: 'center',
          cursor: 'pointer',
          filter: 'drop-shadow(0 0 6px rgba(255,200,100,0.6))',
          userSelect: 'none',
        }}
      >
        🦴
      </div>
    </OverlayView>
  );
}
