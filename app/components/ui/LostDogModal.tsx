import { useEffect, useRef, useState } from 'react';
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

const SHEET_ANIM_MS = 280;
// Big-photo height. Tall enough that the dog is recognisable at a
// glance (no extra tap-to-zoom step), short enough that the modal
// still leaves room for name + reward + two action buttons above
// the bottom dashboard AND clears the top HUD on shorter Safari
// viewports (URL bar eats ~80-100px more than a PWA install).
const PHOTO_HEIGHT_PX = 220;
// Reserve space at the top of the overlay so the modal can't grow
// up into the HUD pills (paws / bone / sun + menu icon). The HUD
// row sits in roughly the top ~90px (status bar + pills + breathing
// room). Without this, on browser viewports the modal's top edge
// landed right under the HUD instead of leaving a map gap.
const TOP_RESERVE_PX = 90;

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

// Slide-up dog detail sheet. Animates in on mount, animates out before
// unmounting via the closing-state timeout so dismiss feels reversible.
// Same recipe lives in SpotModal — refactor into a shared <BottomSheet>
// helper if a third sheet shows up.
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
  const [renderDog, setRenderDog] = useState<NearbyLostDog | null>(dog);
  const [closing, setClosing] = useState(false);

  // Three transitions matter:
  //   prop dog: A   →  prop dog: B    (swap content, no animation)
  //   prop dog: A   →  null           (start closing → unmount after MS)
  //   prop dog: null → A              (mount, enter animation runs)
  useEffect(() => {
    if (dog) {
      setRenderDog(dog);
      setClosing(false);
      return;
    }
    if (renderDog && !closing) {
      setClosing(true);
      const t = setTimeout(() => {
        setRenderDog(null);
        setClosing(false);
      }, SHEET_ANIM_MS);
      return () => clearTimeout(t);
    }
  }, [dog]);

  if (!renderDog) return null;

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

  const urgent = renderDog.urgency === 'urgent';
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
        // Lift the sheet above the bottom dashboard so the "i've seen
        // them" button isn't covered. Adds env(safe-area-inset-bottom)
        // so PWA on notched iPhones (where the tab bar sits behind a
        // ~34px home-indicator strip) gets the same visual breathing
        // room as Android/desktop.
        paddingBottom: 'calc(100px + env(safe-area-inset-bottom))' as unknown as number,
        // Hard top reserve so the modal can never grow into the HUD
        // area on shorter viewports (Safari with URL bar). Combined
        // with overflow:hidden on the sheet, content gets clipped
        // here rather than overlapping the pills above.
        paddingTop: TOP_RESERVE_PX,
        zIndex: 50,
        opacity: closing ? 0 : 1,
        transition: `opacity ${SHEET_ANIM_MS}ms ease-out`,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        style={{
          background: '#ffffff',
          borderRadius: 24,
          // Photo bleeds to the modal edges (no horizontal padding on
          // the top), so we control padding per-section below.
          padding: 0,
          width: '100%',
          maxWidth: 480,
          // Cap at the available height (overlay's flex content area)
          // so on shorter viewports the body scrolls instead of the
          // whole sheet pushing up past paddingTop into the HUD.
          maxHeight: '100%',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          animation: `sheet-${closing ? 'down' : 'up'} ${SHEET_ANIM_MS}ms cubic-bezier(0.4,0,0.2,1) forwards`,
          boxShadow: '0 -10px 30px rgba(0,0,0,0.12)',
          overflow: 'hidden',
        }}
      >
        {/* Big photo banner — fills the top of the modal so the dog is
            recognisable at a glance. Falls back to a coloured panel
            with the emoji centred when no photo is available.
            Badge + close button float over the photo for compactness.
            flexShrink: 0 keeps the photo at its full height when the
            body scrolls on shorter viewports. */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: PHOTO_HEIGHT_PX,
            flexShrink: 0,
            background: '#f0f0f0',
            overflow: 'hidden',
          }}
        >
          {renderDog.photoUrl ? (
            <img
              src={renderDog.photoUrl}
              alt={renderDog.name}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
              }}
            />
          ) : (
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 96,
              }}
            >
              {renderDog.emoji}
            </div>
          )}
          {/* Subtle bottom gradient so the white modal body never feels
              like a hard edge against a dark photo. */}
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: 48,
              background:
                'linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.95) 100%)',
              pointerEvents: 'none',
            }}
          />
          <span
            style={{
              position: 'absolute',
              top: 14,
              left: 14,
              background: badgeBg,
              color: badgeFg,
              borderRadius: 12,
              padding: '5px 11px',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 0.5,
              boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
            }}
          >
            {badgeText}
          </span>
          <button
            onClick={onClose}
            aria-label="close"
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              width: 32,
              height: 32,
              borderRadius: 16,
              border: 'none',
              background: 'rgba(0,0,0,0.55)',
              color: '#ffffff',
              fontSize: 22,
              lineHeight: '32px',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            ×
          </button>
        </div>

        {/* Body — name + meta, reward pill, primary actions. Scrolls
            internally if the modal can't fit on a tiny viewport. */}
        <div
          style={{
            padding: '14px 22px 22px',
            overflowY: 'auto',
            flexGrow: 1,
            minHeight: 0,
          }}
        >
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: SYSTEM_FONT, fontSize: 26, fontWeight: 700, lineHeight: 1.15 }}>
              {renderDog.name}
            </div>
            <div style={{ fontSize: 14, color: '#777', marginTop: 3 }}>{renderDog.breed}</div>
            <div style={{ fontSize: 12, color: '#777', marginTop: 3 }}>
              last seen {relativeTime(renderDog.lastSeen.at)}
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
                {renderDog.rewardPoints} pts reward
              </div>
              <div style={{ fontSize: 11, color: '#777' }}>bonus tokens near search zone</div>
            </div>
          </div>

          <button
            onClick={() => onReportSighting?.(renderDog)}
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
            onClick={() => onStartSearch?.(renderDog)}
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
        </div>

        {/* Prev/next chevrons — only rendered when the parent supplies
            cycle handlers. Vertically centred on the body (below the
            photo) so they don't sit on top of the photo content. */}
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
              bottom: 110,
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
              bottom: 110,
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
