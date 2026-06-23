import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Spot } from '../../services/places';
import { SYSTEM_FONT } from '../../constants/fonts';
import { Z } from '../../constants/z';
import { INLINE_ICON, ICON_HERO, EMOJI_HERO } from '../../constants/sizing';
import { R } from '../../constants/radius';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
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
const HERO_HEIGHT_PX = 220;
// Top-anchored modal — bump the badge / close button down by the
// safe-area inset so they clear the iPhone notch / status bar.
const SAFE_TOP = 'calc(env(safe-area-inset-top, 0px) + 12px)';

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
  if (typeof document === 'undefined') return null;

  const categoryLabel = CATEGORY_LABEL[renderSpot.category] ?? renderSpot.category;
  const iconSlot = iconForCategory(renderSpot.category);
  const hasRating = typeof renderSpot.rating === 'number';

  // Portal to document.body — see LostDogModal for the rationale.
  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.3)',
        display: 'flex',
        // Anchored at the TOP — same dashboard-card-from-above
        // shape as the LostDogModal so the two read as one family.
        alignItems: 'flex-start',
        justifyContent: 'center',
        zIndex: Z.MODAL_MAP,
        opacity: closing ? 0 : 1,
        transition: `opacity ${SHEET_ANIM_MS}ms ease-out`,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#ffffff',
          // Full-bleed top edge, rounded bottom only.
          borderTopLeftRadius: 0,
          borderTopRightRadius: 0,
          borderBottomLeftRadius: R.card,
          borderBottomRightRadius: R.card,
          padding: 0,
          width: '100%',
          maxWidth: 460,
          // Cap so the action pills stay above the tab bar even on
          // short viewports.
          maxHeight: 'calc(100vh - 110px - env(safe-area-inset-bottom))' as unknown as number,
          display: 'flex',
          flexDirection: 'column',
          animation: `top-sheet-${closing ? 'out' : 'in'} ${SHEET_ANIM_MS}ms cubic-bezier(0.4,0,0.2,1) forwards`,
          boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
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
            // Plain white — the previous grey gradient added visual
            // noise without earning it; the icon + chips already
            // carry the hero's identity.
            background: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {iconSlot ? (
            <Icon name={iconSlot} size={ICON_HERO.modal} />
          ) : (
            <span style={{ fontSize: EMOJI_HERO.modal, opacity: 0.85 }}>
              {renderSpot.icon ?? '📍'}
            </span>
          )}
          {/* Category chip top-left — full-pill + lifted shadow
              to match the HUD / chat / card chip family. */}
          <span
            style={{
              position: 'absolute',
              top: SAFE_TOP,
              left: 14,
              background: '#ffffff',
              color: '#555',
              borderRadius: R.pill,
              padding: '6px 12px',
              fontSize: TYPE.small,
              fontWeight: 700,
              letterSpacing: 0.4,
              textTransform: 'lowercase',
              boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
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
              top: SAFE_TOP,
              right: 12,
              display: 'flex',
              alignItems: 'center',
              gap: S.s,
            }}
          >
            {hasRating ? (
              <span
                style={{
                  background: '#ffffff',
                  color: '#d9a030',
                  borderRadius: R.pill,
                  padding: '6px 12px',
                  fontSize: TYPE.small,
                  fontWeight: 700,
                  letterSpacing: 0.3,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
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
                borderRadius: R.pill,
                border: '1px solid rgba(0,0,0,0.06)',
                background: '#ffffff',
                color: '#1a1a1a',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                fontSize: TYPE.display,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Info section — name + address. Scrolls if needed. */}
        <div
          style={{
            padding: '20px 22px 8px',
            overflowY: 'auto',
            flexGrow: 1,
            minHeight: 0,
          }}
        >
          <div
            style={{
              fontFamily: SYSTEM_FONT,
              fontSize: TYPE.display,
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
                fontSize: TYPE.small,
                color: '#777',
                marginTop: S.s,
              }}
            >
              {renderSpot.address}
            </div>
          ) : null}
        </div>

        {/* Action pills — fixed at the bottom of the modal so they
            never scroll out of view. */}
        <div
          style={{
            display: 'flex',
            gap: S.s,
            padding: '12px 22px 20px',
            flexShrink: 0,
          }}
        >
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

        <style>{`
          @keyframes top-sheet-in {
            from { transform: translateY(-100%); }
            to { transform: translateY(0); }
          }
          @keyframes top-sheet-out {
            from { transform: translateY(0); }
            to { transform: translateY(-100%); }
          }
        `}</style>
      </div>
    </div>,
    document.body,
  );
}
