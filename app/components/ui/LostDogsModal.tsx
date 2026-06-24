// Fullscreen "see all" modal for nearby lost dogs. Opened by
// tapping the "N / M" counter under the LostDogCardStack on the
// tasks tab. Renders every nearby dog as a full-size
// LostDogCardView in a vertical scroll feed — tap a card to open
// the lost-dog modal for that pet. Floating X in the top-right
// corner closes; no header bar (the user just came from the
// "lost pets nearby" carousel — no need to repeat the label).

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { NearbyLostDog } from '../../services/api';
import { Z } from '../../constants/z';
import { R } from '../../constants/radius';
import { TYPE } from '../../constants/type';
import { playPop } from '../../utils/popOnTap';
import { useGameStore } from '../../stores/gameStore';
import { useStrings } from '../../i18n/useStrings';
import { LostDogCardView } from './LostDogCardStack';

const SHEET_ANIM_MS = 240;

interface Props {
  // null = closed. Non-null array = open showing those dogs.
  dogs: NearbyLostDog[] | null;
  onClose: () => void;
  onPick: (dog: NearbyLostDog) => void;
}

export function LostDogsModal({ dogs, onClose, onPick }: Props) {
  const t = useStrings();
  const userPos = useGameStore((s) => s.userPosition);
  const [renderDogs, setRenderDogs] = useState<NearbyLostDog[] | null>(dogs);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (dogs) {
      setRenderDogs(dogs);
      setClosing(false);
      return;
    }
    if (renderDogs && !closing) {
      setClosing(true);
      const t = setTimeout(() => {
        setRenderDogs(null);
        setClosing(false);
      }, SHEET_ANIM_MS);
      return () => clearTimeout(t);
    }
  }, [dogs]);

  if (!renderDogs) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
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
        style={
          {
            position: 'absolute',
            inset: 0,
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
            padding: '20px',
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 72px)',
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
          } as React.CSSProperties
        }
      >
        {renderDogs.map((dog) => (
          <div
            key={dog.id}
            onClick={(e) => {
              playPop(e.currentTarget);
              onPick(dog);
            }}
            style={{
              width: '100%',
              height: 320,
              flexShrink: 0,
              cursor: 'pointer',
            }}
          >
            <LostDogCardView dog={dog} t={t} userPos={userPos} />
          </div>
        ))}
      </div>

      <button
        onClick={(e) => {
          playPop(e.currentTarget);
          onClose();
        }}
        aria-label="Close"
        style={{
          position: 'absolute',
          top: 'calc(env(safe-area-inset-top, 0px) + 14px)',
          right: 18,
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
          zIndex: 1,
        }}
      >
        ×
      </button>
    </div>,
    document.body,
  );
}
