import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { NearbyLostDog } from '../../services/api';
import { SYSTEM_FONT } from '../../constants/fonts';
import { Z } from '../../constants/z';
import { INLINE_ICON } from '../../constants/sizing';
import { Icon, type IconName } from './Icon';
import { useStrings } from '../../i18n/useStrings';
import type { AppStrings } from '../../i18n/strings';

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
// Big-photo height. Tall enough that the dog is recognisable AND
// portrait-aspect photos aren't cropped down to a thin slice. Got
// bumped 250 → 300 after the action buttons collapsed from two
// stacked rows into a single side-by-side pill row.
const PHOTO_HEIGHT_PX = 300;
// Reserve space at the top of the overlay so the modal can't grow
// up into the HUD pills (paws / bone / sun + menu icon). The HUD
// row sits in roughly the top ~90px (status bar + pills + breathing
// room). Without this, on browser viewports the modal's top edge
// landed right under the HUD instead of leaving a map gap.
const TOP_RESERVE_PX = 90;

// Shared style for the modal's three nav buttons (close X + prev/next
// chevrons). One size (40×40), one background, one centering recipe —
// dropping lineHeight in favour of flex so the unicode glyphs sit
// truly centred regardless of font metrics. The two prev/next
// variants merge `left`/`right` over the base via spread.
const NAV_BUTTON_BASE: CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 20,
  border: 'none',
  background: 'rgba(0,0,0,0.55)',
  color: '#ffffff',
  padding: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
};
const NAV_BUTTON_STYLE_CLOSE: CSSProperties = {
  ...NAV_BUTTON_BASE,
  position: 'absolute',
  top: 10,
  right: 10,
  // Slightly larger glyph for the close × since its visual weight is
  // narrower than the chevrons.
  fontSize: 26,
  lineHeight: 1,
};
const NAV_BUTTON_STYLE_SIDE: CSSProperties = {
  ...NAV_BUTTON_BASE,
  position: 'absolute',
  top: '50%',
  transform: 'translateY(-50%)',
  fontSize: 28,
  lineHeight: 1,
};

