import type { CSSProperties, TouchEvent as ReactTouchEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { NearbyLostDog } from '../../services/api';
import { SYSTEM_FONT } from '../../constants/fonts';
import { VOICE } from '../../constants/voice';
import { Z } from '../../constants/z';
import { R } from '../../constants/radius';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
import { useStrings } from '../../i18n/useStrings';
import type { AppStrings } from '../../i18n/strings';
import { useGameStore } from '../../stores/gameStore';
import { distanceMeters } from '../../utils/geo';
import { playPopThen } from '../../utils/popOnTap';

function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m / 50) * 50} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

interface LostDogModalProps {
  dog: NearbyLostDog | null;
  onClose: () => void;
  onReportSighting?: (dog: NearbyLostDog) => void;
  onStartSearch?: (dog: NearbyLostDog) => void;
  // Read the owner's post without leaving. Deliberately NOT a pill: the
  // two decisions on this card are "I've seen them" and "start search",
  // and a third button of equal weight would blunt both. This is the
  // detail you reach for mid-search when you are looking at an animal
  // and asking "is this the one" — quieter than a choice, always there.
  onOpenPost?: (dog: NearbyLostDog) => void;
  // When this dog already has an active search, swap the "start search"
  // button for a muted "searching…" affordance.
  searchActive?: boolean;
  // Optional prev/next cycling between the nearby pets — horizontal
  // swipe on the bubble stack. Either both or neither.
  onPrev?: () => void;
  onNext?: () => void;
}

// Horizontal swipe threshold (px). Small enough for a thumb flick, big
// enough that a stray diagonal drag doesn't trip a cycle.
const SWIPE_THRESHOLD_PX = 60;

const SHEET_ANIM_MS = 240;

// The stack hangs from the TOP, just below the HUD row (logo + pills):
// safe-area inset + HUD height + a breathing gap. The camera (MapView's
// dog-view ease) offsets the pin DOWN to sit right under the stack, so
// HUD → bubble → pills → pin reads as one centred column on every
// viewport instead of the bubble riding up into the HUD on short ones.
// Keep in sync with DOG_VIEW_* in MapView if retuned.
const STACK_TOP = 'calc(env(safe-area-inset-top, 0px) + 122px)';

// Matches the SniffPress discovery CTA — the brand-blue pill under the
// dark story bubble.
const SNIFF_BLUE = '#2f6bff';

const PILL_BASE: CSSProperties = {
  padding: '10px 18px',
  borderRadius: R.pill,
  border: 'none',
  fontFamily: SYSTEM_FONT,
  fontSize: TYPE.small,
  fontWeight: 700,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: S.xs,
  userSelect: 'none',
};

const PILL_PRIMARY: CSSProperties = {
  ...PILL_BASE,
  background: SNIFF_BLUE,
  color: '#ffffff',
  boxShadow: '0 4px 12px rgba(47,107,255,0.35)',
};

const PILL_SECONDARY: CSSProperties = {
  ...PILL_BASE,
  background: '#ffffff',
  color: '#1a1a1a',
  boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
};

const PILL_DISABLED: CSSProperties = {
  ...PILL_BASE,
  background: 'rgba(255,255,255,0.25)',
  color: 'rgba(255,255,255,0.8)',
  cursor: 'default',
  boxShadow: 'none',
};

// Status tint on the dark bubble — brand blue only (lightened for
// legibility on #1a1a1a). Red/amber urgency colouring is retired from
// this view: everything the dog view marks is blue.
const BADGE_ON_DARK = '#8fb0ff';

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

