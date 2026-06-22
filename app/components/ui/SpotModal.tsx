import { useEffect, useState } from 'react';
import type { Spot } from '../../services/places';
import { SYSTEM_FONT } from '../../constants/fonts';
import { Z } from '../../constants/z';
import { INLINE_ICON } from '../../constants/sizing';
import { MODAL_PILL_DARK, MODAL_PILL_BLUE } from '../../constants/buttons';
import { Icon, iconForCategory } from './Icon';
import { useStrings } from '../../i18n/useStrings';

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
const HERO_HEIGHT_PX = 200;

// Slide-up POI sheet. Mirrors LostDogModal's hero-on-top layout but
// with a giant category icon instead of a photo — same visual family,
// different content type. Animates in on mount; closing-state
// timeout runs the slide-down before unmounting.
export function SpotModal({ spot, onClose, onWalkHere }: SpotModalProps) {
  const t = useStrings();
  const CATEGORY_LABEL: Record<string, string> = t.modals.spot.categories;
  const [renderSpot, setRenderSpot] = useState<Spot | null>(spot);
  const [closing, setClosing] = useState(false);

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
  const iconSlot = iconForCategory(renderSpot.category);
  const hasRating = typeof renderSpot.rating === 'number';

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
        // action isn't covered. env(safe-area-inset-bottom) gives
        // notched-iPhone PWA the same breathing room as the rest.
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
          borderRadius: 28,
          padding: 0,
          width: '100%',
          maxWidth: 460,
          display: 'flex',
          flexDirection: 'column',
          animation: `sheet-${closing ? 'down' : 'up'} ${SHEET_ANIM_MS}ms cubic-bezier(0.4,0,0.2,1) forwards`,
          boxShadow: '0 -10px 30px rgba(0,0,0,0.15)',
          overflow: 'hidden',
        }}
      >
        {/* Hero block — soft-grey tinted band carrying a big centred
            category icon. Category chip top-left, rating chip +
            close button top-right. Same "hero on top of card" shape
            as the LostDogModal photo header so the two read as one
            family. */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: HERO_HEIGHT_PX,
            background: 'linear-gradient(180deg, #f5f6f8 0%, #ecedf0 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {iconSlot ? (
            <Icon name={iconSlot} size={120} />
          ) : (
            <span style={{ fontSize: 96, opacity: 0.85 }}>
              {renderSpot.icon ?? '📍'}
            </span>
          )}
          {/* Category chip top-left */}
          <span
            style={{
              position: 'absolute',
              top: 14,
              left: 14,
              background: '#ffffff',
              color: '#555',
              borderRadius: 12,
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 0.4,
              textTransform: 'lowercase',
              boxShadow: '0 2px 8px rgba(0,0,0,0.10)',
              border: '1px solid rgba(0,0,0,0.04)',
            }}
          >
            {categoryLabel}
          </span>
          {/* Top-right cluster — rating chip (if available) + close
              button. Rating uses the same white-pill family as the
              category chip but with gold star + value. */}
          <div
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {hasRating ? (
              <span
                style={{
                  background: '#ffffff',
                  color: '#d9a030',
                  borderRadius: 12,
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: 0.3,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.10)',
                  border: '1px solid rgba(0,0,0,0.04)',
                }}
              >
                ★ {renderSpot.rating!.toFixed(1)}
              </span>
            ) : null}
            <button
              onClick={onClose}
              aria-label={t.modals.common.close}
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                border: '1px solid rgba(0,0,0,0.06)',
                background: 'rgba(255,255,255,0.92)',
                backdropFilter: 'blur(8px) saturate(160%)',
                WebkitBackdropFilter: 'blur(8px) saturate(160%)',
                color: '#1a1a1a',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                fontSize: 26,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Info + actions — name + address, then two action pills. */}
        <div style={{ padding: '20px 22px 22px' }}>
          <div
            style={{
              fontFamily: SYSTEM_FONT,
              fontSize: 26,
              fontWeight: 800,
              lineHeight: 1.15,
              color: '#1a1a1a',
            }}
          >
            {renderSpot.name}
          </div>
          {renderSpot.address ? (
            <div
              style={{
                fontSize: 14,
                color: '#777',
                marginTop: 6,
                marginBottom: 18,
              }}
            >
              {renderSpot.address}
            </div>
          ) : (
            <div style={{ height: 18 }} />
          )}

          {/* Two pills side-by-side via flex:1 (shared MODAL_PILL_*) */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => onWalkHere?.(renderSpot, 'oneway')}
              style={MODAL_PILL_DARK}
            >
              <Icon name="walk" size={INLINE_ICON.cta} inverted />
              <span>{t.modals.spot.walkHere}</span>
            </button>
            <button
              onClick={() => onWalkHere?.(renderSpot, 'roundtrip')}
              style={MODAL_PILL_BLUE}
            >
              <Icon name="roundtrip" size={INLINE_ICON.cta} inverted />
              <span>{t.modals.spot.roundtrip}</span>
            </button>
          </div>
        </div>

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
