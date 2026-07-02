import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LatLng } from '@shukajpes/shared';
import { useGameStore } from '../../stores/gameStore';
import { DogSprite } from './DogSprite';
import { haptic } from '../../utils/haptics';
import { SYSTEM_FONT } from '../../constants/fonts';

// "{name} poked you!" notification. Watches the store's incomingPoke.seq so it
// fires exactly once per poke: pops in, fires a success haptic, shows the
// poker's (excited, bouncing) dog, and — if the poker is still online — lets
// you tap to fly to them. Auto-dismisses.
//
// onGoTo pans the map to the poker (MapView passes it, since the map instance
// lives there and this card is portaled to <body>).

interface Props {
  onGoTo?: (pos: LatLng) => void;
}

interface Shown {
  seq: number;
  fromName: string;
  position: LatLng | null;
}

const DISMISS_MS = 5200;

export function PokeToast({ onGoTo }: Props) {
  const incomingPoke = useGameStore((s) => s.incomingPoke);
  const [shown, setShown] = useState<Shown | null>(null);
  const lastSeqRef = useRef(0);

  useEffect(() => {
    if (!incomingPoke || incomingPoke.seq === lastSeqRef.current) return;
    lastSeqRef.current = incomingPoke.seq;
    setShown(incomingPoke);
    haptic('success');
    const t = setTimeout(() => setShown(null), DISMISS_MS);
    return () => clearTimeout(t);
  }, [incomingPoke]);

  if (!shown || typeof document === 'undefined') return null;

  const canGoTo = !!shown.position && !!onGoTo;
  const dismiss = () => setShown(null);

  return createPortal(
    <div
      onClick={() => {
        if (canGoTo && shown.position) onGoTo!(shown.position);
        dismiss();
      }}
      style={{
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top, 0px) + 96px)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9000,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 14px 8px 8px',
        borderRadius: 18,
        background: 'rgba(20,20,25,0.92)',
        color: '#fff',
        boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
        cursor: canGoTo ? 'pointer' : 'default',
        animation: 'poke-card-in 360ms cubic-bezier(0.34,1.56,0.64,1) both',
        maxWidth: '86vw',
      }}
    >
      <div style={{ animation: 'poke-dog-bounce 0.6s ease-in-out infinite', flexShrink: 0 }}>
        <DogSprite anim="jumping" facingLeft={false} scale={1.15} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div
          style={{
            font: `700 15px ${SYSTEM_FONT}`,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {shown.fromName} poked you! 👋
        </div>
        <div style={{ font: `500 12px ${SYSTEM_FONT}`, opacity: 0.75, marginTop: 1 }}>
          {canGoTo ? '🐾 nearby — tap to find them' : '🐾 they were nearby'}
        </div>
      </div>
    </div>,
    document.body,
  );
}
