import { memo } from 'react';
import { MapLibreMarker, MARKER_CLASS } from './MapLibreMarker';
import type { LatLng, UrgencyLevel } from '@shukajpes/shared';
import type { NearbyLostDog } from '../../services/api';
import { SYSTEM_FONT } from '../../constants/fonts';
import { R } from '../../constants/radius';
import { TYPE } from '../../constants/type';
import { Z } from '../../constants/z';
import { playPopThen } from '../../utils/popOnTap';
import { petPhotoAt } from '../../utils/petPhoto';
import { useStrings } from '../../i18n/useStrings';

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

// Ring geometry. The members are the same 54px photo discs as a single
// lost-pet pin (LostDogMarker's DISC_PX) — they used to be 40px emoji-only
// buttons, so opening a cluster made the pets LESS recognisable than they
// were on their own (UX-8.10). The radius grew 75 → 85 with them: at 75,
// eight 54px discs on the circle already touched. 240x240 container
// centred on the badge, so the outer discs stay inside it.
const CONTAINER_SIZE = 240;
const CONTAINER_CENTER = 120;
const RING_RADIUS = 85;
const BUTTON_SIZE = 54;

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
// Memoized — MapView re-renders ~10×/s during the companion lerp, but
// the cluster's props are stable across most of those ticks (cluster
// construction memo holds `dogs`/`dominantUrgency`/`emojiHint`; per-key
// callback maps hold `onToggle`/`onSelectItem`), so memo cuts the
// expensive cluster render down to "real changes only".
function LostDogClusterImpl({
  position,
  items,
  dominantUrgency,
  emojiHint,
  expanded,
  onToggle,
  onSelectItem,
}: LostDogClusterProps) {
  const t = useStrings();
  const count = items.length;
  return (
    <MapLibreMarker
      position={position}
      cullNearHorizon
      // The tier has to be on the MARKER: the one on the badge below is
      // local to this element's own stacking context and never reached
      // the map, so an open ring painted under the next pin over
      // (UX-8.3). Collapsed, it sits with the other lost pets.
      zIndex={expanded ? Z.MARKER_CLUSTER_CHILD : Z.MARKER_LOST_PET}
      // Lets the map tell a tap inside this open ring from a tap on some
      // other marker, which closes it (D8). See MARKER_CLASS.
      className={expanded ? MARKER_CLASS.openCluster : undefined}
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
          // The badge is an emoji and a bare number; this is what it
          // means, and whether the ring is out (UX-4.4).
          aria-label={t.map.lostPetsCount(count)}
          aria-expanded={expanded}
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
            borderRadius: R.pill,
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
            zIndex: Z.MARKER_CLUSTER_CHILD,
          }}
        >
          {expanded ? (
            <span style={{ fontSize: TYPE.hero, fontWeight: 700, color: '#1a1a1a' }}>…</span>
          ) : (
            <>
              <span style={{ fontSize: TYPE.small }}>{emojiHint}</span>
              <span style={{ fontSize: TYPE.body, fontWeight: 700, color: '#1a1a1a', marginTop: 1 }}>
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
              fontSize: TYPE.small,
              fontWeight: 600,
              color: '#1a1a1a',
              textShadow: '0 1px 4px rgba(255,255,255,0.95)',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
            }}
          >
            {t.map.lostPetsCount(count)}
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
                playPopThen(e.currentTarget, () => onSelectItem(d.id));
              }}
              style={{
                position: 'absolute',
                left: bx - BUTTON_SIZE / 2,
                top: by - BUTTON_SIZE / 2,
                width: BUTTON_SIZE,
                height: BUTTON_SIZE,
                borderRadius: R.pill,
                border: 'none',
                background: '#ffffff',
                fontSize: TYPE.display,
                // Clip the photo to the disc, as the single pin does.
                overflow: 'hidden',
                padding: 0,
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
                zIndex: Z.MARKER_DEFAULT,
              }}
              aria-label={d.name}
              // Collapsed, the ring is still in the DOM (it animates out
              // of the badge) but invisible: keep it out of the tab order
              // and away from screen readers until it is open.
              tabIndex={expanded ? 0 : -1}
              aria-hidden={!expanded}
            >
              {/* Same layering as LostDogMarker: the emoji sits behind
                  the photo, so a slow or failed image still shows it.
                  Only while open: the collapsed ring is still in the DOM
                  (it animates out of the badge), and every cluster on the
                  map fetching every member's photo for nothing is the
                  bytes utils/petPhoto.ts exists to save. */}
              <span style={{ position: 'absolute' }}>{d.emoji}</span>
              {expanded && d.photoUrl ? (
                <img
                  src={petPhotoAt(d.photoUrl, BUTTON_SIZE) ?? d.photoUrl}
                  alt=""
                  draggable={false}
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  style={{
                    position: 'relative',
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    transform: 'scale(1.2)',
                  }}
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                  }}
                />
              ) : null}
            </button>
          );
        })}
      </div>
    </MapLibreMarker>
  );
}

export const LostDogCluster = memo(LostDogClusterImpl);

export { URGENCY_RANK };
