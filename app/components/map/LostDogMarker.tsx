import { memo, useEffect, useState } from 'react';
import { OverlayViewF, FLOAT_PANE } from '@react-google-maps/api';
import type { LatLng, UrgencyLevel } from '@shukajpes/shared';

const URGENCY_SHADOW: Record<UrgencyLevel, string> = {
  urgent: '0 0 20px rgba(232,64,64,0.45), 0 3px 12px rgba(0,0,0,0.15)',
  medium: '0 0 20px rgba(217,160,48,0.45), 0 3px 12px rgba(0,0,0,0.15)',
  resolved: '0 3px 12px rgba(0,0,0,0.15)',
};

// Visual wander amplitude in pixels. Small enough to read as "alive",
// large enough to be noticed at default zoom. Zoom-independent on purpose —
// it's a vibe effect, not a geographic one.
const WANDER_PX = 18;
// New target every 4-8s (jittered per marker so 20 pets don't all tick in
// sync, which would look robotic). CSS transition below handles the smooth
// interpolation on the GPU — React only re-renders the marker once per
// target change, not per frame.
const WANDER_MIN_MS = 4000;
const WANDER_MAX_MS = 8000;

interface LostDogMarkerProps {
  position: LatLng;
  emoji: string;
  name: string;
  urgency: UrgencyLevel;
  onTap: () => void;
}

// Dog pin — white circle with emoji, urgency-colored glow, handwritten name
// label below. Memoized because ~20 of these render on the map and the map
// re-renders on every pan.
//
// Wander: the marker's lat/lng position is static (pet sits at its jittered
// coord inside its zone). A small CSS transform inside the marker drifts
// to a new random offset every few seconds, smoothed by `transition:
// transform`. GPU does the interpolation so it stays cheap even with many
// markers. No lat/lng snap = no teleport, no rotation sync across pets.
function LostDogMarkerImpl({ position, emoji, name, urgency, onTap }: LostDogMarkerProps) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    const drift = () => {
      setOffset({
        x: (Math.random() * 2 - 1) * WANDER_PX,
        y: (Math.random() * 2 - 1) * WANDER_PX,
      });
      const next = WANDER_MIN_MS + Math.random() * (WANDER_MAX_MS - WANDER_MIN_MS);
      timeoutId = setTimeout(drift, next);
    };
    // First drift fires on a short initial delay so ~20 pets don't all pick
    // targets in the same tick on mount.
    timeoutId = setTimeout(drift, Math.random() * WANDER_MAX_MS);
    return () => clearTimeout(timeoutId);
  }, []);

  return (
    <OverlayViewF
      position={position as unknown as google.maps.LatLngLiteral}
      mapPaneName={FLOAT_PANE}
      getPixelPositionOffset={() => ({ x: -18, y: -46 })}
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
          transform: `translate(${offset.x}px, ${offset.y}px)`,
          transition: 'transform 4s ease-in-out',
          willChange: 'transform',
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            boxShadow: URGENCY_SHADOW[urgency],
          }}
        >
          {emoji}
        </div>
        <div style={{ width: 1.5, height: 5, background: '#aaa' }} />
        <div
          style={{
            fontFamily: "'Caveat', cursive",
            fontSize: 13,
            fontWeight: 700,
            color: '#1a1a1a',
            textShadow: '0 1px 4px rgba(255,255,255,0.95)',
            whiteSpace: 'nowrap',
          }}
        >
          {name}
        </div>
      </div>
    </OverlayViewF>
  );
}

export const LostDogMarker = memo(LostDogMarkerImpl);
