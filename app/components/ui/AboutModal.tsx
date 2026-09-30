import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { portalRoot } from '../../utils/portalRoot';
import { SYSTEM_FONT } from '../../constants/fonts';
import { INLINE_ICON, TOP_SHEET_MAX_H } from '../../constants/sizing';
import { R } from '../../constants/radius';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
import { INK, SURFACE } from '../../constants/surface';
import { colors } from '../../constants/colors';
import { Z } from '../../constants/z';
import { Icon, type IconName } from './Icon';
import { useStrings } from '../../i18n/useStrings';
import { HandDrawnFrame } from './HandDrawn';
import { CloseButton } from './CloseButton';
import { CLOSE_INSET, CLOSE_SIZE } from '../../constants/buttons';
import { useSheetBack } from '../../hooks/useSheetBack';
import { MOTION } from '../../utils/motion';

interface AboutModalProps {
  open: boolean;
  onClose: () => void;
}

const SHEET_ANIM_MS = MOTION.sheetMs;
// Top-anchored modal — bump the badge / close button down by the
// safe-area inset so they clear the iPhone notch / status bar.
// The overlay holds the sheet clear of the notch now, so this is
// just the sheet's own inside margin.
const SAFE_TOP = 12;
// Close button, and the gap under it. The header strip has to reserve
// SAFE_TOP + CLOSE_SIZE + CLOSE_GAP of room or the title runs under the
// badge and the close — which is exactly what happened while this was a
// `calc()` with an unitless term in it: one bad operand invalidates the
// whole expression, the declaration is dropped, and the padding silently
// becomes 0. Plain arithmetic can't fail that way.
// CLOSE_SIZE is the shared close circle's (constants/buttons.ts).
const CLOSE_GAP = 8;
const HEADER_TOP = SAFE_TOP + CLOSE_SIZE + CLOSE_GAP;

// Icon assignment per about-row index. Stays language-neutral so the
// strings table only carries the translatable title + body — the
// 36px pixel icon for "lost pets" is the same red urgent badge in
// every locale.
//
// INDEX-ALIGNED to `modals.about.rows`. Adding a row without adding an
// icon here silently falls back to the logo — keep the two in step.
const ROW_ICONS: IconName[] = [
  'question', // шо ти? — the gate
  'urgent', // загубив друга — the report form
  'search', // я шукайпес — supersniff
  'eyes', // якщо побачив — sightings
  'walk', // хочу погуляти
  'cafe', // куди зайти
  'map', // хто тримає цей район — territory
  'pin', // затисни мапу
  'paws', // лапки + кістки
  'sun', // як почуваюся
  'task', // сьогодні
  'chat', // говори зі мною
  'house', // де ми все тримаємо
];

