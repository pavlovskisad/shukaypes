// A plain fullscreen "see all" list: a title level with the floating
// close, and whatever rows the caller hands it, scrolling underneath.
// Same sheet as LeaderboardModal and LostDogsModal — white page,
// opacity-only fade, portaled, back/Escape close — for a list that does
// not need a sheet of its own.
//
// First used by the past searches on the tasks tab (UX-12.7): a history
// of twenty rows made its snap-card taller than the screen, and a
// mandatory-snap card taller than the screen has a tail you cannot
// scroll to. The card now shows the latest few and links here.

import { useEffect, useId, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { portalRoot } from '../../utils/portalRoot';
import { Z } from '../../constants/z';
import { TYPE } from '../../constants/type';
import { SYSTEM_FONT } from '../../constants/fonts';
import { INK } from '../../constants/surface';
import { S } from '../../constants/spacing';
import { CloseButton } from './CloseButton';
import { CLOSE_SIZE, CLOSE_INSET, FULLSCREEN_LIST_TOP } from '../../constants/buttons';
import { useSheetBack } from '../../hooks/useSheetBack';
import { MOTION } from '../../utils/motion';

const SHEET_ANIM_MS = MOTION.sheetMs;

export function FullscreenListModal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  // Kept mounted through the fade-out, as the other list sheets are.
  const [shown, setShown] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setShown(true);
      setClosing(false);
      return;
    }
    if (!shown) return;
    setClosing(true);
    const timer = setTimeout(() => {
      setShown(false);
      setClosing(false);
    }, SHEET_ANIM_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on open flips only, like LostDogsModal
  }, [open]);

  useSheetBack(open, onClose);

  if (!shown || typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      style={{
        position: 'fixed',
        inset: 0,
        background: '#ffffff',
        zIndex: Z.MODAL_GLOBAL,
        opacity: closing ? 0 : 1,
        transition: `opacity ${SHEET_ANIM_MS}ms ease-out`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          padding: S.xl,
          paddingTop: `calc(env(safe-area-inset-top, 0px) + ${FULLSCREEN_LIST_TOP}px)`,
          paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + ${S.xl}px)`,
        }}
      >
        {children}
      </div>

      {/* The title on the close's line, on a white band so rows scroll
          up under it rather than through it — LeaderboardModal's band. */}
      <div
        id={titleId}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          boxSizing: 'border-box',
          height: `calc(env(safe-area-inset-top, 0px) + ${CLOSE_INSET + CLOSE_SIZE}px)`,
          paddingTop: `calc(env(safe-area-inset-top, 0px) + ${CLOSE_INSET}px)`,
          paddingLeft: S.xl,
          paddingRight: CLOSE_INSET + CLOSE_SIZE + S.s,
          background: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          fontFamily: SYSTEM_FONT,
          fontSize: TYPE.title,
          fontWeight: 700,
          color: INK,
          zIndex: 1,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </span>
      </div>

      <CloseButton
        onPress={onClose}
        style={{
          position: 'absolute',
          top: `calc(env(safe-area-inset-top, 0px) + ${CLOSE_INSET}px)`,
          right: CLOSE_INSET,
          zIndex: 1,
        }}
      />
    </div>,
    portalRoot(),
  );
}
