import { useEffect, useState } from 'react';
import type { Spot } from '../../services/places';
import { SYSTEM_FONT } from '../../constants/fonts';
import { Icon, iconForCategory } from './Icon';

interface SpotModalProps {
  spot: Spot | null;
  onClose: () => void;
  // Triggers a walking-route fetch + render to this spot. Modal
  // closes itself afterward. Caller decides whether the route is a
  // one-way or roundtrip — modal default is one-way; long-press
  // could differentiate later.
  onWalkHere?: (spot: Spot, shape: 'roundtrip' | 'oneway') => void;
}

const CATEGORY_LABEL: Record<string, string> = {
  cafe: 'cafe',
  restaurant: 'restaurant',
  bar: 'bar',
  pet_store: 'pet store',
  veterinary_care: 'vet',
};

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
        zIndex: 50,
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
              background: '#f0f0f0',
              color: '#555',
              borderRadius: 12,
              padding: '4px 10px',
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: 0.3,
              textTransform: 'lowercase',
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
            aria-label="close"
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
              background: '#f0f0f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 30,
              flexShrink: 0,
            }}
          >
            {(() => {
              const slot = iconForCategory(renderSpot.category);
              return slot ? <Icon name={slot} size={42} /> : (renderSpot.icon ?? '📍');
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

        <button
          onClick={() => onWalkHere?.(renderSpot, 'oneway')}
          style={{
            width: '100%',
            background: '#1a1a1a',
            color: '#ffffff',
            border: 'none',
            borderRadius: 16,
            padding: '14px 18px',
            fontFamily: SYSTEM_FONT,
            fontSize: 18,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          🚶 walk here
        </button>

        <button
          onClick={() => onWalkHere?.(renderSpot, 'roundtrip')}
          style={{
            width: '100%',
            background: 'rgba(0,0,255,0.06)',
            color: 'rgba(0,0,255,0.85)',
            border: '1px solid rgba(0,0,255,0.3)',
            borderRadius: 16,
            padding: '12px 18px',
            marginTop: 10,
            fontFamily: SYSTEM_FONT,
            fontSize: 16,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          🔄 roundtrip
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
