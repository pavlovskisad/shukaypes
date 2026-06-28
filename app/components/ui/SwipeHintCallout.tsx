import { SYSTEM_FONT } from '../../constants/fonts';
import { TYPE } from '../../constants/type';

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
        top: 16,
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
          gap: 6,
          background: 'rgba(0,0,0,0.62)',
          color: '#fff',
          fontFamily: SYSTEM_FONT,
          fontSize: TYPE.small,
          fontWeight: 700,
          padding: '7px 13px',
          borderRadius: 999,
          boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
        }}
      >
        <span>{text}</span>
        <span style={{ animation: 'hint-swipe-arrow 1s ease-in-out infinite' }}>
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
