import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { NearbyLostDog } from '../../services/api';
import { SYSTEM_FONT } from '../../constants/fonts';
import { colors } from '../../constants/colors';
import { VOICE } from '../../constants/voice';
import { Z } from '../../constants/z';
import { R } from '../../constants/radius';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
import { INK, SURFACE } from '../../constants/surface';
import {
  MODAL_PILL_DARK,
  MODAL_PILL_DISABLED,
  MODAL_PILL_LIGHT,
} from '../../constants/buttons';
import { INLINE_ICON } from '../../constants/sizing';
import { useStrings } from '../../i18n/useStrings';
import type { AppStrings } from '../../i18n/strings';
import { useGameStore } from '../../stores/gameStore';
import { distanceMeters, formatDistance } from '../../utils/geo';
import { playPop, playPopThen } from '../../utils/popOnTap';
import { HandDrawnFrame } from './HandDrawn';
import { Icon } from './Icon';
import { CloseButton } from './CloseButton';
import { useSheetBack } from '../../hooks/useSheetBack';
import { MOTION } from '../../utils/motion';

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

const SHEET_ANIM_MS = MOTION.sheetMs;

// The stack hangs from the TOP, just below the HUD row (logo + pills):
// safe-area inset + HUD height + a breathing gap. The camera (MapView's
// dog-view ease) offsets the pin DOWN to sit right under the stack, so
// HUD → bubble → pills → pin reads as one centred column on every
// viewport instead of the bubble riding up into the HUD on short ones.
// Keep in sync with DOG_VIEW_* in MapView if retuned.
const STACK_TOP = 'calc(env(safe-area-inset-top, 0px) + 122px)';

// The house pill recipe (UX-9.9) — these used to fork their own
// (10×18, no flex share, a different gap). What stays their own is the
// deeper shadow: the pair hangs under the bubble straight over the lit
// search zone and the big photo pin, which can be any colour, and the
// chip shadow alone lost them against a busy zone shot.
const PILL_PRIMARY: CSSProperties = {
  ...MODAL_PILL_DARK,
  boxShadow: SURFACE.onPhoto,
};

const PILL_SECONDARY: CSSProperties = {
  ...MODAL_PILL_LIGHT,
  boxShadow: SURFACE.onPhoto,
};

// The shared disabled pill with the same deeper shadow. It used to be
// white-on-translucent, a ghost meant for a dark bubble: over the pale
// basemap "searching…" could not be read at all (UX-9.2). The grey edge
// rather than the ink one still says "not a button".
const PILL_DISABLED: CSSProperties = {
  ...MODAL_PILL_DISABLED,
  boxShadow: SURFACE.onPhoto,
};

// The action row has a fixed width, so the two pills split it evenly
// the way every other two-button row in the app does, capped to the
// screen with the usual side gutter.
const ROW_STYLE: CSSProperties = {
  display: 'flex',
  gap: S.s,
  width: `min(340px, calc(100vw - ${2 * S.l}px))`,
};

// On a 320px phone a label plus its icon runs a few px past half the
// row; let it take a second line there rather than push the row off
// centre. At 360 and up they stay on one.
const WRAP: CSSProperties = { whiteSpace: 'normal', minWidth: 0, lineHeight: 1.15 };

// Prev / next chevrons: 44 tall to hit, as wide as the bubble's side
// padding so they never sit over the text, vertically centred.
const CHEVRON: CSSProperties = {
  position: 'absolute',
  top: '50%',
  transform: 'translateY(-50%)',
  // The bubble's 30px side padding.
  width: 30,
  height: 44,
  padding: 0,
  border: 'none',
  background: 'none',
  color: colors.grey,
  fontFamily: SYSTEM_FONT,
  fontSize: TYPE.display,
  lineHeight: 1,
  cursor: 'pointer',
};

// Status tint. This was '#8fb0ff' — brand blue lightened to survive on
// a #1a1a1a bubble. The bubble is white paper now, so it takes the
// blue at full strength instead: same meaning, legible on the surface
// it actually sits on. Red/amber urgency colouring stays retired from
// this view — everything the dog view marks is blue.
const BADGE_TINT = colors.sniffBlue;

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

