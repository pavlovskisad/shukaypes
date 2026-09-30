import { SYSTEM_FONT } from '../../constants/fonts';
import { TYPE } from '../../constants/type';
import { R } from '../../constants/radius';
import { S } from '../../constants/spacing';
import { VOICE } from '../../constants/voice';

// Small "swipe sideways" nudge that overlays a carousel deck — a pill
// near the top of the card (clear of the corner badges) with an arrow
// that gently slides to telegraph the gesture. Shared by the dogs deck
// (tasks tab) and the spots decks (spots tab); the parent supplies a
// position:relative wrapper. Render only while the hint is visible.
export function SwipeHintCallout({ text }: { text: string }) {
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        // Below the corner readouts (rating, distance), not across them:
        // at 16 the pill sat on the same line as the spot card's badges
        // and hid them for as long as it showed (UX-10.12). They start
        // at S.l and run one body line tall, so 44 clears them.
        top: 44,
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
        animation: 'hint-swipe-in 240ms ease-out',
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: S.s,
          // The dog's voice (voice.ts), not a one-off translucent black:
          // the hint is the dog telling you what to do with the deck.
          background: VOICE.background,
          color: VOICE.color,
          border: VOICE.border,
          fontFamily: SYSTEM_FONT,
          fontSize: TYPE.small,
          fontWeight: 700,
          padding: `${S.s}px ${S.m}px`,
          borderRadius: R.pill,
          boxShadow: VOICE.shadow,
        }}
      >
        <span>{text}</span>
        <span data-loop style={{ animation: 'hint-swipe-arrow 1s ease-in-out infinite' }}>
          👉
        </span>
      </div>
      <style>{`
        @keyframes hint-swipe-in {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes hint-swipe-arrow {
          0%, 100% { transform: translateX(0); }
          50%      { transform: translateX(6px); }
        }
      `}</style>
    </div>
  );
}
