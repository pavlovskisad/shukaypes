// Fullscreen "see all" modal for a single spots category. Opened
// by tapping the "N / M" counter under a SpotCardStack. Renders
// every spot in the category as a full-size SpotCardView in a
// vertical snap-scroll list — one card per viewport, the user
// scrolls through them like a feed and taps one to open it on
// the map. Sits at Z.MODAL_GLOBAL so it covers the tab bar and
// HUD, not just the spots tab content.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Spot } from '../../services/places';
import { Z } from '../../constants/z';
import { SYSTEM_FONT } from '../../constants/fonts';
import { useGameStore } from '../../stores/gameStore';
import { SpotCardView } from './SpotCardStack';

const SHEET_ANIM_MS = 240;

interface Props {
  title: string | null;
  spots: Spot[];
  onClose: () => void;
  onPick: (spot: Spot) => void;
}

export function SpotsCategoryModal({ title, spots, onClose, onPick }: Props) {
  const userPos = useGameStore((s) => s.userPosition);
  // Mount/unmount split so the close animation plays before the
  // node disappears. Same pattern as LostDogModal.
  const [renderTitle, setRenderTitle] = useState<string | null>(title);
  const [renderSpots, setRenderSpots] = useState<Spot[]>(spots);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (title) {
      setRenderTitle(title);
      setRenderSpots(spots);
      setClosing(false);
      return;
    }
    if (renderTitle && !closing) {
      setClosing(true);
      const t = setTimeout(() => {
        setRenderTitle(null);
        setRenderSpots([]);
        setClosing(false);
      }, SHEET_ANIM_MS);
      return () => clearTimeout(t);
    }
  }, [title]);

  if (!renderTitle) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#ffffff',
        zIndex: Z.MODAL_GLOBAL,
        display: 'flex',
        flexDirection: 'column',
        opacity: closing ? 0 : 1,
        transition: `opacity ${SHEET_ANIM_MS}ms ease-out`,
      }}
    >
      {/* Header — title left, close X right. Sits on a translucent
          backdrop so the first card peeking up underneath reads
          through subtly. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding:
            'calc(env(safe-area-inset-top, 0px) + 14px) 18px 14px 18px',
          background: 'rgba(255,255,255,0.92)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          borderBottom: '1px solid rgba(0,0,0,0.05)',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: SYSTEM_FONT,
            fontSize: 17,
            fontWeight: 800,
            color: '#1a1a1a',
            textTransform: 'lowercase',
            letterSpacing: 0.2,
          }}
        >
          {renderTitle}
        </span>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            border: '1px solid rgba(0,0,0,0.06)',
            background: '#ffffff',
            color: '#1a1a1a',
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
            fontSize: 26,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      {/* Snap-scroll list of full SpotCardViews. Each snap target
          is the full available height minus the header, so cards
          land centred on screen one at a time. */}
      <div
        style={
          {
            flex: 1,
            overflowY: 'auto',
            scrollSnapType: 'y mandatory',
            WebkitOverflowScrolling: 'touch',
          } as React.CSSProperties
        }
      >
        {renderSpots.map((spot) => (
          <div
            key={spot.id}
            onClick={() => onPick(spot)}
            style={{
              minHeight: '100%',
              height: 'calc(100vh - 120px - env(safe-area-inset-top, 0px))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '24px',
              scrollSnapAlign: 'center',
              scrollSnapStop: 'always',
              cursor: 'pointer',
            }}
          >
            <SpotCardView spot={spot} userPos={userPos} />
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
