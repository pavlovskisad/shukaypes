import { OverlayView } from '@react-google-maps/api';
import type { LatLng, UrgencyLevel } from '@shukajpes/shared';

// Dominant-urgency wins the glow color. Urgent beats medium beats resolved
// so the cluster reads "there's an urgent pet in here" at a glance.
const URGENCY_RANK: Record<UrgencyLevel, number> = {
  urgent: 3,
  medium: 2,
  resolved: 1,
};

const URGENCY_SHADOW: Record<UrgencyLevel, string> = {
  urgent: '0 0 22px rgba(232,64,64,0.5), 0 3px 12px rgba(0,0,0,0.15)',
  medium: '0 0 22px rgba(217,160,48,0.5), 0 3px 12px rgba(0,0,0,0.15)',
  resolved: '0 3px 12px rgba(0,0,0,0.15)',
};

interface LostDogClusterProps {
  position: LatLng;
  count: number;
  dominantUrgency: UrgencyLevel;
  // Up to two emojis to hint at what's inside (dog + cat, two dogs, etc.)
  emojiHint: string;
  onTap: () => void;
}

// Cluster badge shown when 2+ lost pets share the same landmark-ish coord.
// Ported aesthetic from LostDogMarker so the map reads as one family of pins.
export function LostDogCluster({ position, count, dominantUrgency, emojiHint, onTap }: LostDogClusterProps) {
  return (
    <OverlayView
      position={position as unknown as google.maps.LatLngLiteral}
      mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
      getPixelPositionOffset={() => ({ x: -30, y: -58 })}
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
          userSelect: 'none',
        }}
      >
        <div
          style={{
            width: 60,
            height: 60,
            borderRadius: '50%',
            background: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: URGENCY_SHADOW[dominantUrgency],
            fontFamily: "'Caveat', cursive",
            lineHeight: 1,
          }}
        >
          <span style={{ fontSize: 18 }}>{emojiHint}</span>
          <span style={{ fontSize: 20, fontWeight: 700, color: '#1a1a1a', marginTop: 2 }}>
            {count}
          </span>
        </div>
        <div style={{ width: 2, height: 6, background: '#aaa' }} />
        <div
          style={{
            fontFamily: "'Caveat', cursive",
            fontSize: 14,
            fontWeight: 600,
            color: '#1a1a1a',
            textShadow: '0 1px 4px rgba(255,255,255,0.95)',
            whiteSpace: 'nowrap',
          }}
        >
          {count} lost pets
        </div>
      </div>
    </OverlayView>
  );
}

export { URGENCY_RANK };
