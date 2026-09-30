import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Spot } from '../../services/places';
import { SYSTEM_FONT } from '../../constants/fonts';
import { Z } from '../../constants/z';
import { INLINE_ICON, ICON_HERO, EMOJI_HERO } from '../../constants/sizing';
import { R } from '../../constants/radius';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
import {
  CLOSE_INSET,
  CLOSE_SIZE,
  MODAL_PILL_DARK,
  MODAL_PILL_DISABLED,
  MODAL_PILL_LIGHT,
} from '../../constants/buttons';
import { INK, SURFACE } from '../../constants/surface';
import { colors } from '../../constants/colors';
import { playPopThen } from '../../utils/popOnTap';
import { Icon, iconForCategory } from './Icon';
import { useStrings } from '../../i18n/useStrings';
import { HandDrawnFrame } from './HandDrawn';
import { CloseButton } from './CloseButton';
import { useSheetBack } from '../../hooks/useSheetBack';
import { MOTION } from '../../utils/motion';

interface SpotModalProps {
  spot: Spot | null;
  onClose: () => void;
  // Triggers a walking-route fetch + render to this spot. Modal
  // closes itself afterward. Caller decides whether the route is a
  // one-way or roundtrip — modal default is one-way; long-press
  // could differentiate later. May return a promise; the pills stay
  // disabled until it settles.
  onWalkHere?: (spot: Spot, shape: 'roundtrip' | 'oneway') => void | Promise<void>;
}

const SHEET_ANIM_MS = MOTION.sheetMs;
const HERO_HEIGHT_PX = 220;
// Top-anchored modal — bump the badge / close button down by the
// safe-area inset so they clear the iPhone notch / status bar.
// The overlay holds the sheet clear of the notch now, so this is
// just the sheet's own inside margin.
const SAFE_TOP = 12;

