import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { NearbyLostDog } from '../../services/api';
import { SYSTEM_FONT } from '../../constants/fonts';
import { Z } from '../../constants/z';
import { INLINE_ICON } from '../../constants/sizing';
import { R } from '../../constants/radius';
import { TYPE } from '../../constants/type';
import {
  MODAL_PILL_DARK,
  MODAL_PILL_BLUE,
  MODAL_PILL_DISABLED,
} from '../../constants/buttons';
import { Icon, type IconName } from './Icon';
import { useStrings } from '../../i18n/useStrings';
import type { AppStrings } from '../../i18n/strings';
import { useGameStore } from '../../stores/gameStore';
import { distanceMeters } from '../../utils/geo';

function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m / 50) * 50} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

interface LostDogModalProps {
  dog: NearbyLostDog | null;
  onClose: () => void;
  onReportSighting?: (dog: NearbyLostDog) => void;
  onStartSearch?: (dog: NearbyLostDog) => void;
  // When this dog already has an active detective quest, swap the
  // "start search" button for a muted "searching…" affordance that
  // leads to the abandon-via-pill flow instead of double-starting.
  searchActive?: boolean;
}

const SHEET_ANIM_MS = 280;
const PHOTO_HEIGHT_PX = 380;
// Modal is anchored to the viewport top now, so the close button +
// badge need to clear the OS status-bar / notch area. env() lookup
// falls back to 0 in non-PWA Safari (no inset), 12 in standalone
// PWA on notched iPhones.
const SAFE_TOP = 'calc(env(safe-area-inset-top, 0px) + 12px)';