// Minimal lost-pet card in the SniffPress discovery style: a dark story
// bubble + action pills floating just above the big centred photo pin.
// No photo inside — the pin IS the photo. Transparent scrim (the
// cinematic zone shot is the content); outside tap closes; horizontal
// swipe cycles the nearby pets when onPrev/onNext are wired.
export function LostDogModal({
  dog,
  onClose,
  onReportSighting,
  onStartSearch,
  onOpenPost,
  searchActive,
  onPrev,
  onNext,
}: LostDogModalProps) {
  const t = useStrings();
  const userPos = useGameStore((s) => s.userPosition);
  const [renderDog, setRenderDog] = useState<NearbyLostDog | null>(dog);
  const [closing, setClosing] = useState(false);
  // Direction of the last cycle — drives the slide-in keyframe on the
  // keyed content track. null on a fresh open so the pop-in enter
  // animation doesn't compose with a horizontal slide.
  const [slideDir, setSlideDir] = useState<'left' | 'right' | null>(null);
  const touchStartXRef = useRef<number | null>(null);

  // Three transitions matter:
  //   prop dog: A   →  prop dog: B    (swap content, slide animation)
  //   prop dog: A   →  null           (start closing → unmount after MS)
  //   prop dog: null → A              (mount, enter animation runs)
  useEffect(() => {
    if (dog) {
      // Only clear slideDir on a fresh open (renderDog was null). For
      // A → B cycle swaps, leave it set so the new track mount slides.
      if (!renderDog) setSlideDir(null);
      setRenderDog(dog);
      setClosing(false);
      return;
    }
    if (renderDog && !closing) {
      setClosing(true);
      const timer = setTimeout(() => {
        setRenderDog(null);
        setClosing(false);
        setSlideDir(null);
      }, SHEET_ANIM_MS);
      return () => clearTimeout(timer);
    }
  }, [dog]);

  if (!renderDog) return null;
  if (typeof document === 'undefined') return null;

  // Cycle helpers — set slideDir BEFORE the parent swaps the dog so the
  // next render's track mount picks up the right direction.
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
  const handleTouchStart = (e: ReactTouchEvent) => {
    touchStartXRef.current = e.touches[0]?.clientX ?? null;
  };
  const handleTouchEnd = (e: ReactTouchEvent) => {
    const start = touchStartXRef.current;
    touchStartXRef.current = null;
    if (start == null || (!onPrev && !onNext)) return;
    const end = e.changedTouches[0]?.clientX ?? start;
    const delta = end - start;
    if (Math.abs(delta) < SWIPE_THRESHOLD_PX) return;
    if (delta > 0) handlePrev();
    else handleNext();
  };

  const urgent = renderDog.urgency === 'urgent';
  const badgeText = urgent ? t.modals.lostDog.badgeUrgent : t.modals.lostDog.badgeSearching;
  const badgeFg = BADGE_ON_DARK;
  const distLabel = userPos
    ? formatDistance(distanceMeters(userPos, renderDog.lastSeen.position))
    : null;

  // Portal to document.body so the stack escapes the MapView / tab-page
  // stacking context (the HUD pills would otherwise paint over it).
  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        // Transparent scrim: the cinematic zone shot (lit zone + big
        // photo pin) IS the content. Outside tap closes.
        background: 'transparent',
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
          position: 'absolute',
          left: 0,
          right: 0,
          top: STACK_TOP as unknown as number,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          pointerEvents: 'auto',
          animation: `dog-bubble-${closing ? 'out' : 'in'} ${SHEET_ANIM_MS}ms cubic-bezier(0.34, 1.2, 0.64, 1) forwards`,
        }}
      >
        {/* Per-dog content TRACK — keyed by id so a prev/next swap
            remounts it and runs the slide-in keyframe. */}
        <div
          key={renderDog.id}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: S.m,
            animation: slideDir
              ? `slide-in-from-${slideDir} ${SHEET_ANIM_MS}ms cubic-bezier(0.2,0.7,0.3,1)`
              : undefined,
          }}
        >
          {/* Dark story bubble — same voice family as the sniff
              discovery bubble. Minimum info: name, breed, one meta
              line, reward. */}
          <div
            style={{
              padding: '14px 18px',
              background: VOICE.background,
              color: VOICE.color,
              borderRadius: R.chip,
              fontFamily: VOICE.fontFamily,
              boxShadow: VOICE.shadow,
              border: VOICE.border,
              textAlign: 'center',
              maxWidth: 300,
            }}
          >
            <div
              style={{
                fontSize: 19,
                fontWeight: 800,
                lineHeight: 1.2,
              }}
            >
              {renderDog.name}
              {renderDog.breed ? (
                <span style={{ fontWeight: 600, opacity: 0.7 }}>
                  {' '}
                  · {renderDog.breed}
                </span>
              ) : null}
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: TYPE.small,
                lineHeight: 1.4,
              }}
            >
              <span style={{ color: badgeFg, fontWeight: 700 }}>{badgeText}</span>
              {distLabel ? <span> · {distLabel}</span> : null}
              <span> · {t.modals.lostDog.lastSeen(relativeTime(renderDog.lastSeen.at, t))}</span>
            </div>
            <div
              style={{
                marginTop: 4,
                fontSize: TYPE.caption,
                opacity: 0.75,
              }}
            >
              {t.modals.lostDog.questCta(renderDog.rewardPoints)}
            </div>
            {onOpenPost ? (
              <button
                onClick={() => onOpenPost(renderDog)}
                style={{
                  marginTop: 8,
                  padding: 0,
                  border: 'none',
                  background: 'none',
                  color: BADGE_ON_DARK,
                  fontFamily: SYSTEM_FONT,
                  fontSize: TYPE.caption,
                  fontWeight: 700,
                  textDecoration: 'underline',
                  cursor: 'pointer',
                }}
              >
                {t.modals.lostDog.readPost}
              </button>
            ) : null}
          </div>

          {/* Action pills — brand-blue primary (start search), white
              secondary (i've seen), side by side under the bubble. */}
          <div style={{ display: 'flex', gap: S.s }}>
            <button
              onClick={(e) =>
                playPopThen(e.currentTarget, () => onReportSighting?.(renderDog))
              }
              style={PILL_SECONDARY}
            >
              {t.modals.lostDog.iveSeen}
            </button>
            <button
              onClick={(e) =>
                playPopThen(e.currentTarget, () => onStartSearch?.(renderDog))
              }
              disabled={searchActive}
              style={searchActive ? PILL_DISABLED : PILL_PRIMARY}
            >
              {searchActive
                ? t.modals.lostDog.searchingCta
                : `${t.modals.lostDog.startSearch} →`}
            </button>
          </div>
        </div>
        {/* end content track */}

        <style>{`
          @keyframes dog-bubble-in {
            from { transform: translateY(14px) scale(0.94); opacity: 0; }
            to   { transform: translateY(0) scale(1); opacity: 1; }
          }
          @keyframes dog-bubble-out {
            from { transform: translateY(0) scale(1); opacity: 1; }
            to   { transform: translateY(10px) scale(0.96); opacity: 0; }
          }
          @keyframes slide-in-from-left {
            from { transform: translateX(-22px); opacity: 0.4; }
            to   { transform: translateX(0); opacity: 1; }
          }
          @keyframes slide-in-from-right {
            from { transform: translateX(22px); opacity: 0.4; }
            to   { transform: translateX(0); opacity: 1; }
          }
        `}</style>
      </div>
    </div>,
    document.body,
  );
}