// Slide-up POI sheet. Mirrors LostDogModal's hero-on-top layout but
// with a giant category icon instead of a photo — same visual family,
// different content type. Animates in on mount; closing-state
// timeout runs the slide-down before unmounting.
export function SpotModal({ spot, onClose, onWalkHere }: SpotModalProps) {
  const t = useStrings();
  const [renderSpot, setRenderSpot] = useState<Spot | null>(spot);
  const [closing, setClosing] = useState(false);
  // Which spot a walk is being routed to. The route is a network call,
  // and with nothing to show for it the pills invited a second tap (and
  // a second route). Keyed by id so opening another spot meanwhile
  // gets live pills, not this one's wait.
  const [routingFor, setRoutingFor] = useState<string | null>(null);
  const routing = renderSpot != null && routingFor === renderSpot.id;
  const walk = (s: Spot, shape: 'roundtrip' | 'oneway') => {
    if (routing || !onWalkHere) return;
    setRoutingFor(s.id);
    void Promise.resolve(onWalkHere(s, shape)).finally(() =>
      setRoutingFor((cur) => (cur === s.id ? null : cur)),
    );
  };

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

  // Back and Escape close it, like its close pill (UX-2.5, UX-14.1).
  useSheetBack(!!spot, onClose);

  if (!renderSpot) return null;
  if (typeof document === 'undefined') return null;

  const iconSlot = iconForCategory(renderSpot.category);
  const hasRating = typeof renderSpot.rating === 'number';

  // Portal to document.body — see LostDogModal for the rationale.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        // Transparent overlay: the modal anchored at the top
        // provides plenty of visual modal context on its own,
        // and dimming the visible map strip beneath it just
        // washes out the highlighted POI marker the user is
        // here to see. Click handler still catches taps outside
        // the modal to close.
        background: 'transparent',
        display: 'flex',
        // Anchored at the TOP — same dashboard-card-from-above
        // shape as the LostDogModal so the two read as one family.
        alignItems: 'flex-start',
        // THE SHEET HANGS, IT DOES NOT GROW OUT OF THE BEZEL.
        //
        // It used to run to all three screen edges with its top edge off
        // the top of the page — so the two side lines began nowhere,
        // out of thin air, cut off by the viewport. There is no fixing
        // that by going further up: viewport-fit=cover means the
        // INSTALLED app flows under the status bar and could paint
        // there, but in a browser tab the page simply starts below it
        // and there is nothing above to reach into. So the sheet stops
        // being a full-bleed panel and becomes a poster with four
        // edges, hanging a few px under the inset. Padding on the
        // OVERLAY rather than margin on the sheet, because a flex item
        // at width:100% adds its margins on top and overflows.
        padding: 'calc(env(safe-area-inset-top, 0px) + 8px) 10px 0',
        boxSizing: 'border-box',
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
          borderRadius: R.card,
          padding: 0,
          width: '100%',
          maxWidth: 460,
          // Cap so the action pills stay above the tab bar even on
          // short viewports.
          maxHeight: 'calc(100vh - 118px - env(safe-area-inset-top) - env(safe-area-inset-bottom))' as unknown as number,
          display: 'flex',
          flexDirection: 'column',
          animation: `top-sheet-${closing ? 'out' : 'in'} ${SHEET_ANIM_MS}ms cubic-bezier(0.4,0,0.2,1) forwards`,
          boxShadow: SURFACE.lift,
          // A top sheet slides down from off-screen and runs to both
          // screen edges, so it has exactly one edge the eye can see:
          // the bottom, with its two rounded corners. Inking all four
          // would draw a line along the top that is never on screen and
          // two down the sides that sit flush against the bezel.
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* All four edges, drawn — see HandDrawn.tsx. */}
        <HandDrawnFrame radius={R.card} />
        {/* Hero block — a big centred category icon on white, with the
            rating and the close button top-right. Same "hero on top of
            card" shape as the LostDogModal photo header so the two read
            as one family. */}
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
          {/* No category label. The hero icon directly above it is a
              drawn cup, a bowl, a paw — the word кав'ярня underneath
              was the same fact twice, in a patch that had to be drawn
              to hold it. */}
          {/* Rating LEFT, where the category label used to be. No patch:
              the hero band behind it is already white, so the chip was
              a white rectangle drawn on white to hold two characters
              and all it added was an outline. Matches the spot card,
              which puts the rating on the same side. */}
          {hasRating ? (
            <span
              style={{
                position: 'absolute',
                top: SAFE_TOP,
                left: 14,
                color: INK,
                fontSize: TYPE.body,
                fontWeight: 800,
                letterSpacing: 0.3,
                display: 'inline-flex',
                alignItems: 'center',
                // The close circle's height, so the two share a midline.
                height: CLOSE_SIZE,
                gap: 4,
              }}
            >
              <span style={{ color: colors.amber }}>★</span>
              {renderSpot.rating!.toFixed(1)}
            </span>
          ) : null}
          {/* The close button keeps the right corner to itself, and
              stays full-round: it is a circle and a control, not a
              readout. */}
          <CloseButton
            onPress={onClose}
            style={{ position: 'absolute', top: CLOSE_INSET, right: CLOSE_INSET }}
          />
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
            onClick={(e) =>
              playPopThen(e.currentTarget, () => walk(renderSpot, 'oneway'))
            }
            disabled={routing}
            style={routing ? MODAL_PILL_DISABLED : MODAL_PILL_DARK}
          >
            <Icon name="walk" size={INLINE_ICON.cta} inverted={!routing} />
            <span>{t.modals.spot.walkHere}</span>
          </button>
          <button
            onClick={(e) =>
              playPopThen(e.currentTarget, () => walk(renderSpot, 'roundtrip'))
            }
            disabled={routing}
            style={routing ? MODAL_PILL_DISABLED : MODAL_PILL_LIGHT}
          >
            {routing ? null : <HandDrawnFrame radius={R.button} />}
            {/* Not inverted any more — the pill under it went from blue
                to white, and a white icon on white is nothing. */}
            <Icon name="roundtrip" size={INLINE_ICON.cta} />
            <span>{t.modals.spot.roundtrip}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
