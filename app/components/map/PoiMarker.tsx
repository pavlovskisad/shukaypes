import { memo } from 'react';
import type { LatLng } from '@shukajpes/shared';
import { SYSTEM_FONT } from '../../constants/fonts';
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
          transform: selected ? 'scale(1.15)' : 'scale(1)',
          transition: 'transform 200ms ease-out',
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            // Solid white disc (not semi-transparent glass) so the
            // marker reads cleanly against the soft pastel map. Subtle
            // natural drop shadow instead of the blue glow.
            background: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 22,
            boxShadow: selected
              ? '0 3px 10px rgba(0,0,0,0.18), 0 1px 2px rgba(0,0,0,0.10)'
              : '0 2px 6px rgba(0,0,0,0.12), 0 1px 1px rgba(0,0,0,0.06)',
          }}
        >
          {slot ? <Icon name={slot} size={52} /> : emoji}
        </div>
        {selected ? (
          <>
            <div style={{ width: 1.5, height: 5, background: '#aaa' }} />
            <div
              style={{
                fontFamily: SYSTEM_FONT,
                fontSize: 14,
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
