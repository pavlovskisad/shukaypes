import { memo, useEffect, useRef, useState } from 'react';
import { OverlayViewF, FLOAT_PANE } from '@react-google-maps/api';
import type { LatLng, UrgencyLevel } from '@shukajpes/shared';

const URGENCY_SHADOW: Record<UrgencyLevel, string> = {
  urgent: '0 0 20px rgba(232,64,64,0.45), 0 3px 12px rgba(0,0,0,0.15)',
  medium: '0 0 20px rgba(217,160,48,0.45), 0 3px 12px rgba(0,0,0,0.15)',
  resolved: '0 3px 12px rgba(0,0,0,0.15)',
};

const URGENCY_RING: Record<UrgencyLevel, string> = {
  urgent: 'rgba(232,64,64,0.5)',
  medium: 'rgba(217,160,48,0.5)',
  resolved: 'rgba(170,170,170,0.4)',
};

// Wander amplitude in pixels — visible movement at default zoom but small
// enough not to overshoot the pet's search zone when zoomed in.
const WANDER_PX = 50;
// New target every 3s while the CSS transition runs 6s — the element is
// always moving toward SOME target. Mid-transition target changes smoothly
// redirect, so the motion reads as continuous drift rather than stop/start.
const RETARGET_MS = 3000;
const TRANSITION_MS = 6000;
// SOS beep: a ring emanates from the pet every BEEP_PERIOD_MS — subtle
// "I'm here" pulse. Delay per pet is randomized so pets don't beep in sync.
const BEEP_PERIOD_MS = 22_000;
const BEEP_DURATION_MS = 1800;

interface LostDogMarkerProps {
  position: LatLng;
  emoji: string;
  name: string;
  urgency: UrgencyLevel;
  onTap: () => void;
}

// Dog pin — white circle with emoji, urgency-colored glow, handwritten name
// label below. Memoized because ~20 of these render on the map.
//
// Wander: lat/lng stays static; the pin's inner div drifts via a CSS
// `translate()` transform that updates to a new random target every 3s.
// The 6s transition duration overlaps successive targets so the element
// never stops moving. GPU does the interpolation.
//
// Beep: a translucent ring expands out of the pin every ~22s. Per-pet
// random phase so they don't synchronize across the map.
function LostDogMarkerImpl({ position, emoji, name, urgency, onTap }: LostDogMarkerProps) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [beeping, setBeeping] = useState(false);
  const beepTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Continuous wander — setInterval means exactly one pending timer per
  // marker regardless of mount/unmount timing. Cleared synchronously on
  // unmount.
  useEffect(() => {
    const id = setInterval(() => {
      setOffset({
        x: (Math.random() * 2 - 1) * WANDER_PX,
        y: (Math.random() * 2 - 1) * WANDER_PX,
      });
    }, RETARGET_MS);
    return () => clearInterval(id);
  }, []);

  // SOS beep. Initial delay is random per pet so 20 pets don't beep in
  // unison, then regular period after that. We schedule via setTimeout +
  // re-arm so the beep can outlast a single interval tick cleanly.
  useEffect(() => {
    let cancelled = false;
    const schedule = (delay: number) => {
      beepTimeoutRef.current = setTimeout(() => {
        if (cancelled) return;
        setBeeping(true);
        setTimeout(() => {
          if (!cancelled) setBeeping(false);
        }, BEEP_DURATION_MS);
        schedule(BEEP_PERIOD_MS);
      }, delay);
    };
    schedule(Math.random() * BEEP_PERIOD_MS);
    return () => {
      cancelled = true;
      if (beepTimeoutRef.current) clearTimeout(beepTimeoutRef.current);
    };
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
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          cursor: 'pointer',
          userSelect: 'none',
          transform: `translate(${offset.x}px, ${offset.y}px)`,
          transition: `transform ${TRANSITION_MS}ms linear`,
        }}
      >
        {/* SOS beep ring — absolute so it expands out of the pin center
            without reflowing layout. Rendered only while `beeping` so
            it's zero paint cost 90% of the time. */}
        {beeping ? (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: '50%',
              width: 36,
              height: 36,
              marginLeft: -18,
              borderRadius: '50%',
              border: `2px solid ${URGENCY_RING[urgency]}`,
              animation: `sos-beep ${BEEP_DURATION_MS}ms ease-out forwards`,
              pointerEvents: 'none',
            }}
          />
        ) : null}
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
        <style>{`
          @keyframes sos-beep {
            0%   { transform: scale(1); opacity: 0.7; }
            100% { transform: scale(4.5); opacity: 0; }
          }
        `}</style>
      </div>
    </OverlayViewF>
  );
}

export const LostDogMarker = memo(LostDogMarkerImpl);
