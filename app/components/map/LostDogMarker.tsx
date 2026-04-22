import { OverlayView } from '@react-google-maps/api';
import type { LatLng, UrgencyLevel } from '@shukajpes/shared';

const URGENCY_SHADOW: Record<UrgencyLevel, string> = {
  urgent: '0 0 20px rgba(232,64,64,0.45), 0 3px 12px rgba(0,0,0,0.15)',
  medium: '0 0 20px rgba(217,160,48,0.45), 0 3px 12px rgba(0,0,0,0.15)',
  resolved: '0 3px 12px rgba(0,0,0,0.15)',
};

interface LostDogMarkerProps {
  position: LatLng;
  emoji: string;
  name: string;
  urgency: UrgencyLevel;
  onTap: () => void;
}

// Dog pin — white circle with emoji, urgency-colored glow, handwritten name
// label below. Ported from demo .dpin / .dpb (line 29-35).
export function LostDogMarker({ position, emoji, name, urgency, onTap }: LostDogMarkerProps) {
  return (
    <OverlayView
      position={position as unknown as google.maps.LatLngLiteral}
      mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
      getPixelPositionOffset={() => ({ x: -26, y: -60 })}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onTap}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          cursor: 'pointer',
          animation: 'dpin-bob 3s ease-in-out infinite',
          userSelect: 'none',
        }}
      >
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: '50%',
            background: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 26,
            boxShadow: URGENCY_SHADOW[urgency],
          }}
        >
          {emoji}
        </div>
        <div style={{ width: 2, height: 6, background: '#aaa' }} />
        <div
          style={{
            fontFamily: "'Caveat', cursive",
            fontSize: 15,
            fontWeight: 700,
            color: '#1a1a1a',
            textShadow: '0 1px 4px rgba(255,255,255,0.95)',
            whiteSpace: 'nowrap',
          }}
        >
          {name}
        </div>
        <style>{`
          @keyframes dpin-bob {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-4px); }
          }
        `}</style>
      </div>
    </OverlayView>
  );
}
