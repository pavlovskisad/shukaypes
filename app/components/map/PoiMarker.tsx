import { memo } from 'react';
import { OverlayViewF, FLOAT_PANE } from '@react-google-maps/api';
import type { LatLng } from '@shukajpes/shared';
import { SYSTEM_FONT } from '../../constants/fonts';
import { Icon, iconForCategory } from '../ui/Icon';

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
    <OverlayViewF
      position={position as unknown as google.maps.LatLngLiteral}
      mapPaneName={FLOAT_PANE}
      getPixelPositionOffset={() => ({ x: -22, y: -44 })}
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
          transform: selected ? 'scale(1.15)' : 'scale(1)',
          transition: 'transform 200ms ease-out',
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            // No backdrop-filter — with 5-20 spots visible, each blur
            // pass was re-running on every map frame and was the main
            // reason scrolling felt heavy. Plain rgba bg reads as glass
            // against the greyscale map without the GPU cost.
            background: 'rgba(255,255,255,0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 22,
            boxShadow: selected
              ? '0 0 18px rgba(60,120,255,0.45), 0 3px 8px rgba(0,0,0,0.08)'
              : '0 0 10px rgba(60,120,255,0.22), 0 2px 6px rgba(0,0,0,0.05)',
          }}
        >
          {slot ? <Icon name={slot} size={28} /> : emoji}
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
    </OverlayViewF>
  );
}

export const PoiMarker = memo(PoiMarkerImpl);
