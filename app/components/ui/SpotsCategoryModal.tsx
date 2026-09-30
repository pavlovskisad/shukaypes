// Fullscreen "see all" modal for a single spots category. Opened
// by tapping the "N / M" counter under a SpotCardStack. Renders
// every spot in the category as a full-size SpotCardView in a
// vertical scroll feed — tap a card to open it on the map.
// Floating X in the top-right corner closes the modal; no header
// bar, no category label (the user just came from that category's
// carousel — no need to repeat it).
// Sits at Z.MODAL_GLOBAL so it covers the tab bar and HUD, not
// just the spots tab content.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { portalRoot } from '../../utils/portalRoot';
import { S } from '../../constants/spacing';
import type { Spot } from '../../services/places';
import { Z } from '../../constants/z';
import { playPopThen } from '../../utils/popOnTap';
import { useGameStore } from '../../stores/gameStore';
import { SpotCardView } from './SpotCardStack';
import { CloseButton } from './CloseButton';
import { CLOSE_INSET, FULLSCREEN_LIST_TOP } from '../../constants/buttons';
import { useSheetBack } from '../../hooks/useSheetBack';
import { MOTION } from '../../utils/motion';

const SHEET_ANIM_MS = MOTION.sheetMs;

interface Props {
  // null = closed. Non-null array = open showing those spots.
  // Split from a separate `open` flag so the parent's logic stays
  // one-liner (pass the category's spots or null).
  spots: Spot[] | null;
  onClose: () => void;
  onPick: (spot: Spot) => void;
}

export function SpotsCategoryModal({ spots, onClose, onPick }: Props) {
  const userPos = useGameStore((s) => s.userPosition);
  // Mount/unmount split so the close animation plays before the
  // node disappears. Cached spots persist through the fade-out.
  const [renderSpots, setRenderSpots] = useState<Spot[] | null>(spots);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (spots) {
      setRenderSpots(spots);
      setClosing(false);
      return;
    }
    if (renderSpots && !closing) {
      setClosing(true);
      const t = setTimeout(() => {
        setRenderSpots(null);
        setClosing(false);
      }, SHEET_ANIM_MS);
      return () => clearTimeout(t);
    }
  }, [spots]);

  // Back and Escape close it, like its close pill (UX-2.5, UX-14.1).
  useSheetBack(!!spots, onClose);

  if (!renderSpots) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: '#ffffff',
        zIndex: Z.MODAL_GLOBAL,
        opacity: closing ? 0 : 1,
        transition: `opacity ${SHEET_ANIM_MS}ms ease-out`,
      }}
    >
      {/* Plain vertical scroll — cards span the viewport width
          minus a fixed side gutter and sit one after another with
          the same gutter between them. The scroll container fills
          the modal; no header — the floating X below sits on top
          of the scroll content. */}
      <div
        style={
          {
            position: 'absolute',
            inset: 0,
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
            // Top padding leaves room for the floating X +
            // safe-area inset so the first card never hides
            // behind the close button.
            padding: S.xl,
            // One start line for every fullscreen list (UX-12.18).
            paddingTop: `calc(env(safe-area-inset-top, 0px) + ${FULLSCREEN_LIST_TOP}px)`,
            paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + ${S.xl}px)`,
            display: 'flex',
            flexDirection: 'column',
            gap: S.xl,
          } as React.CSSProperties
        }
      >
        {renderSpots.map((spot) => (
          <div
            key={spot.id}
            onClick={(e) => playPopThen(e.currentTarget, () => onPick(spot))}
            style={{
              width: '100%',
              height: 320,
              flexShrink: 0,
              cursor: 'pointer',
            }}
          >
            <SpotCardView spot={spot} userPos={userPos} />
          </div>
        ))}
      </div>

      {/* Floating close — sits above the scroll content, anchored
          to the top-right with safe-area inset. The app's one close
          (D9). */}
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
