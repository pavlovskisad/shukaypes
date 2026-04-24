import { useRef } from 'react';
import type { NearbyLostDog } from '../../services/api';
import { SYSTEM_FONT } from '../../constants/fonts';

interface LostDogModalProps {
  dog: NearbyLostDog | null;
  onClose: () => void;
  onReportSighting?: (dog: NearbyLostDog) => void;
  onStartSearch?: (dog: NearbyLostDog) => void;
  // When this dog already has an active detective quest, swap the
  // "start search" button for a muted "searching…" affordance that
  // leads to the abandon-via-pill flow instead of double-starting.
  searchActive?: boolean;
  // Optional prev/next cycling between the nearby pets. When wired up,
  // the modal shows ‹ › chevrons and responds to horizontal swipe
  // gestures on the sheet. Either both or neither.
  onPrev?: () => void;
  onNext?: () => void;
}

// Horizontal swipe threshold (px). Matches iOS's "decisive swipe"
// feel — small enough to trigger with a thumb flick, big enough that
// vertical scroll gestures on the sheet don't trip it.
const SWIPE_THRESHOLD_PX = 60;

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffM = Math.max(0, Math.round((now - then) / 60000));
  if (diffM < 60) return `${diffM}m ago`;
  const diffH = Math.round(diffM / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.round(diffH / 24);
  return `${diffD}d ago`;
}

// Slide-up dog detail sheet. Demo lines 105-113. First iteration — photo
// pop-ups and "I've seen this dog" reporting land in a later slice.
export function LostDogModal({
  dog,
  onClose,
  onReportSighting,
  onStartSearch,
  searchActive,
  onPrev,
  onNext,
}: LostDogModalProps) {
  const touchStartXRef = useRef<number | null>(null);
  if (!dog) return null;

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0]?.clientX ?? null;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartXRef.current;
    touchStartXRef.current = null;
    if (start == null) return;
    const end = e.changedTouches[0]?.clientX ?? start;
    const delta = end - start;
    if (Math.abs(delta) < SWIPE_THRESHOLD_PX) return;
    if (delta > 0) onPrev?.();
    else onNext?.();
  };

  const urgent = dog.urgency === 'urgent';
  const badgeText = urgent ? '🚨 URGENT' : '⚠️ searching';
  const badgeBg = urgent ? '#fde8e8' : '#fdf3e0';
  const badgeFg = urgent ? '#e84040' : '#d9a030';

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
        // Lift the sheet above the floating tab bar (~60-80px) so the
        // "i've seen them" button isn't covered by the dashboard.
        paddingBottom: 80,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        style={{
          background: '#ffffff',
          borderRadius: 24,
          padding: '22px 20px 22px',
          width: '100%',
          maxWidth: 430,
          position: 'relative',
          animation: 'dog-modal-up 0.3s cubic-bezier(0.4,0,0.2,1)',
          boxShadow: '0 -12px 40px rgba(0,0,0,0.2)',
        }}
      >
        {/* Prev/next chevrons — only rendered when the parent supplies
            cycle handlers. Positioned absolute so they sit in the
            sheet's side margins without reflowing the card content. */}
        {onPrev ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPrev();
            }}
            aria-label="previous pet"
            style={{
              position: 'absolute',
              left: 6,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 36,
              height: 36,
              borderRadius: 18,
              border: 'none',
              background: 'rgba(0,0,0,0.05)',
              color: '#444',
              fontSize: 22,
              lineHeight: 1,
              cursor: 'pointer',
            }}
          >
            ‹
          </button>
        ) : null}
        {onNext ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onNext();
            }}
            aria-label="next pet"
            style={{
              position: 'absolute',
              right: 6,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 36,
              height: 36,
              borderRadius: 18,
              border: 'none',
              background: 'rgba(0,0,0,0.05)',
              color: '#444',
              fontSize: 22,
              lineHeight: 1,
              cursor: 'pointer',
            }}
          >
            ›
          </button>
        ) : null}
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
              background: badgeBg,
              color: badgeFg,
              borderRadius: 12,
              padding: '4px 10px',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 0.5,
            }}
          >
            {badgeText}
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
          {dog.photoUrl ? (
            <img
              src={dog.photoUrl}
              alt={dog.name}
              style={{
                width: 68,
                height: 68,
                borderRadius: '50%',
                objectFit: 'cover',
                flexShrink: 0,
              }}
            />
          ) : (
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
              {dog.emoji}
            </div>
          )}
          <div>
            <div style={{ fontFamily: SYSTEM_FONT, fontSize: 24, fontWeight: 700 }}>
              {dog.name}
            </div>
            <div style={{ fontSize: 13, color: '#777', marginTop: 2 }}>{dog.breed}</div>
            <div style={{ fontSize: 12, color: '#777', marginTop: 3 }}>
              last seen {relativeTime(dog.lastSeen.at)}
            </div>
          </div>
        </div>

        <div
          style={{
            background: '#f0f0f0',
            borderRadius: 14,
            padding: '12px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 14,
          }}
        >
          <span style={{ fontSize: 22 }}>🐾</span>
          <div>
            <div style={{ fontFamily: SYSTEM_FONT, fontSize: 17, fontWeight: 700 }}>
              {dog.rewardPoints} pts reward
            </div>
            <div style={{ fontSize: 11, color: '#777' }}>bonus tokens near search zone</div>
          </div>
        </div>

        <button
          onClick={() => onReportSighting?.(dog)}
          style={{
            width: '100%',
            background: '#1a1a1a',
            color: '#ffffff',
            border: 'none',
            borderRadius: 16,
            padding: '14px 18px',
            fontFamily: SYSTEM_FONT,
            fontSize: 20,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          👀 i've seen them
        </button>

        <button
          onClick={() => onStartSearch?.(dog)}
          disabled={searchActive}
          style={{
            width: '100%',
            background: searchActive ? '#e8e8f2' : 'rgba(0,0,255,0.06)',
            color: searchActive ? '#777' : 'rgba(0,0,255,0.85)',
            border: searchActive
              ? '1px solid #d4d4dc'
              : '1px solid rgba(0,0,255,0.3)',
            borderRadius: 16,
            padding: '12px 18px',
            marginTop: 10,
            fontFamily: SYSTEM_FONT,
            fontSize: 17,
            fontWeight: 700,
            cursor: searchActive ? 'default' : 'pointer',
          }}
        >
          {searchActive ? '🔍 search in progress…' : '🔍 start search'}
        </button>

        <style>{`
          @keyframes dog-modal-up {
            from { transform: translateY(100%); }
            to { transform: translateY(0); }
          }
        `}</style>
      </div>
    </div>
  );
}
