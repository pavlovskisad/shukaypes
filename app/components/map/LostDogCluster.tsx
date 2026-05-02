import { OverlayViewF, FLOAT_PANE } from '@react-google-maps/api';
import type { LatLng, UrgencyLevel } from '@shukajpes/shared';
import type { NearbyLostDog } from '../../services/api';
import { SYSTEM_FONT } from '../../constants/fonts';

// Dominant-urgency wins the glow color. Urgent beats medium beats resolved
// so the cluster reads "there's an urgent pet in here" at a glance.
const URGENCY_RANK: Record<UrgencyLevel, number> = {
  urgent: 3,
  medium: 2,
  resolved: 1,
};

const URGENCY_SHADOW: Record<UrgencyLevel, string> = {
  urgent: '0 0 22px rgba(232,64,64,0.5), 0 3px 12px rgba(0,0,0,0.15)',
  medium: '0 0 22px rgba(217,160,48,0.5), 0 3px 12px rgba(0,0,0,0.15)',
  resolved: '0 3px 12px rgba(0,0,0,0.15)',
};

const PIN_URGENCY_SHADOW: Record<UrgencyLevel, string> = {
  urgent: '0 0 14px rgba(232,64,64,0.45), 0 2px 8px rgba(0,0,0,0.15)',
  medium: '0 0 14px rgba(217,160,48,0.45), 0 2px 8px rgba(0,0,0,0.15)',
  resolved: '0 2px 8px rgba(0,0,0,0.15)',
};

// Ring geometry — matches the companion RadialMenu proportions so the two
// expansion patterns feel like one language. 210x210 container centered on
// the cluster badge, buttons arranged on a circle of radius 75.
const CONTAINER_SIZE = 210;
const CONTAINER_CENTER = 105;
const RING_RADIUS = 75;
const BUTTON_SIZE = 40;

interface LostDogClusterProps {
  position: LatLng;
  items: NearbyLostDog[];
  dominantUrgency: UrgencyLevel;
  emojiHint: string;
  expanded: boolean;
  onToggle: () => void;
  onSelectItem: (id: string) => void;
}

// Cluster badge shown when 2+ lost pets share the same landmark-ish coord.
// When tapped, the member pets float out in a ring around the badge (same
// animation pattern as the companion radial menu). Tap the badge again or
// tap a member pin to collapse.
//
// Not memoized yet — items prop is `c.items.map(i => i.dog)` (new array
// every render) and onToggle/onSelectItem are inline. Memoization
// requires stabilising at the call site (pre-extracted `dogs` on each
// cluster + per-id callback maps); deferred to a focused perf pass.
export function LostDogCluster({
  position,
  items,
  dominantUrgency,
  emojiHint,
  expanded,
  onToggle,
  onSelectItem,
}: LostDogClusterProps) {
  const count = items.length;
  return (
    <OverlayViewF
      position={position as unknown as google.maps.LatLngLiteral}
      mapPaneName={FLOAT_PANE}
      getPixelPositionOffset={() => ({ x: -CONTAINER_CENTER, y: -CONTAINER_CENTER })}
    >
      <div
        style={{
          position: 'relative',
          width: CONTAINER_SIZE,
          height: CONTAINER_SIZE,
          pointerEvents: 'none',
        }}
      >
        {/* Center badge — anchor point. Always visible, shows "..." when
            expanded as a discoverable "tap me again to close" affordance. */}
        <div
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          style={{
            position: 'absolute',
            left: CONTAINER_CENTER - 22,
            top: CONTAINER_CENTER - 22,
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: URGENCY_SHADOW[dominantUrgency],
            fontFamily: SYSTEM_FONT,
            lineHeight: 1,
            cursor: 'pointer',
            userSelect: 'none',
            pointerEvents: 'auto',
            zIndex: 2,
          }}
        >
          {expanded ? (
            <span style={{ fontSize: 22, fontWeight: 700, color: '#1a1a1a' }}>…</span>
          ) : (
            <>
              <span style={{ fontSize: 14 }}>{emojiHint}</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1a', marginTop: 1 }}>
                {count}
              </span>
            </>
          )}
        </div>

        {!expanded && (
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: CONTAINER_CENTER + 24,
              textAlign: 'center',
              fontFamily: SYSTEM_FONT,
              fontSize: 12,
              fontWeight: 600,
              color: '#1a1a1a',
              textShadow: '0 1px 4px rgba(255,255,255,0.95)',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
            }}
          >
            {count} lost pets
          </div>
        )}

        {/* Radial ring of pet buttons. Trig-positioned around the center,
            first pin above (angle -π/2), staggered 40ms scale-in per item
            to match the companion menu's pop-out feel. */}
        {items.map((d, i) => {
          const ang = -Math.PI / 2 + (i * 2 * Math.PI) / count;
          const bx = CONTAINER_CENTER + Math.cos(ang) * RING_RADIUS;
          const by = CONTAINER_CENTER + Math.sin(ang) * RING_RADIUS;
          return (
            <button
              key={d.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelectItem(d.id);
              }}
              style={{
                position: 'absolute',
                left: bx - BUTTON_SIZE / 2,
                top: by - BUTTON_SIZE / 2,
                width: BUTTON_SIZE,
                height: BUTTON_SIZE,
                borderRadius: '50%',
                border: 'none',
                background: '#ffffff',
                fontSize: 20,
                cursor: 'pointer',
                opacity: expanded ? 1 : 0,
                transform: expanded ? 'scale(1)' : 'scale(0.4)',
                transition: `opacity 220ms ease ${i * 40}ms, transform 220ms ease ${i * 40}ms`,
                pointerEvents: expanded ? 'auto' : 'none',
                boxShadow: PIN_URGENCY_SHADOW[d.urgency],
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                userSelect: 'none',
                zIndex: 1,
              }}
              aria-label={d.name}
            >
              {d.emoji}
            </button>
          );
        })}
      </div>
    </OverlayViewF>
  );
}

export { URGENCY_RANK };
