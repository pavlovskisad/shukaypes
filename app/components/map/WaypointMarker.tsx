import { memo } from 'react';
import { OverlayViewF, FLOAT_PANE } from '@react-google-maps/api';
import type { LatLng } from '@shukajpes/shared';
import { SYSTEM_FONT } from '../../constants/fonts';

// Numbered waypoint pin for detective quests. Three states:
//   - active:  blue glow, full opacity, the current target
//   - reached: grey, 40% opacity, already visited
//   - future:  white, 80% opacity, next in line after active
// All identical shape so the progression reads as "same pin, different
// state" rather than different markers.

interface WaypointMarkerProps {
  position: LatLng;
  index: number; // zero-based; shown as index+1
  state: 'active' | 'reached' | 'future';
  onTap?: () => void;
}

const ACTIVE_GLOW = '0 0 18px rgba(0,0,255,0.55), 0 3px 10px rgba(0,0,0,0.15)';

function WaypointMarkerImpl({ position, index, state, onTap }: WaypointMarkerProps) {
  const reached = state === 'reached';
  const active = state === 'active';
  return (
    <OverlayViewF
      position={position as unknown as google.maps.LatLngLiteral}
      mapPaneName={FLOAT_PANE}
      getPixelPositionOffset={() => ({ x: -14, y: -14 })}
    >
      <div
        role={onTap ? 'button' : undefined}
        tabIndex={onTap ? 0 : -1}
        onClick={onTap}
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: reached ? 'rgba(200,200,200,0.85)' : 'rgba(255,255,255,0.95)',
          border: active ? '2px solid rgba(0,0,255,0.85)' : '1px solid rgba(0,0,0,0.08)',
          boxShadow: active ? ACTIVE_GLOW : '0 1px 4px rgba(0,0,0,0.08)',
          color: reached ? '#888' : '#1a1a1a',
          fontFamily: SYSTEM_FONT,
          fontSize: 13,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: reached ? 0.55 : active ? 1 : 0.85,
          cursor: onTap ? 'pointer' : 'default',
          userSelect: 'none',
          // Active pin pulses subtly so the user knows which one to
          // walk to next. Reached/future are static.
          animation: active ? 'wp-pulse 1.8s ease-in-out infinite' : undefined,
        }}
      >
        {reached ? '✓' : index + 1}
        {active ? (
          <style>{`
            @keyframes wp-pulse {
              0%, 100% { transform: scale(1); }
              50%      { transform: scale(1.08); }
            }
          `}</style>
        ) : null}
      </div>
    </OverlayViewF>
  );
}

export const WaypointMarker = memo(WaypointMarkerImpl);