// Close button without the absolute positioning — now sits inside
// a flex row with the distance chip in the top-right cluster.
// Plain white (no rgba / backdrop blur) so it matches the rest of
// the chip family — every modal / card chip is solid white now.
const CLOSE_BUTTON_STYLE_NOABS: CSSProperties = {
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
  boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
  fontSize: TYPE.display,
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

// Slide-up dog detail sheet. Photo-led hero with name + breed on a
// gradient overlay (matches the LostDogCardStack visual treatment),
// then a slim info row + action pills below. Single dog at a time —
// no prev/next cycling; the user taps another map marker to switch.
export function LostDogModal({
  dog,
  onClose,
  onReportSighting,
  onStartSearch,
  searchActive,
}: LostDogModalProps) {
  const t = useStrings();
  const userPos = useGameStore((s) => s.userPosition);
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
  if (typeof document === 'undefined') return null;

  const urgent = renderDog.urgency === 'urgent';
  const badgeIcon: IconName = urgent ? 'urgent' : 'search';
  const badgeText = urgent ? t.modals.lostDog.badgeUrgent : t.modals.lostDog.badgeSearching;
  const badgeFg = urgent ? '#e84040' : '#d9a030';
  const distLabel = userPos
    ? formatDistance(distanceMeters(userPos, renderDog.lastSeen.position))
    : null;

  // Portal to document.body so the modal escapes the MapView /
  // tab-page stacking context. Without this, the HUD pills (rendered
  // as a sibling of MapView with zIndex: HUD_PILLS) paint over the
  // modal regardless of MODAL_MAP z-index, because the mapLayer
  // container has no z-index of its own.
  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.3)',
        display: 'flex',
        // Anchored at the TOP — sheet slides down from off-screen-
        // top and covers the HUD area like a dashboard / system-
        // notification panel.
        alignItems: 'flex-start',
        justifyContent: 'center',
        // Tab bar at the bottom is visible behind the modal's
        // dimmed overlay; no padding needed at top (sheet bleeds
        // to viewport edge).
        zIndex: Z.MODAL_MAP,
        opacity: closing ? 0 : 1,
        transition: `opacity ${SHEET_ANIM_MS}ms ease-out`,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#ffffff',
          // Full-bleed top edge (no rounded corners), rounded
          // bottom only — reads as a card hanging from the top
          // of the screen.
          borderTopLeftRadius: 0,
          borderTopRightRadius: 0,
          borderBottomLeftRadius: R.card,
          borderBottomRightRadius: R.card,
          padding: 0,
          width: '100%',
          maxWidth: 460,
          // Cap height so the action pills always stay above the
          // tab bar. 100vh - tab-bar-area - small breather.
          maxHeight: 'calc(100vh - 110px - env(safe-area-inset-bottom))' as unknown as number,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          animation: `top-sheet-${closing ? 'out' : 'in'} ${SHEET_ANIM_MS}ms cubic-bezier(0.4,0,0.2,1) forwards`,
          boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
          overflow: 'hidden',
        }}
      >
        {/* Photo hero — fills the top of the modal. Name + breed sit
            on a dark-to-transparent gradient over the bottom third
            so the dog's image is the visual anchor (same recipe as
            the LostDogCardStack on the tasks tab). Badge top-left,
            close top-right. */}
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
              onLoad={(e) => {
                e.currentTarget.style.opacity = '1';
              }}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                objectPosition: 'center center',
                display: 'block',
                opacity: 0,
                transition: 'opacity 220ms ease-out',
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
                fontSize: 120,
              }}
            >
              {renderDog.emoji}
            </div>
          )}
          {/* Photo gradient — carries the white name + breed text
              over the bottom half of the photo. */}
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: '55%',
              background:
                'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.1) 35%, rgba(0,0,0,0.72) 100%)',
              pointerEvents: 'none',
            }}
          />
          {/* Urgency badge — top: SAFE_TOP so it clears the iPhone
              notch / status bar with the modal anchored at viewport
              top. */}
          <span
            style={{
              position: 'absolute',
              top: SAFE_TOP,
              left: 14,
              background: '#ffffff',
              color: badgeFg,
              // Full-pill + lifted shadow to match the HUD / chat
              // pill family across the app.
              borderRadius: R.pill,
              padding: '6px 12px',
              fontSize: TYPE.small,
              fontWeight: 700,
              letterSpacing: 0.5,
              boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Icon name={badgeIcon} size={INLINE_ICON.badge} />
            {badgeText}
          </span>
          {/* Top-right cluster — distance chip + close button. */}
          <div
            style={{
              position: 'absolute',
              top: SAFE_TOP,
              right: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {distLabel ? (
              <span
                style={{
                  background: '#ffffff',
                  color: '#555',
                  borderRadius: R.pill,
                  padding: '6px 12px',
                  fontSize: TYPE.small,
                  fontWeight: 700,
                  letterSpacing: 0.3,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
                }}
              >
                {distLabel}
              </span>
            ) : null}
            <button
              onClick={onClose}
              aria-label={t.modals.common.close}
              style={CLOSE_BUTTON_STYLE_NOABS}
            >
              ×
            </button>
          </div>
          {/* Name + breed overlay on the gradient */}
          <div
            style={{
              position: 'absolute',
              left: 22,
              right: 22,
              bottom: 22,
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                fontFamily: SYSTEM_FONT,
                fontSize: TYPE.display,
                fontWeight: 800,
                lineHeight: 1.1,
                color: '#ffffff',
                textShadow: '0 1px 4px rgba(0,0,0,0.45)',
              }}
            >
              {renderDog.name}
            </div>
            {renderDog.breed ? (
              <div
                style={{
                  fontFamily: SYSTEM_FONT,
                  fontSize: TYPE.body,
                  color: 'rgba(255,255,255,0.92)',
                  marginTop: 4,
                  textShadow: '0 1px 4px rgba(0,0,0,0.4)',
                }}
              >
                {renderDog.breed}
              </div>
            ) : null}
          </div>
        </div>

        {/* Info section — last-seen meta + reward hint. Scrolls
            internally if the viewport is so short that even after
            photo + actions there's no room for it. */}
        <div
          style={{
            padding: '16px 22px 8px',
            overflowY: 'auto',
            flexGrow: 1,
            minHeight: 0,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: TYPE.small, color: '#555' }}>
              {t.modals.lostDog.lastSeen(relativeTime(renderDog.lastSeen.at, t))}
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: TYPE.small,
                color: '#777',
              }}
            >
              <Icon name="paws" size={INLINE_ICON.secondary} />
              {t.modals.lostDog.questCta(renderDog.rewardPoints)}
            </div>
          </div>
        </div>

        {/* Action pills — fixed at the bottom of the modal so they
            never scroll out of view. flexShrink: 0 keeps them at
            their natural height regardless of the info section's
            content above. */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            padding: '12px 22px 20px',
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => onReportSighting?.(renderDog)}
            style={MODAL_PILL_DARK}
          >
            <Icon name="eyes" size={INLINE_ICON.cta} inverted />
            {t.modals.lostDog.iveSeen}
          </button>
          <button
            onClick={() => onStartSearch?.(renderDog)}
            disabled={searchActive}
            style={searchActive ? MODAL_PILL_DISABLED : MODAL_PILL_BLUE}
          >
            <Icon name="search" size={INLINE_ICON.cta} inverted={!searchActive} />
            {searchActive ? t.modals.lostDog.searchingCta : t.modals.lostDog.startSearch}
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