// Minimal lost-pet card in the SniffPress discovery style: a white
// paper panel + action pills floating just above the big centred photo pin.
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
  // "I've seen" is two taps on purpose: the first asks, the second
  // files. A sighting is a real report on someone's lost pet, placed at
  // wherever the walker is standing, and it can move the pet's public
  // pin — one stray tap on a card is not enough to say that.
  const [confirmingSeen, setConfirmingSeen] = useState(false);
  // Latched by the confirming tap, so the ~360 ms between it and the
  // card being gone (pop delay + close animation) cannot fire a second
  // report. Cleared when the card moves to another pet.
  const firedRef = useRef(false);

  // Three transitions matter:
  //   prop dog: A   →  prop dog: B    (swap content, slide animation)
  //   prop dog: A   →  null           (start closing → unmount after MS)
  //   prop dog: null → A              (mount, enter animation runs)
  useEffect(() => {
    if (dog) {
      // Only clear slideDir on a fresh open (renderDog was null). For
      // A → B cycle swaps, leave it set so the new track mount slides.
      if (!renderDog) setSlideDir(null);
      // A new pet, or the same one reopened mid-fade: either way a
      // fresh card, so the question and the latch start over.
      if (dog.id !== renderDog?.id || closing) {
        setConfirmingSeen(false);
        firedRef.current = false;
      }
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

  // Back and Escape close it, like its close pill (UX-2.5, UX-14.1).
  useSheetBack(!!dog, onClose);

  // Left / right arrow keys step through the nearby pets, the keyboard's
  // version of the swipe (UX-9.20). The handlers are read through a ref:
  // MapView passes fresh arrows on every render, and it renders ~10×/s,
  // so depending on them would re-bind the listener at that rate.
  const cycleRef = useRef({ onPrev, onNext });
  cycleRef.current = { onPrev, onNext };
  const open = !!dog;
  const canCycle = !!onPrev || !!onNext;
  useEffect(() => {
    if (!open || !canCycle) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      // An arrow in a text field moves the caret; it never flips pets.
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const { onPrev: prev, onNext: next } = cycleRef.current;
      if (e.key === 'ArrowLeft' && prev) {
        e.preventDefault();
        setSlideDir('left');
        prev();
      } else if (e.key === 'ArrowRight' && next) {
        e.preventDefault();
        setSlideDir('right');
        next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, canCycle]);

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
  // Pointer events, not touch (UX-9.20): the same flick now works with a
  // mouse or a pen, not only a finger.
  const handlePointerDown = (e: ReactPointerEvent) => {
    touchStartXRef.current = e.clientX;
  };
  const handlePointerUp = (e: ReactPointerEvent) => {
    const start = touchStartXRef.current;
    touchStartXRef.current = null;
    if (start == null || (!onPrev && !onNext)) return;
    const end = e.clientX;
    const delta = end - start;
    if (Math.abs(delta) < SWIPE_THRESHOLD_PX) return;
    if (delta > 0) handlePrev();
    else handleNext();
  };

  const urgent = renderDog.urgency === 'urgent';
  const badgeText = urgent ? t.modals.lostDog.badgeUrgent : t.modals.lostDog.badgeSearching;
  const badgeFg = BADGE_TINT;
  const distLabel = userPos
    ? formatDistance(distanceMeters(userPos, renderDog.lastSeen.position), t.units)
    : null;

  // Portal to document.body so the stack escapes the MapView / tab-page
  // stacking context (the HUD pills would otherwise paint over it).
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
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
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          touchStartXRef.current = null;
        }}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: STACK_TOP as unknown as number,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          // Dead while it fades out: the pills are still painted for
          // the close animation, and a tap on them then would act on a
          // card that is already going.
          pointerEvents: closing ? 'none' : 'auto',
          // Vertical pans stay the browser's; horizontal ones are ours.
          // Without this a phone treats the flick as the start of a pan
          // and sends pointercancel instead of pointerup, and the swipe
          // never lands — the touch handlers this replaced never had
          // that problem, pointer events do.
          touchAction: 'pan-y',
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
          {/* Story card — white paper like the sniff discovery card,
              with the same drawn edge. Minimum info: name, breed, one
              meta line, reward. */}
          <div
            style={{
              // Wider at the sides than the top so a long name, centred,
              // never runs under the close disc on the corner.
              padding: '14px 30px',
              background: SURFACE.fill,
              color: INK,
              borderRadius: R.card,
              fontFamily: VOICE.fontFamily,
              boxShadow: VOICE.shadow,
              // Reserved, not painted: the ink is the HandDrawnFrame
              // below. It was a ruler-straight CSS line, the one paper
              // surface in the app whose edge was not drawn (UX-10.11).
              border: '2px solid transparent',
              textAlign: 'center',
              // Capped to the screen with room for the close disc's
              // S.l overhang: at a flat 300 on a 320px phone the disc
              // hung 6px off the right edge.
              maxWidth: `min(300px, calc(100vw - ${2 * (S.l + S.s)}px))`,
              // Anchors the close disc on the corner.
              position: 'relative',
            }}
          >
            {/* Drawn edge — see HandDrawn.tsx. */}
            <HandDrawnFrame radius={R.card} />
            {/* A VISIBLE CLOSE (UX-9.21). Tapping the map around the card
                always closed it, but nothing said so — people looking at
                a lost pet's card had no drawn way out. The app's one
                close (D9), sat on the bubble's corner like a badge so it
                takes no room from the text. */}
            <CloseButton
              onPress={onClose}
              style={{ position: 'absolute', top: -S.l, right: -S.l }}
            />
            {/* Prev / next, for anyone without a thumb to swipe with
                (UX-9.20): the swipe was touch-only, so on a desktop, or
                with a keyboard, the other nearby pets were unreachable
                and nothing hinted they were there. Quiet chevrons in the
                bubble's own side padding, so they take no room from the
                text and read as "there is more this way" first. */}
            {onPrev ? (
              <button
                onClick={(e) => {
                  playPop(e.currentTarget);
                  handlePrev();
                }}
                aria-label={t.modals.lostDog.previousPet}
                style={{ ...CHEVRON, left: 0 }}
              >
                ‹
              </button>
            ) : null}
            {onNext ? (
              <button
                onClick={(e) => {
                  playPop(e.currentTarget);
                  handleNext();
                }}
                aria-label={t.modals.lostDog.nextPet}
                style={{ ...CHEVRON, right: 0 }}
              >
                ›
              </button>
            ) : null}
            <div
              style={{
                fontSize: 19,
                fontWeight: 800,
                lineHeight: 1.2,
              }}
            >
              {renderDog.name}
              {renderDog.breed ? (
                <span style={{ fontWeight: 600, color: '#777' }}>
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
                color: '#777',
              }}
            >
              {t.modals.lostDog.questCta(renderDog.rewardPoints)}
            </div>
            {/* SAY WHEN THE PIN IS A GUESS.
                Half the map is placed by the model rather than by the
                ad's own words, and a guess drawn with the same
                confidence as an address is what makes somebody walk the
                wrong streets and conclude the app is broken. One line,
                and the post is one tap below it. */}
            {renderDog.approximate ? (
              <div
                style={{
                  marginTop: 4,
                  fontSize: TYPE.caption,
                  color: '#777',
                }}
              >
                {t.modals.lostDog.approximate}
              </div>
            ) : null}
            {onOpenPost ? (
              <button
                onClick={() => onOpenPost(renderDog)}
                style={{
                  // The padding is the tap target (~40px tall) and the
                  // negative margin hands it back, so the line sits where
                  // the old 11px bare-text link did (UX-9.6). In ink:
                  // blue here means the map, not "tap me" — the same
                  // rule as the deck counter.
                  display: 'inline-flex',
                  alignItems: 'center',
                  marginTop: 8 - S.m,
                  marginBottom: -S.m,
                  marginLeft: -S.l,
                  marginRight: -S.l,
                  padding: `${S.m}px ${S.l}px`,
                  border: 'none',
                  background: 'none',
                  color: INK,
                  fontFamily: SYSTEM_FONT,
                  fontSize: TYPE.small,
                  fontWeight: 700,
                  textDecoration: 'underline',
                  cursor: 'pointer',
                }}
              >
                {t.modals.lostDog.readPost}
              </button>
            ) : null}
            {confirmingSeen ? (
              <div
                style={{
                  marginTop: 8,
                  fontSize: TYPE.small,
                  fontWeight: 800,
                }}
              >
                {t.modals.lostDog.seenConfirm(renderDog.name)}
              </div>
            ) : null}
          </div>

          {/* Action pills — ink primary (start search) on the LEFT, white
              secondary (i've seen) on the right: dark-left is the rule
              on every sheet (D10), and this card was the one that had
              it the other way round. The drawn eyes and magnifier give
              it the same icon-and-label anatomy as the spot sheet's
              pills (UX-9.17). While "i've seen" is being confirmed the
              pair becomes yes, just now / no, and the question sits at
              the foot of the bubble. */}
          {confirmingSeen ? (
            <div style={ROW_STYLE}>
              <button
                onClick={(e) => {
                  if (firedRef.current) return;
                  firedRef.current = true;
                  playPopThen(e.currentTarget, () => onReportSighting?.(renderDog));
                }}
                style={{ ...PILL_PRIMARY, ...WRAP }}
              >
                {t.modals.lostDog.seenConfirmYes}
              </button>
              <button
                onClick={(e) => {
                  playPop(e.currentTarget);
                  setConfirmingSeen(false);
                }}
                style={{ ...PILL_SECONDARY, ...WRAP }}
              >
                <HandDrawnFrame radius={R.button} />
                {t.modals.lostDog.seenConfirmNo}
              </button>
            </div>
          ) : (
            <div style={ROW_STYLE}>
              <button
                onClick={(e) =>
                  playPopThen(e.currentTarget, () => onStartSearch?.(renderDog))
                }
                disabled={searchActive}
                style={{ ...(searchActive ? PILL_DISABLED : PILL_PRIMARY), ...WRAP }}
              >
                <Icon name="search" size={INLINE_ICON.secondary} inverted={!searchActive} />
                <span>
                  {searchActive ? t.modals.lostDog.searchingCta : t.modals.lostDog.startSearch}
                </span>
              </button>
              <button
                onClick={(e) => {
                  playPop(e.currentTarget);
                  setConfirmingSeen(true);
                }}
                style={{ ...PILL_SECONDARY, ...WRAP }}
              >
                <HandDrawnFrame radius={R.button} />
                <Icon name="eyes" size={INLINE_ICON.secondary} />
                <span>{t.modals.lostDog.iveSeen}</span>
              </button>
            </div>
          )}
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