export function AboutModal({ open, onClose }: AboutModalProps) {
  const t = useStrings();
  const [rendered, setRendered] = useState(open);
  const [closing, setClosing] = useState(false);

  // Same three-state machine as the other sheets so dismiss animates.
  useEffect(() => {
    if (open) {
      setRendered(true);
      setClosing(false);
      return;
    }
    if (rendered && !closing) {
      setClosing(true);
      const t = setTimeout(() => {
        setRendered(false);
        setClosing(false);
      }, SHEET_ANIM_MS);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Back and Escape close it, like its close pill (UX-2.5, UX-14.1).
  useSheetBack(open, onClose);

  if (!rendered) return null;
  if (typeof document === 'undefined') return null;

  // Top-sheet modal portaled to document.body so it sits above the
  // HUD pills and the floating dashboard regardless of where in the
  // component tree it gets mounted. Same visual family as the
  // LostDog / Spot modals: full-bleed top edge, rounded bottom only,
  // slides down from off-screen-top.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: SURFACE.scrim,
        display: 'flex',
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
        zIndex: Z.MODAL_INFO,
        opacity: closing ? 0 : 1,
        transition: `opacity ${SHEET_ANIM_MS}ms ease-out`,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: SURFACE.fill,
          borderRadius: R.card,
          padding: 0,
          width: '100%',
          maxWidth: 460,
          // Cap so the content scrolls instead of overlapping the
          // floating dashboard.
          maxHeight: TOP_SHEET_MAX_H as unknown as number,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          animation: `top-sheet-${closing ? 'out' : 'in'} ${SHEET_ANIM_MS}ms cubic-bezier(0.4,0,0.2,1) forwards`,
          boxShadow: SURFACE.lift,
          // A top sheet slides down from off-screen and runs to both
          // screen edges, so it has exactly one edge the eye can see:
          // the bottom, with its two rounded corners. Inking all four
          // would draw a line along the top that is never on screen and
          // two down the sides that sit flush against the bezel.
          overflow: 'hidden',
        }}
      >
        {/* All four edges, drawn — see HandDrawn.tsx. */}
        <HandDrawnFrame radius={R.card} />
        {/* Header strip — badge top-left, close button top-right.
            Both offset by SAFE_TOP so they clear the iPhone notch
            on a top-anchored modal. */}
        <div
          style={{
            position: 'relative',
            paddingTop: HEADER_TOP,
            // S.l, the gutter every sibling top sheet uses (UX-10.5).
            paddingLeft: S.l,
            paddingRight: S.l,
            paddingBottom: S.s,
            flexShrink: 0,
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: SAFE_TOP,
              // Mirrors the close circle's inset on the other side.
              left: CLOSE_INSET,
              background: SURFACE.fill,
              color: colors.grey,
              borderRadius: R.label,
              padding: '6px 12px',
              fontSize: TYPE.small,
              fontWeight: 700,
              letterSpacing: 0.4,
              textTransform: 'lowercase',
              boxShadow: SURFACE.chip,
              border: '2px solid transparent',
            }}
          >
            <HandDrawnFrame radius={R.label} />
            {t.modals.about.badge}
          </span>
          <CloseButton
            onPress={onClose}
            style={{ position: 'absolute', top: CLOSE_INSET, right: CLOSE_INSET }}
          />

          <div style={{ fontFamily: SYSTEM_FONT, fontSize: TYPE.display, fontWeight: 700 }}>
            {t.modals.about.header}
          </div>
          <div
            style={{ fontSize: TYPE.small, color: colors.grey, marginTop: 6, lineHeight: 1.45 }}
            // Intro contains a <strong> tag for the bot name; render the
            // i18n string as HTML so the markup survives translation.
            dangerouslySetInnerHTML={{ __html: t.modals.about.intro }}
          />
        </div>

        {/* Scrollable rows */}
        <div
          style={{
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: S.l,
            padding: `${S.m}px ${S.l}px ${S.l}px`,
            flexGrow: 1,
            minHeight: 0,
          }}
        >
          {t.modals.about.rows.map((r, i) => (
            <div key={r.title} style={{ display: 'flex', gap: S.m, alignItems: 'flex-start' }}>
              <div
                style={{
                  width: INLINE_ICON.about,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingTop: 2,
                }}
              >
                <Icon name={ROW_ICONS[i] ?? 'logo'} size={INLINE_ICON.about} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: SYSTEM_FONT,
                    fontSize: TYPE.body,
                    fontWeight: 700,
                    color: INK,
                  }}
                >
                  {r.title}
                </div>
                <div
                  style={{
                    fontSize: TYPE.small,
                    color: colors.grey,
                    marginTop: S.xs,
                    lineHeight: 1.5,
                  }}
                >
                  {r.body}
                </div>
              </div>
            </div>
          ))}
          <div
            style={{
              fontSize: TYPE.small,
              color: colors.grey,
              textAlign: 'center',
              marginTop: S.s,
              marginBottom: S.xs,
              // No italic: Annex has none, so the browser would slant
              // the upright glyphs. The grey is the de-emphasis.
            }}
          >
            {t.modals.about.footer}
          </div>
        </div>
      </div>
    </div>,
    portalRoot(),
  );
}
