import type { CSSProperties, TouchEvent as ReactTouchEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { NearbyLostDog } from '../../services/api';
import { SYSTEM_FONT } from '../../constants/fonts';
import { Z } from '../../constants/z';
import { INLINE_ICON } from '../../constants/sizing';
import { R } from '../../constants/radius';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
import {
  MODAL_PILL_BASE,
  MODAL_PILL_BLUE,
  MODAL_PILL_DISABLED,
} from '../../constants/buttons';
import { Icon, type IconName } from './Icon';
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
  // When this dog already has an active search, swap the "start search"
  // button for a muted "searching…" affordance.
  searchActive?: boolean;
  // Optional prev/next cycling between the nearby pets. When wired up,
  // the card shows ‹ › chevrons and responds to horizontal swipe
  // gestures. Either both or neither.
  onPrev?: () => void;
  onNext?: () => void;
}

// Horizontal swipe threshold (px). Small enough for a thumb flick, big
// enough that a stray diagonal drag doesn't trip a cycle.
const SWIPE_THRESHOLD_PX = 60;

const SHEET_ANIM_MS = 280;

// The card floats above the tab bar; this clears the bar + home
// indicator on every device class. Keep loosely in sync with
// DOG_VIEW_PAD_BOTTOM in MapView (the camera reserves this strip).
const CARD_BOTTOM = 'calc(env(safe-area-inset-bottom, 0px) + 96px)';

// Light-grey secondary pill — on the white card the old white pill
// disappeared, so the "i've seen them" action gets a soft grey fill.
const CARD_PILL_LIGHT: CSSProperties = {
  ...MODAL_PILL_BASE,
  background: '#f0f0f2',
  color: '#1a1a1a',
  boxShadow: 'none',
};

// Close button — soft grey circle in the card's top-right corner.
const CLOSE_BUTTON_STYLE: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: R.pill,
  border: 'none',
  background: '#f0f0f2',
  color: '#1a1a1a',
  padding: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  fontSize: TYPE.body,
  lineHeight: 1,
  flexShrink: 0,
};

