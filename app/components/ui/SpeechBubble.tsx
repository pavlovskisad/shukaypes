import { VOICE } from '../../constants/voice';

interface SpeechBubbleProps {
  text: string | null;
}

// Dark bubble just above the companion (demo lines 296-304). The parent
// is the companion's overlay div, so it moves with the map. `bottom:85%`
// places the bubble's bottom edge ~14px above the nose so it hugs the
// companion instead of floating up into the top radial-menu button.
//
// `width: max-content` is the key — without it the bubble inherits a
// shrink-to-fit constraint from the companion's `display: flex; width:
// 140` parent and ends up wrapping every word onto its own line. With
// max-content, the bubble takes its preferred natural width (full
// single-line text) and only wraps when that exceeds maxWidth.
// maxWidth caps at half the screen on phones with a sensible upper
// bound for tablets. whiteSpace stays `pre-line` for explicit \n
// breaks; wordBreak dropped because the maxWidth alone now handles
// long Haiku narrations without forcing per-character splits.
export function SpeechBubble({ text }: SpeechBubbleProps) {
  if (!text) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        bottom: '85%',
        transform: 'translateX(-50%)',
        background: VOICE.background,
        color: VOICE.color,
        // Fatter bubble — padding 12 vertical for breathing
        // room, but only 10 horizontal so wrapping multi-line
        // remarks (greeting, sniff-on / sniff-off lines) hug
        // their longest line instead of carrying a wide dead
        // strip on either side. Cap maxWidth at 60vw.
        // Tighter horizontal padding — 14 → 10 — so wrapping
        // multi-line bubbles hug their longest line cleanly.
        padding: '12px 10px',
        // Uniform full radius — matches the chat bubble + chip
        // family. No more "tail" corner; the bubble's position
        // above the dog is enough direction cue on its own.
        borderRadius: 24,
        fontSize: 16,
        lineHeight: 1.4,
        fontFamily: VOICE.fontFamily,
        whiteSpace: 'pre-line',
        width: 'max-content',
        maxWidth: 'min(60vw, 320px)',
        textAlign: 'center',
        boxShadow: VOICE.shadow,
        pointerEvents: 'none',
        opacity: 0.98,
      }}
    >
      {text}
    </div>
  );
}