function relativeTime(iso: string, t: AppStrings): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffM = Math.max(0, Math.round((now - then) / 60000));
  if (diffM < 60) return t.time.ago(diffM, 'm');
  const diffH = Math.round(diffM / 60);
  if (diffH < 24) return t.time.ago(diffH, 'h');
  const diffD = Math.round(diffH / 24);
  return t.time.ago(diffD, 'd');
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
  const t = useStrings();
  const touchStartXRef = useRef<number | null>(null);
  const [renderDog, setRenderDog] = useState<NearbyLostDog | null>(dog);
  const [closing, setClosing] = useState(false);
  // Direction of the last cycle (prev / next / swipe) — drives the
  // slide-in keyframe on the inner content track. Null on a fresh
  // open so the initial sheet-up animation doesn't compose with a
  // horizontal slide.
  const [slideDir, setSlideDir] = useState<'left' | 'right' | null>(null);

  // Three transitions matter:
  //   prop dog: A   →  prop dog: B    (swap content, no animation)
  //   prop dog: A   →  null           (start closing → unmount after MS)
  //   prop dog: null → A              (mount, enter animation runs)
  useEffect(() => {
    if (dog) {
      // Fresh-open vs. cycle-swap: only clear slideDir on a fresh
      // open (renderDog was null). For A → B swaps, leave slideDir
      // set so the keyframe on the new track mount runs.
      if (!renderDog) setSlideDir(null);
      setRenderDog(dog);
      setClosing(false);
      return;
    }
    if (renderDog && !closing) {
      setClosing(true);
      const t = setTimeout(() => {
        setRenderDog(null);
        setClosing(false);
        setSlideDir(null);
      }, SHEET_ANIM_MS);
      return () => clearTimeout(t);
    }
  }, [dog]);

  if (!renderDog) return null;

  // Cycle helpers — set slideDir BEFORE invoking the parent callback
  // so the next render (with the new renderDog) picks up the right
  // direction for its keyframe.
  const handlePrev = () => {
    if (!onPrev) return;
    setSlideDir('left');
    onPrev();
  };
  const handleNext = () => {
    if (!onNext) return;
    setSlideDir('right');
    onNext();
  };

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
    if (delta > 0) handlePrev();
    else handleNext();
  };

  const urgent = renderDog.urgency === 'urgent';
  // 'warning' icon was retired; use 'search' for the non-urgent
  // 'searching' state — reads literally and stays in the designer set.
  const badgeIcon: IconName = urgent ? 'urgent' : 'search';
  const badgeText = urgent ? t.modals.lostDog.badgeUrgent : t.modals.lostDog.badgeSearching;
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
        zIndex: Z.MODAL_MAP,
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
        {/* Slide track — keyed on dog id so each prev/next remounts
            and runs the slide-in keyframe once. Chevrons sit OUTSIDE
            this wrapper (they're absolutely positioned on the sheet)
            so they stay put while the photo + body slide in. */}
        <div
          key={renderDog.id}
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minHeight: 0,
            animation: slideDir
              ? `slide-in-from-${slideDir} ${SHEET_ANIM_MS}ms cubic-bezier(0.2,0.7,0.3,1)`
              : undefined,
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
              // Opacity 0 → 1 on load so cold-cache photos fade in
              // gracefully instead of popping into the slid-in frame.
              // The grey backdrop on the photo container fills the
              // gap while we wait. Re-mounts with the slide-track on
              // dog id change, so each new pet starts at 0.
              onLoad={(e) => {
                e.currentTarget.style.opacity = '1';
              }}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                // Centre the source image both ways. Earlier we tried
                // 'center top' to preserve heads framed in the upper
                // half, but plenty of pet photos frame the dog in the
                // LOWER half (sitting / shot from above), and 'top'
                // dropped them off-screen. Centred is the safest
                // single-default for the corpus.
                objectPosition: 'center center',
                display: 'block',
                opacity: 0,
                transition: 'opacity 220ms ease-out',
                // Slight zoom-in so any baked-in white borders /
                // letterboxing in the source photo (some OLX listings
                // ship with a 4-8px white frame) are cropped away.
                // Kept conservative (1.04) so we don't over-crop the
                // dog itself.
                transform: 'scale(1.04)',
                transformOrigin: 'center center',
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
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Icon name={badgeIcon} size={INLINE_ICON.badge} />
            {badgeText}
          </span>
          <button
            onClick={onClose}
            aria-label={t.modals.common.close}
            style={NAV_BUTTON_STYLE_CLOSE}
          >
            ×
          </button>
        </div>

        {/* Body — name + meta, reward pill, primary actions. Scrolls
            internally if the modal can't fit on a tiny viewport. */}
        <div
          style={{
            padding: '12px 20px 14px',
            overflowY: 'auto',
            flexGrow: 1,
            minHeight: 0,
          }}
        >
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontFamily: SYSTEM_FONT, fontSize: 24, fontWeight: 700, lineHeight: 1.15 }}>
              {renderDog.name}
            </div>
            <div style={{ fontSize: 13, color: '#777', marginTop: 2 }}>{renderDog.breed}</div>
            <div style={{ fontSize: 12, color: '#777', marginTop: 2 }}>
              {t.modals.lostDog.lastSeen(relativeTime(renderDog.lastSeen.at, t))}
            </div>
            {/* Reward hint — replaces the chunky 200pts pill that
                used to sit between meta and the action buttons. The
                pill ate ~70px of vertical space on a surface where
                the photo is the actual point. */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: '#777',
                marginTop: 4,
              }}
            >
              <Icon name="paws" size={INLINE_ICON.secondary} />
              {t.modals.lostDog.questCta(renderDog.rewardPoints)}
            </div>
          </div>

          {/* Action buttons — side-by-side pills. Stacking them was
              eating ~100px on a surface where the photo IS the
              point. Both share equal width via flex: 1; primary
              (i've seen them) keeps the dark fill, secondary (start
              search) the outlined treatment. */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => onReportSighting?.(renderDog)}
              style={{
                flex: 1,
                background: '#1a1a1a',
                color: '#ffffff',
                border: 'none',
                borderRadius: 22,
                padding: '11px 14px',
                fontFamily: SYSTEM_FONT,
                fontSize: 15,
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              {/* `inverted` flips the eye icon to white so it shows
                  on the dark button bg — was rendering as black-on-
                  near-black and invisible. */}
              <Icon name="eyes" size={INLINE_ICON.cta} inverted />
              {t.modals.lostDog.iveSeen}
            </button>

            {/* Solid blue when active (was outline / pale tint that
                read weak next to the dark primary button). White
                text + white icon. Muted variant stays the soft tint
                so the disabled state reads inactive. */}
            <button
              onClick={() => onStartSearch?.(renderDog)}
              disabled={searchActive}
              style={{
                flex: 1,
                background: searchActive ? '#e8e8f2' : 'rgb(0,60,255)',
                color: searchActive ? '#777' : '#ffffff',
                border: searchActive ? '1px solid #d4d4dc' : 'none',
                borderRadius: 22,
                padding: '11px 14px',
                fontFamily: SYSTEM_FONT,
                fontSize: 15,
                fontWeight: 700,
                cursor: searchActive ? 'default' : 'pointer',
                whiteSpace: 'nowrap',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <Icon name="search" size={INLINE_ICON.cta} inverted={!searchActive} />
              {searchActive ? t.modals.lostDog.searchingCta : t.modals.lostDog.startSearch}
            </button>
          </div>
        </div>
        </div>

        {/* Prev/next chevrons — vertically centred on the whole card
            (top: 50%) so they sit around the photo/body seam, never
            on top of the action buttons. Dark translucent pill so
            they stay readable against any photo. Sit OUTSIDE the
            slide track so they don't move with the sliding content. */}
        {onPrev ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handlePrev();
            }}
            aria-label={t.modals.lostDog.previousPet}
            style={{ ...NAV_BUTTON_STYLE_SIDE, left: 10 }}
          >
            ‹
          </button>
        ) : null}
        {onNext ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleNext();
            }}
            aria-label={t.modals.lostDog.nextPet}
            style={{ ...NAV_BUTTON_STYLE_SIDE, right: 10 }}
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
          @keyframes slide-in-from-left {
            from { transform: translateX(-22px); }
            to   { transform: translateX(0); }
          }
          @keyframes slide-in-from-right {
            from { transform: translateX(22px); }
            to   { transform: translateX(0); }
          }
        `}</style>
      </div>
    </div>
  );
}
