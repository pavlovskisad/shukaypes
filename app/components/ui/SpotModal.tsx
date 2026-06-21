import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import type { Spot } from '../../services/places';
import { SYSTEM_FONT } from '../../constants/fonts';
import { Z } from '../../constants/z';
import { INLINE_ICON, MAP_MARKER } from '../../constants/sizing';
import { Icon, iconForCategory } from './Icon';
import { useStrings } from '../../i18n/useStrings';

// Full-width pill CTAs — same recipe as the LostDog action buttons,
// just width:100% because SpotModal stacks them vertically rather
// than splitting flex:1 side by side.
const MODAL_PILL_FULL_BASE: CSSProperties = {
  width: '100%',
  padding: '10px 18px',
  borderRadius: 999,
  border: 'none',
  fontFamily: SYSTEM_FONT,
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  boxShadow: '0 4px 12px rgba(0,0,0,0.10)',
};
const MODAL_PILL_FULL_DARK: CSSProperties = {
  ...MODAL_PILL_FULL_BASE,
  background: '#1a1a1a',
  color: '#ffffff',
};
const MODAL_PILL_FULL_BLUE: CSSProperties = {
  ...MODAL_PILL_FULL_BASE,
  background: 'rgb(0,60,255)',
  color: '#ffffff',
};

interface SpotModalProps {
  spot: Spot | null;
  onClose: () => void;
  // Triggers a walking-route fetch + render to this spot. Modal
  // closes itself afterward. Caller decides whether the route is a
  // one-way or roundtrip — modal default is one-way; long-press
  // could differentiate later.
  onWalkHere?: (spot: Spot, shape: 'roundtrip' | 'oneway') => void;
}

const SHEET_ANIM_MS = 280;

function ratingStars(rating?: number): string {
  if (typeof rating !== 'number') return '';
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(Math.max(0, 5 - full - (half ? 1 : 0)));
}

// Slide-up POI sheet. Mirrors LostDogModal's shape so the two read as
// one family — frosted-corner card, big primary action button, ✕ to
// close. Animates in on mount, animates out before unmounting via the
// closing-state timeout so dismiss feels reversible.
export function SpotModal({ spot, onClose, onWalkHere }: SpotModalProps) {
  const t = useStrings();
  const CATEGORY_LABEL: Record<string, string> = t.modals.spot.categories;
  const [renderSpot, setRenderSpot] = useState<Spot | null>(spot);
  const [closing, setClosing] = useState(false);

  // Three transitions matter:
  //   prop spot: A   →  prop spot: B    (swap content, no animation)
  //   prop spot: A   →  null            (start closing → unmount after MS)
  //   prop spot: null → A               (mount, enter animation runs)
  useEffect(() => {
    if (spot) {
      setRenderSpot(spot);
      setClosing(false);
      return;
    }
    if (renderSpot && !closing) {
      setClosing(true);
      const t = setTimeout(() => {
        setRenderSpot(null);
        setClosing(false);
      }, SHEET_ANIM_MS);
      return () => clearTimeout(t);
    }
  }, [spot]);

  if (!renderSpot) return null;

  const categoryLabel = CATEGORY_LABEL[renderSpot.category] ?? renderSpot.category;
  const stars = ratingStars(renderSpot.rating);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0,0,0,0.3)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        // Lift the sheet above the bottom dashboard so the primary
        // action isn't covered. Adds env(safe-area-inset-bottom) so
        // PWA on notched iPhones (where the tab bar sits behind a
        // ~34px home-indicator strip) gets the same visual breathing
        // room as Android/desktop.
        paddingBottom: 'calc(100px + env(safe-area-inset-bottom))' as unknown as number,
        zIndex: Z.MODAL_MAP,
        opacity: closing ? 0 : 1,
        transition: `opacity ${SHEET_ANIM_MS}ms ease-out`,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#ffffff',
          borderRadius: 24,
          padding: '22px 20px 22px',
          width: '100%',
          maxWidth: 430,
          animation: `sheet-${closing ? 'down' : 'up'} ${SHEET_ANIM_MS}ms cubic-bezier(0.4,0,0.2,1) forwards`,
          boxShadow: '0 -10px 30px rgba(0,0,0,0.12)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 14,
          }}
        >
          <span
            style={{
              // White chip with a soft shadow instead of a grey
              // fill — separates from the white modal bg via depth
              // (matches the same chip treatment in spots screen
              // rows + hero icons).
              background: '#ffffff',
              color: '#555',
              borderRadius: 12,
              padding: '4px 10px',
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: 0.3,
              textTransform: 'lowercase',
              boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
              border: '1px solid rgba(0,0,0,0.04)',
            }}
          >
            {categoryLabel}
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 24,
              cursor: 'pointer',
              color: '#777',
              lineHeight: 1,
            }}
            aria-label={t.modals.common.close}
          >
            ×
          </button>
        </div>

        <div style={{ display: 'flex', gap: 14, marginBottom: 18, alignItems: 'center' }}>
          <div
            style={{
              width: 68,
              height: 68,
              borderRadius: '50%',
              // White with a soft shadow — was a grey disc that
              // visually competed with the white modal bg.
              background: '#ffffff',
              boxShadow: '0 4px 12px rgba(0,0,0,0.10)',
              border: '1px solid rgba(0,0,0,0.04)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 30,
              flexShrink: 0,
            }}
          >
            {(() => {
              const slot = iconForCategory(renderSpot.category);
              return slot ? <Icon name={slot} size={MAP_MARKER.spotHero} /> : (renderSpot.icon ?? '📍');
            })()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: SYSTEM_FONT,
                fontSize: 22,
                fontWeight: 700,
                lineHeight: 1.2,
              }}
            >
              {renderSpot.name}
            </div>
            {stars ? (
              <div style={{ fontSize: 13, color: '#d9a030', marginTop: 4 }}>
                {stars}{' '}
                <span style={{ color: '#777', fontSize: 12 }}>
                  {typeof renderSpot.rating === 'number' ? renderSpot.rating.toFixed(1) : ''}
                </span>
              </div>
            ) : null}
            {renderSpot.address ? (
              <div style={{ fontSize: 12, color: '#777', marginTop: 4 }}>
                {renderSpot.address}
              </div>
            ) : null}
          </div>
        </div>

        {/* Two tight pill CTAs — same style + size family as the
            LostDog modal so modal buttons land consistently across
            the app. Stacked (full width) here because the SpotModal
            uses width-100 buttons; LostDog uses two side-by-side. */}
        <button
          onClick={() => onWalkHere?.(renderSpot, 'oneway')}
          style={MODAL_PILL_FULL_DARK}
        >
          <Icon name="walk" size={INLINE_ICON.cta} inverted />
          <span>{t.modals.spot.walkHere}</span>
        </button>

        <button
          onClick={() => onWalkHere?.(renderSpot, 'roundtrip')}
          style={{ ...MODAL_PILL_FULL_BLUE, marginTop: 10 }}
        >
          <Icon name="roundtrip" size={INLINE_ICON.cta} inverted />
          <span>{t.modals.spot.roundtrip}</span>
        </button>

        <style>{`
          @keyframes sheet-up {
            from { transform: translateY(100%); }
            to { transform: translateY(0); }
          }
          @keyframes sheet-down {
            from { transform: translateY(0); }
            to { transform: translateY(100%); }
          }
        `}</style>
      </div>
    </div>
  );
}
