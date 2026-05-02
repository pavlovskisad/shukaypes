import { memo, useEffect, useRef, useState } from 'react';
import { OverlayViewF, FLOAT_PANE } from '@react-google-maps/api';
import type { LatLng, UrgencyLevel } from '@shukajpes/shared';
import { SYSTEM_FONT } from '../../constants/fonts';

// Urgency drives the glow color: red = urgent (act now), amber =
// searching (still hot), grey = resolved. Toned down from earlier
// passes — the previous full-saturation halo bled across half the
// pin and made dense clusters feel chaotic. Softer, smaller halo
// reads as "beacon" without dominating.
const URGENCY_HALO: Record<UrgencyLevel, { glow: string; ring: string }> = {
  urgent: {
    glow: '0 0 14px rgba(232,64,64,0.45), 0 2px 8px rgba(0,0,0,0.12)',
    ring: 'rgba(232,64,64,0.6)',
  },
  medium: {
    glow: '0 0 14px rgba(217,160,48,0.45), 0 2px 8px rgba(0,0,0,0.12)',
    ring: 'rgba(217,160,48,0.6)',
  },
  resolved: {
    glow: '0 0 10px rgba(160,160,160,0.3), 0 2px 6px rgba(0,0,0,0.1)',
    ring: 'rgba(160,160,160,0.4)',
  },
};

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
// SOS beep: a ring emanates from the pet on its own cadence. Each pet
// gets a unique period inside [BEEP_PERIOD_MIN_MS, BEEP_PERIOD_MAX_MS]
// at mount + a random initial delay, so the map as a whole doesn't
// breathe in sync. Single-period + random offset still drifts back
// into phase after a few cycles, which read as "the city is beeping at
// us"; giving each pet its own rhythm keeps the field asynchronous.
const BEEP_PERIOD_MIN_MS = 18_000;
const BEEP_PERIOD_MAX_MS = 42_000;
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
  const halo = URGENCY_HALO[urgency];

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

  // SOS beep. Each pet rolls its own period at mount (inside the
  // min/max band above) so the map doesn't breathe in sync. A random
  // initial delay spreads the first ping, then the re-arm uses the
  // pet's own period for every subsequent one.
  useEffect(() => {
    let cancelled = false;
    const periodMs =
      BEEP_PERIOD_MIN_MS +
      Math.random() * (BEEP_PERIOD_MAX_MS - BEEP_PERIOD_MIN_MS);
    const schedule = (delay: number) => {
      beepTimeoutRef.current = setTimeout(() => {
        if (cancelled) return;
        setBeeping(true);
        setTimeout(() => {
          if (!cancelled) setBeeping(false);
        }, BEEP_DURATION_MS);
        schedule(periodMs);
      }, delay);
    };
    schedule(Math.random() * periodMs);
    return () => {
      cancelled = true;
      if (beepTimeoutRef.current) clearTimeout(beepTimeoutRef.current);
    };
  }, []);

  return (
    <OverlayViewF
      position={position as unknown as google.maps.LatLngLiteral}
      mapPaneName={FLOAT_PANE}
      getPixelPositionOffset={() => ({ x: -27, y: -68 })}
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
              width: 54,
              height: 54,
              marginLeft: -27,
              borderRadius: '50%',
              border: `2px solid ${halo.ring}`,
              animation: `sos-beep ${BEEP_DURATION_MS}ms ease-out forwards`,
              pointerEvents: 'none',
            }}
          />
        ) : null}
        {/* Photo when the parser pulled one off the post; emoji fallback
            otherwise. White ring + urgency glow are unchanged so the pet's
            urgency still reads at a glance whichever way it renders. The
            emoji always renders behind the img so a failed/loading image
            naturally falls back to the emoji without extra state.
            Bumped 1.5× from the original 36px so the pin reads at a
            glance on a busy map; auto-tracking the user's request to
            make pets more present. */}
        <div
          style={{
            position: 'relative',
            width: 54,
            height: 54,
            borderRadius: '50%',
            background: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 27,
            overflow: 'hidden',
            boxShadow: halo.glow,
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
            fontFamily: SYSTEM_FONT,
            fontSize: 16,
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
