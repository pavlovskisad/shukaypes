import { memo } from 'react';
import type { LatLng } from '@shukajpes/shared';
import { SYSTEM_FONT } from '../../constants/fonts';
import { R } from '../../constants/radius';
import { TYPE } from '../../constants/type';
import { colors } from '../../constants/colors';
import { INK, SURFACE } from '../../constants/surface';
import { MapLibreMarker } from './MapLibreMarker';
import { Glyph } from '../ui/Glyph';

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

// colors.blue's glow — the interface's tap blue, not an off-token pure
// blue of its own (UX-8.11).
const ACTIVE_GLOW = '0 0 18px rgba(0,60,255,0.55), 0 3px 10px rgba(0,0,0,0.15)';
const DOT = 28;
// The disc stays 28; the tap target is 44 (UX-8.11). Transparent
// padding around it, the walk stops' STOP_DOT_HIT_PAD pattern — the
// marker is centre-anchored, so unlike those it needs no offset back.
const HIT = 44;

function WaypointMarkerImpl({ position, index, state, onTap }: WaypointMarkerProps) {
  const reached = state === 'reached';
  const active = state === 'active';
  return (
    <MapLibreMarker position={position} onClick={onTap}>
      <div
        role={onTap ? 'button' : undefined}
        tabIndex={onTap ? 0 : -1}
        style={{
          padding: (HIT - DOT) / 2,
          cursor: onTap ? 'pointer' : 'default',
        }}
      >
      <div
        data-loop
        style={{
          width: DOT,
          height: DOT,
          boxSizing: 'border-box',
          borderRadius: R.pill,
          background: reached ? colors.greyPale : SURFACE.fill,
          // The app's one ink edge rather than a 1px 8% hairline that
          // read as an anti-aliasing smudge; the tap blue on the pin
          // you are walking to.
          border: active ? `2px solid ${colors.blue}` : reached ? `2px solid ${colors.grey}` : SURFACE.hair,
          boxShadow: active ? ACTIVE_GLOW : SURFACE.chip,
          color: reached ? colors.grey : INK,
          fontFamily: SYSTEM_FONT,
          fontSize: TYPE.small,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: reached ? 0.55 : active ? 1 : 0.85,
          userSelect: 'none',
          // Active pin pulses subtly so the user knows which one to
          // walk to next. Reached/future are static.
          animation: active ? 'wp-pulse 1.8s ease-in-out infinite' : undefined,
        }}
      >
        {/* Drawn, not the ✓ character: Annex has no tick (UX-11.11). */}
        {reached ? <Glyph name="check" size={TYPE.small} /> : index + 1}
        {active ? (
          <style>{`
            @keyframes wp-pulse {
              0%, 100% { transform: scale(1); }
              50%      { transform: scale(1.08); }
            }
          `}</style>
        ) : null}
      </div>
      </div>
    </MapLibreMarker>
  );
}

export const WaypointMarker = memo(WaypointMarkerImpl);
