import { memo } from 'react';
import type { LatLng } from '@shukajpes/shared';
import { SYSTEM_FONT } from '../../constants/fonts';
import { ICON_HERO } from '../../constants/sizing';
import { R } from '../../constants/radius';
import { TYPE } from '../../constants/type';
import { Icon, iconForCategory } from '../ui/Icon';
import { MapLibreMarker } from './MapLibreMarker';

// Small pin for a Google Places result. Same OverlayViewF pattern
// as LostDogMarker; soft blue glow distinguishes "places to walk to"
// from the warm-tone lost-pet pins (red/amber). When selected we scale
// up + show the name label. Renders the custom <Icon> for known
// categories, falls back to the spot's emoji string for anything
// the icon set doesn't cover yet.

interface PoiMarkerProps {
  position: LatLng;
  emoji: string;
  category: string;
  name: string;
  selected: boolean;
  onTap: () => void;
}

function PoiMarkerImpl({ position, emoji, category, name, selected, onTap }: PoiMarkerProps) {
  const slot = iconForCategory(category);
  return (
    <MapLibreMarker position={position} anchor="bottom" onClick={onTap}>
      <div
        role="button"
        tabIndex={0}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          cursor: 'pointer',
          userSelect: 'none',
          transform: selected ? 'scale(1.25)' : 'scale(1)',
          transition: 'transform 200ms ease-out',
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: R.pill,
            // Selected: solid brand blue with an inverted (white)
            // icon so the chosen spot reads instantly against the
            // grid of plain-white markers, even at the small
            // marker scale on a busy map. Unselected stays the
            // calm white disc.
            background: selected ? 'rgb(0,60,255)' : '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: TYPE.hero,
            // Selected lifts harder with a tinted shadow so the
            // pin reads as "raised + active".
            boxShadow: selected
              ? '0 6px 18px rgba(0,60,255,0.35), 0 2px 4px rgba(0,0,0,0.15)'
              : '0 2px 6px rgba(0,0,0,0.12), 0 1px 1px rgba(0,0,0,0.06)',
          }}
        >
          {slot ? <Icon name={slot} size={ICON_HERO.marker} inverted={selected} /> : emoji}
        </div>
        {selected ? (
          <>
            <div style={{ width: 1.5, height: 5, background: '#aaa' }} />
            <div
              style={{
                fontFamily: SYSTEM_FONT,
                fontSize: TYPE.small,
                fontWeight: 700,
                color: '#1a1a1a',
                textShadow: '0 1px 4px rgba(255,255,255,0.95)',
                whiteSpace: 'nowrap',
              }}
            >
              {name}
            </div>
          </>
        ) : null}
      </div>
    </MapLibreMarker>
  );
}

export const PoiMarker = memo(PoiMarkerImpl);
