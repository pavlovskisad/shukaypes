import { memo } from 'react';
import { OverlayViewF, FLOAT_PANE } from '@react-google-maps/api';
import type { LatLng } from '@shukajpes/shared';

// Small emoji pin for a Google Places result. Same OverlayViewF pattern
// as LostDogMarker; blue-ish shadow to distinguish from the yellow
// pet pins. When selected we scale up + show the name label — matches
// prototype's `.poi` + `.poi-prev` behaviour without the preview card,
// which we'll add in a follow-up.

interface PoiMarkerProps {
  position: LatLng;
  emoji: string;
  name: string;
  selected: boolean;
  onTap: () => void;
}

function PoiMarkerImpl({ position, emoji, name, selected, onTap }: PoiMarkerProps) {
  return (
    <OverlayViewF
      position={position as unknown as google.maps.LatLngLiteral}
      mapPaneName={FLOAT_PANE}
      getPixelPositionOffset={() => ({ x: -18, y: -36 })}
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
            width: 36,
            height: 36,
            borderRadius: '50%',
            // More translucent than the pet pins so spots read as ambient,
            // not as alerts. White-frosted, yellow halo for a warm "places
            // to visit" feel.
            background: 'rgba(255,255,255,0.6)',
            backdropFilter: 'blur(8px) saturate(140%)',
            WebkitBackdropFilter: 'blur(8px) saturate(140%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            boxShadow: selected
              ? '0 0 22px rgba(255,200,50,0.75), 0 4px 14px rgba(0,0,0,0.1)'
              : '0 0 16px rgba(255,200,50,0.45), 0 3px 10px rgba(0,0,0,0.08)',
          }}
        >
          {emoji}
        </div>
        {selected ? (
          <>
            <div style={{ width: 1.5, height: 5, background: '#aaa' }} />
            <div
              style={{
                fontFamily: "'Caveat', cursive",
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
