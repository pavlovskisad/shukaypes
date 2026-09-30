import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LatLng } from '@shukajpes/shared';
import { useGameStore } from '../../stores/gameStore';
import { DogSprite } from './DogSprite';
import { haptic } from '../../utils/haptics';
import { R } from '../../constants/radius';
import { TYPE } from '../../constants/type';
import { VOICE } from '../../constants/voice';
import { Z } from '../../constants/z';
import { useStrings } from '../../i18n/useStrings';

// "{name} poked you!" notification. Watches the store's incomingPoke.seq so it
// fires exactly once per poke: pops in, fires a success haptic, shows the
// poker's (excited, bouncing) dog, and — if the poker is still online — lets
// you tap to fly to them. Auto-dismisses.
//
// onGoTo pans the map to the poker (MapView passes it, since the map instance
// lives there and this card is portaled to <body>).
//
// `top` is where MapView wants it: under the HUD, and under the walk /
// GPS pills and the quest pill when those are live. It used to sit at a
// fixed 96 px and cover "cancel walk" for its whole 5.2 s (UX-7.3).
//
// Painted in the dog's VOICE (dark bubble, white text): it is another dog
// saying hello, and every other dark thing on the map is a dog talking.

interface Props {
  onGoTo?: (pos: LatLng) => void;
  top: string;
}

interface Shown {
  seq: number;
  fromName: string;
  position: LatLng | null;
}

const DISMISS_MS = 5200;

// The last poke that was shown, at MODULE scope rather than in a ref
// (UX-6.1). MapView mounts this only while the map tab is showing, so a
// ref was reset to 0 every time the person came back to the map — and the
// store still held the old poke, so it replayed, haptic buzz and all, on
// every return. The store's seq only ever grows, so one number that
// outlives the component is enough.
let lastSeenSeq = 0;

export function PokeToast({ onGoTo, top }: Props) {
  const incomingPoke = useGameStore((s) => s.incomingPoke);
  const [shown, setShown] = useState<Shown | null>(null);
  const t = useStrings();

  useEffect(() => {
    if (!incomingPoke || incomingPoke.seq === lastSeenSeq) return;
    lastSeenSeq = incomingPoke.seq;
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
      role="status"
      aria-live="polite"
      onClick={() => {
        if (canGoTo && shown.position) onGoTo!(shown.position);
        dismiss();
      }}
      style={{
        position: 'fixed',
        top,
        left: '50%',
        transform: 'translateX(-50%)',
        // Under every sheet: over one, a tap here panned a map nobody
        // could see. See z.ts.
        zIndex: Z.TOAST,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 14px 8px 8px',
        borderRadius: R.card,
        background: VOICE.background,
        color: VOICE.color,
        border: VOICE.border,
        boxShadow: VOICE.shadow,
        fontFamily: VOICE.fontFamily,
        cursor: canGoTo ? 'pointer' : 'default',
        animation: 'poke-card-in 360ms cubic-bezier(0.34,1.56,0.64,1) both',
        maxWidth: '86vw',
      }}
    >
      <div data-loop style={{ animation: 'poke-dog-bounce 0.6s ease-in-out infinite', flexShrink: 0 }}>
        <DogSprite anim="jumping" facingLeft={false} scale={1.15} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Name and verb in separate spans: only the name gives way to a
            long nickname, so the line always still says what happened. */}
        <div
          style={{
            display: 'flex',
            gap: '0.3em',
            fontSize: TYPE.body,
            fontWeight: 700,
            whiteSpace: 'nowrap',
            minWidth: 0,
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
            {shown.fromName}
          </span>
          <span style={{ flexShrink: 0 }}>{t.poke.verb}</span>
        </div>
        <div style={{ fontSize: TYPE.small, fontWeight: 500, opacity: 0.75, marginTop: 1 }}>
          {canGoTo ? t.poke.nearby : t.poke.wasNearby}
        </div>
      </div>
    </div>,
    document.body,
  );
}
