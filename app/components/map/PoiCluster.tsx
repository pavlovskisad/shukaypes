import { memo } from 'react';
import { OverlayViewF, FLOAT_PANE } from '@react-google-maps/api';
import type { LatLng } from '@shukajpes/shared';
import { Icon, iconForCategory } from '../ui/Icon';
import { SYSTEM_FONT } from '../../constants/fonts';

// Stacked badge shown when 2+ spots of the same category sit close
// enough that rendering each one as its own pin makes the map a
// pile of overlapping glass discs. Tap → expand (parent flips the
// cluster into its individual member PoiMarkers); a single floating
// "collapse" pill at the top of the map stays visible while any
// cluster is expanded so the user can re-stack with one tap.
//
// Memoized — MapView re-renders ~10×/s during the companion lerp;
// per-key callback in the parent keeps onToggle stable, so memo
// cuts the cost down to real prop changes.

interface PoiClusterProps {
  position: LatLng;
  category: string;
  // Fallback emoji for categories we don't have a custom icon for.
  emoji: string;
  count: number;
  onTap: () => void;
}

function PoiClusterImpl({ position, category, emoji, count, onTap }: PoiClusterProps) {
  const slot = iconForCategory(category);
  return (
    <OverlayViewF
      position={position as unknown as google.maps.LatLngLiteral}
      mapPaneName={FLOAT_PANE}
      getPixelPositionOffset={() => ({ x: -27, y: -27 })}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          onTap();
        }}
        aria-label={`${count} ${category} nearby — tap to expand`}
        style={{
          position: 'relative',
          width: 54,
          height: 54,
          borderRadius: 27,
          background: 'rgba(255,255,255,0.85)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 24,
          boxShadow: '0 0 14px rgba(60,120,255,0.32), 0 3px 8px rgba(0,0,0,0.08)',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        {slot ? <Icon name={slot} size={32} /> : emoji}
        {/* Count chip — top-right of the badge, blue so it reads as
            "this group has N" rather than as part of the icon. */}
        <div
          style={{
            position: 'absolute',
            top: -4,
            right: -4,
            minWidth: 20,
            height: 20,
            paddingLeft: 5,
            paddingRight: 5,
            borderRadius: 10,
            background: 'rgba(0,60,255,0.92)',
            color: '#ffffff',
            fontFamily: SYSTEM_FONT,
            fontSize: 11,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 4px rgba(0,0,0,0.18)',
          }}
        >
          {count}
        </div>
      </div>
    </OverlayViewF>
  );
}

export const PoiCluster = memo(PoiClusterImpl);
