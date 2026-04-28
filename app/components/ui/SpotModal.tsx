import type { Spot } from '../../services/places';
import { SYSTEM_FONT } from '../../constants/fonts';

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

function ratingStars(rating?: number): string {
  if (typeof rating !== 'number') return '';
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(Math.max(0, 5 - full - (half ? 1 : 0)));
}

// Slide-up POI sheet. Mirrors LostDogModal's shape so the two read as
// one family — frosted-corner card, big primary action button, ✕ to
// close. Differentiated from lost-pet sheet by the photo slot
// (category emoji here, pet photo there) and the action ("walk here"
// vs "i've seen them").
export function SpotModal({ spot, onClose, onWalkHere }: SpotModalProps) {
  if (!spot) return null;

  const categoryLabel = CATEGORY_LABEL[spot.category] ?? spot.category;
  const stars = ratingStars(spot.rating);

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
        paddingBottom: 80,
        zIndex: 50,
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
          animation: 'spot-modal-up 0.3s cubic-bezier(0.4,0,0.2,1)',
          boxShadow: '0 -12px 40px rgba(0,0,0,0.2)',
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
            {spot.icon ?? '📍'}
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
              {spot.name}
            </div>
            {stars ? (
              <div style={{ fontSize: 13, color: '#d9a030', marginTop: 4 }}>
                {stars}{' '}
                <span style={{ color: '#777', fontSize: 12 }}>
                  {typeof spot.rating === 'number' ? spot.rating.toFixed(1) : ''}
                </span>
              </div>
            ) : null}
            {spot.address ? (
              <div style={{ fontSize: 12, color: '#777', marginTop: 4 }}>
                {spot.address}
              </div>
            ) : null}
          </div>
        </div>

        <button
          onClick={() => onWalkHere?.(spot, 'oneway')}
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
          onClick={() => onWalkHere?.(spot, 'roundtrip')}
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
          @keyframes spot-modal-up {
            from { transform: translateY(100%); }
            to { transform: translateY(0); }
          }
        `}</style>
      </div>
    </div>
  );
}