// Prev / next chevron — same soft grey circle family as the close
// button; the three sit as one ‹ › × cluster in the card's top-right.
// Horizontal swipe on the card cycles too — the chevrons make the
// affordance visible.
const CHEVRON_STYLE: CSSProperties = {
  ...CLOSE_BUTTON_STYLE,
  fontSize: 18,
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

// Explore-city-style bottom card. The map is the hero now — the
// cinematic zone view frames the pet's lit-up search zone with the BIG
// photo pin, so this card is compact info + actions floating above the
// tab bar: small photo thumb, name/breed, urgency + distance +
// last-seen meta, reward line, and the two action pills. Slides up
// from the bottom; transparent scrim so the shot stays visible; when
// onPrev/onNext are wired, ‹ › chevrons + horizontal swipe cycle
// through the nearby pets (content slides, controls stay).
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
  const userPos = useGameStore((s) => s.userPosition);
  const [renderDog, setRenderDog] = useState<NearbyLostDog | null>(dog);
  const [closing, setClosing] = useState(false);
  // Direction of the last cycle — drives the slide-in keyframe on the
  // keyed content track. null on a fresh open so the slide-up enter
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
  const badgeIcon: IconName = urgent ? 'urgent' : 'search';
  const badgeText = urgent ? t.modals.lostDog.badgeUrgent : t.modals.lostDog.badgeSearching;
  const badgeFg = urgent ? '#e84040' : '#d9a030';
  const distLabel = userPos
    ? formatDistance(distanceMeters(userPos, renderDog.lastSeen.position))
    : null;

  // Portal to document.body so the card escapes the MapView / tab-page
  // stacking context (the HUD pills would otherwise paint over it).
  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        // Transparent scrim: the cinematic zone shot (lit zone + big
        // photo pin) IS the content — dimming it would wash out exactly
        // what the user is here to look at. Outside tap still closes.
        background: 'transparent',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-end',
        paddingBottom: CARD_BOTTOM as unknown as number,
        paddingLeft: 10,
        paddingRight: 10,
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
          borderRadius: R.card,
          width: '100%',
          maxWidth: 440,
          position: 'relative',
          padding: 14,
          animation: `bottom-card-${closing ? 'out' : 'in'} ${SHEET_ANIM_MS}ms cubic-bezier(0.4,0,0.2,1) forwards`,
          boxShadow: '0 10px 34px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.10)',
          overflow: 'hidden',
        }}
      >
        {/* Per-dog content TRACK — keyed by id so a prev/next swap
            remounts it and runs the slide-in keyframe. The chevrons sit
            OUTSIDE it so they don't slide with the content. */}
        <div
          key={renderDog.id}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: S.m,
            animation: slideDir
              ? `slide-in-from-${slideDir} ${SHEET_ANIM_MS}ms cubic-bezier(0.2,0.7,0.3,1)`
              : undefined,
          }}
        >
          {/* Header row — thumb, name/breed, close. */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: S.m }}>
            <div
              style={{
                position: 'relative',
                width: 64,
                height: 64,
                borderRadius: 16,
                overflow: 'hidden',
                background: '#f0f0f2',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 34,
                flexShrink: 0,
              }}
            >
              {/* Emoji renders BEHIND the img so a failed/loading photo
                  naturally falls back without extra state — same trick
                  as the map pin. */}
              <span style={{ position: 'absolute' }}>{renderDog.emoji}</span>
              {renderDog.photoUrl ? (
                <img
                  src={renderDog.photoUrl}
                  alt={renderDog.name}
                  style={{
                    position: 'relative',
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                  onError={(e) => {
                    // Some hotlinked images 403 — hide the img so the
                    // emoji behind it shows through.
                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                  }}
                />
              ) : null}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontFamily: SYSTEM_FONT,
                  fontSize: TYPE.display,
                  fontWeight: 800,
                  lineHeight: 1.15,
                  color: '#1a1a1a',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {renderDog.name}
              </div>
              {renderDog.breed ? (
                <div
                  style={{
                    fontFamily: SYSTEM_FONT,
                    fontSize: TYPE.small,
                    color: '#777',
                    marginTop: 2,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {renderDog.breed}
                </div>
              ) : null}
              {/* Meta line — urgency + distance + last seen, one quiet
                  row under the name (explore-card style). */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: S.s,
                  marginTop: S.s,
                  fontFamily: SYSTEM_FONT,
                  fontSize: TYPE.small,
                  color: '#777',
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    color: badgeFg,
                    fontWeight: 700,
                    letterSpacing: 0.3,
                  }}
                >
                  <Icon name={badgeIcon} size={INLINE_ICON.badge} />
                  {badgeText}
                </span>
                {distLabel ? <span>· {distLabel}</span> : null}
                <span>· {t.modals.lostDog.lastSeen(relativeTime(renderDog.lastSeen.at, t))}</span>
              </div>
            </div>
            {/* Top-right control cluster: ‹ › cycle + close. Outside the
                keyed track conceptually, but rendering inside the header
                row keeps layout simple — the buttons are identical for
                every dog so the remount is invisible. */}
            <div style={{ display: 'flex', gap: S.xs, flexShrink: 0 }}>
              {onPrev ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePrev();
                  }}
                  aria-label={t.modals.lostDog.previousPet}
                  style={CHEVRON_STYLE}
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
                  style={CHEVRON_STYLE}
                >
                  ›
                </button>
              ) : null}
              <button
                onClick={(e) => playPopThen(e.currentTarget, onClose)}
                aria-label={t.modals.common.close}
                style={CLOSE_BUTTON_STYLE}
              >
                ×
              </button>
            </div>
          </div>

          {/* Reward line. */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: S.xs,
              fontFamily: SYSTEM_FONT,
              fontSize: TYPE.small,
              color: '#555',
            }}
          >
            <Icon name="paws" size={INLINE_ICON.secondary} />
            {t.modals.lostDog.questCta(renderDog.rewardPoints)}
          </div>

          {/* Action pills. */}
          <div style={{ display: 'flex', gap: S.s }}>
            <button
              onClick={(e) =>
                playPopThen(e.currentTarget, () => onReportSighting?.(renderDog))
              }
              style={CARD_PILL_LIGHT}
            >
              <Icon name="eyes" size={INLINE_ICON.cta} />
              {t.modals.lostDog.iveSeen}
            </button>
            <button
              onClick={(e) =>
                playPopThen(e.currentTarget, () => onStartSearch?.(renderDog))
              }
              disabled={searchActive}
              style={searchActive ? MODAL_PILL_DISABLED : MODAL_PILL_BLUE}
            >
              <Icon name="search" size={INLINE_ICON.cta} inverted={!searchActive} />
              {searchActive ? t.modals.lostDog.searchingCta : t.modals.lostDog.startSearch}
            </button>
          </div>
        </div>
        {/* end content track */}

        <style>{`
          @keyframes bottom-card-in {
            from { transform: translateY(130%); }
            to { transform: translateY(0); }
          }
          @keyframes bottom-card-out {
            from { transform: translateY(0); }
            to { transform: translateY(130%); }
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
