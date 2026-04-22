import { memo, useEffect, useRef, useState } from 'react';
import { OverlayViewF, FLOAT_PANE } from '@react-google-maps/api';
import type { LatLng, UrgencyLevel } from '@shukajpes/shared';

// Every lost pet reads with the same red urgency now — lost is lost,
// the gradations (medium / resolved) weren't pulling their weight on a
// quick-glance map and user asked for one visual language.
const LOST_GLOW = '0 0 20px rgba(232,64,64,0.45), 0 3px 12px rgba(0,0,0,0.15)';
const LOST_RING = 'rgba(232,64,64,0.5)';

// Wander amplitude in pixels — small enough to read as "ambient drift"
// rather than "pet is running around".
const WANDER_PX = 35;
// Long transition + longer retarget interval = turtle-pace drift. Each
// step takes 30s to complete; retarget fires every 25s so the next leg
// starts during the tail of the previous one — motion is continuous but
// glacial. ease-in-out softens direction reversals so they don't read
// as jerks.
const RETARGET_MS = 25_000;
const TRANSITION_MS = 30_000;
// SOS beep: a ring emanates from the pet every BEEP_PERIOD_MS — subtle
// "I'm here" pulse. Delay per pet is randomized so pets don't beep in sync.
const BEEP_PERIOD_MS = 22_000;
const BEEP_DURATION_MS = 1800;

interface LostDogMarkerProps {
  position: LatLng;
  emoji: string;
  name: string;
  urgency: UrgencyLevel;
  photoUrl?: string | null;
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
function LostDogMarkerImpl({ position, emoji, name, urgency, photoUrl, onTap }: LostDogMarkerProps) {
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
          transition: `transform ${TRANSITION_MS}ms ease-in-out`,
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
              border: `2px solid ${LOST_RING}`,
              animation: `sos-beep ${BEEP_DURATION_MS}ms ease-out forwards`,
              pointerEvents: 'none',
            }}
          />
        ) : null}
        {/* Photo when the parser pulled one off the post; emoji fallback
            otherwise. White ring + urgency glow are unchanged so the pet's
            urgency still reads at a glance whichever way it renders. The
            emoji always renders behind the img so a failed/loading image
            naturally falls back to the emoji without extra state. */}
        <div
          style={{
            position: 'relative',
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            overflow: 'hidden',
            boxShadow: LOST_GLOW,
          }}
        >
          <span style={{ position: 'absolute' }}>{emoji}</span>
          {photoUrl ? (
            <img
              src={photoUrl}
              alt={name}
              draggable={false}
              referrerPolicy="no-referrer"
              loading="lazy"
              style={{
                position: 'relative',
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                // Crop a bit tighter so the pet fills the frame and
                // background/edges don't dilute the avatar.
                transform: 'scale(1.2)',
              }}
              onError={(e) => {
                // Some hotlinked images 403 — hide the img so the emoji
                // sitting behind it shows through.
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : null}
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
