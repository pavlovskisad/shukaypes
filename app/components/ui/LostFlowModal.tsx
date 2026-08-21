// "I lost my pet" — the answer to the top of the ring.
//
// WHY THIS IS A SIGNPOST AND NOT A FORM. A first-party report needs three
// things this app does not have: an upload path (there is no file input,
// no multipart, and no object store anywhere in the repo — routes/photos.ts
// is a READ proxy for Telegram file_ids), a write into `lost_dogs`, and a
// review queue in front of it. Open issue P0-5 records that nothing
// proactively reviews ingested reports today; a public image-write path
// would widen exactly that gap, and it would do so pointed at real
// people's pets.
//
// What we DO have is faster than a form anyway: post in the Telegram group
// the bot watches and services/telegramIngest.ts parses it with Haiku and
// puts the pet on the map on the spot, photo included. So this sheet spends
// its whole surface saying that clearly, to someone who is upset and
// scanning rather than reading.
//
// The link is configuration (env.telegramGroupUrl) and may be empty. An
// empty link must never render a button that goes nowhere — a dead CTA is
// worse than no CTA for this particular reader. It degrades to a plain
// line of explanation instead.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { SYSTEM_FONT } from '../../constants/fonts';
import { Z } from '../../constants/z';
import { R } from '../../constants/radius';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
import { MODAL_PILL_DARK, MODAL_PILL_LIGHT } from '../../constants/buttons';
import { env } from '../../constants/env';
import { SURFACE } from '../../constants/surface';
import { useStrings } from '../../i18n/useStrings';
import { HandDrawnFrame } from './HandDrawn';

// Same figure PostModal / SpotModal / LostDogModal use, so all four sheets
// open and close on one clock.
const SHEET_ANIM_MS = 280;

interface LostFlowModalProps {
  open: boolean;
  onClose: () => void;
}

export function LostFlowModal({ open, onClose }: LostFlowModalProps) {
  const t = useStrings();
  const [rendered, setRendered] = useState(open);
  const [closing, setClosing] = useState(false);

  // The three-state open/closing/unmount dance shared by the modal
  // family — the sheet has to outlive `open` long enough to animate out.
  useEffect(() => {
    if (open) {
      setRendered(true);
      setClosing(false);
      return;
    }
    if (rendered && !closing) {
      setClosing(true);
      const timer = setTimeout(() => {
        setRendered(false);
        setClosing(false);
      }, SHEET_ANIM_MS);
      return () => clearTimeout(timer);
    }
  }, [open]);

  if (!rendered) return null;
  if (typeof document === 'undefined') return null;

  const groupUrl = env.telegramGroupUrl;

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20,20,15,0.45)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        // Opened from the L1 ring, which sits on the map layer — this has
        // to clear it and everything else the map draws.
        zIndex: Z.MODAL_GLOBAL,
        opacity: closing ? 0 : 1,
        transition: `opacity ${SHEET_ANIM_MS}ms ease-out`,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#ffffff',
          borderBottomLeftRadius: R.card,
          borderBottomRightRadius: R.card,
          width: '100%',
          maxWidth: 460,
          maxHeight: 'calc(100vh - 110px - env(safe-area-inset-bottom))' as unknown as number,
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
        {/* Those three edges, drawn rather than bordered — see
            HandDrawn.tsx. The fourth is never on screen. */}
        <HandDrawnFrame radius={R.card} open="top" />
        <div
          style={{
            padding: `calc(env(safe-area-inset-top, 0px) + ${S.l}px) ${S.l}px ${S.s}px`,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              fontFamily: SYSTEM_FONT,
              fontSize: TYPE.title,
              fontWeight: 800,
              color: '#2B2B26',
            }}
          >
            {t.modes.lostSheet.title}
          </div>
        </div>

        <div
          style={{
            padding: `0 ${S.l}px ${S.m}px`,
            overflowY: 'auto',
            flex: 1,
            minHeight: 0,
          }}
        >
          <div
            style={{
              fontFamily: SYSTEM_FONT,
              fontSize: TYPE.body,
              lineHeight: 1.5,
              color: '#2B2B26',
            }}
          >
            {t.modes.lostSheet.body}
          </div>

          {/* No link configured: say so plainly rather than rendering a
              button that does nothing. */}
          {groupUrl ? null : (
            <div
              style={{
                marginTop: S.m,
                padding: S.s,
                borderRadius: R.chip,
                background: '#F3F0E7',
                fontFamily: SYSTEM_FONT,
                fontSize: TYPE.small,
                lineHeight: 1.45,
                color: '#5A5750',
              }}
            >
              {t.modes.lostSheet.noLink}
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            gap: S.s,
            padding: `${S.s}px ${S.l}px calc(${S.l}px + env(safe-area-inset-bottom, 0px))`,
            flexShrink: 0,
          }}
        >
          {groupUrl ? (
            <button
              onClick={() => window.open(groupUrl, '_blank', 'noopener')}
              style={MODAL_PILL_DARK}
            >
              {t.modes.lostSheet.cta}
            </button>
          ) : null}
          <button onClick={onClose} style={MODAL_PILL_LIGHT}>
            <HandDrawnFrame radius={R.button} />
            {t.modes.lostSheet.close}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
