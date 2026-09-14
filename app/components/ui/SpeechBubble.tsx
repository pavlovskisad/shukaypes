import { useEffect, useRef } from 'react';
import { VOICE } from '../../constants/voice';
import { R } from '../../constants/radius';
import { TYPE } from '../../constants/type';

interface SpeechBubbleProps {
  text: string | null;
  // Vertical anchor (CSS `bottom`) relative to the companion's 140px
  // box. Default '85%' tucks the bubble just above the nose. The
  // radial-menu explainer overrides this to sit ABOVE the top ring
  // button instead of on top of it.
  bottom?: string;
  // Told the bubble's rendered height, and null when it goes. The
  // account sheet (D-69) lays itself out as one block — this bubble,
  // the dog, the paper — centred in the visible height, so it needs
  // to know how tall the line above the dog came out.
  onHeight?: (h: number | null) => void;
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
export function SpeechBubble({ text, bottom = '85%', onHeight }: SpeechBubbleProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Re-run when the text changes too: a different line is a different
  // height. Only an unmount, or the listener changing hands, reports
  // null — a text change must not, or the sheet would fall back to its
  // fixed framing for a frame between two lines and jump.
  useEffect(() => {
    if (!onHeight) return;
    const el = ref.current;
    if (!el) {
      onHeight(null);
      return;
    }
    const report = () => onHeight(Math.round(el.getBoundingClientRect().height));
    report();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeight, text]);
  useEffect(() => () => onHeight?.(null), [onHeight]);
  if (!text) return null;
  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        left: '50%',
        bottom,
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
        borderRadius: R.chip,
        fontSize: TYPE.body,
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
