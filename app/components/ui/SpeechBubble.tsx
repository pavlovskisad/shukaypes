import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { VOICE } from '../../constants/voice';
import { R } from '../../constants/radius';
import { TYPE } from '../../constants/type';
import { S } from '../../constants/spacing';

// KEPT ON SCREEN (UX-8.17). The bubble is centred on the dog, and a dog
// near the left or right edge of the map put half a sentence off the
// screen. Measured once the line has laid out and nudged sideways by
// however much it overhangs the app's column (#root — the screen on a
// phone, the 430 px column on desktop), less an S.s margin. Re-measured
// when the line changes or the window resizes; a line lives a few
// seconds, so a pan mid-line is left to the next one.
function useEdgeNudge(ref: React.RefObject<HTMLDivElement | null>, text: string | null): number {
  const [dx, setDx] = useState(0);
  const dxRef = useRef(0);
  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (!el || typeof document === 'undefined') return;
      const col = (document.getElementById('root') ?? document.body).getBoundingClientRect();
      const r = el.getBoundingClientRect();
      // Where it would sit with no nudge.
      const left = r.left - dxRef.current;
      const right = r.right - dxRef.current;
      let next = 0;
      if (left < col.left + S.s) next = col.left + S.s - left;
      else if (right > col.right - S.s) next = col.right - S.s - right;
      next = Math.round(next);
      if (next !== dxRef.current) {
        dxRef.current = next;
        setDx(next);
      }
    };
    measure();
    if (typeof window === 'undefined') return;
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [ref, text]);
  return dx;
}

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
  const dx = useEdgeNudge(ref, text);
  if (!text) return null;
  return (
    <div
      ref={ref}
      // The dog's lines — its questions included — read out as they
      // change (UX-14.4). It was silent to a screen reader: the words
      // were there, but nothing said when new ones arrived.
      role="status"
      aria-live="polite"
      style={{
        position: 'absolute',
        left: '50%',
        bottom,
        transform: `translateX(calc(-50% + ${dx}px))`,
        background: VOICE.background,
        color: VOICE.color,
        // VOICE.padding — see voice.ts for why 10 horizontal.
        padding: VOICE.padding,
        // Drawn edge in the bubble's own colour, like every other
        // voice bubble (UX-10.9): it was the one without it, and came
        // out 4px narrower and shorter than its mirror at the edge chip.
        border: VOICE.border,
        // Uniform full radius — matches the chat bubble + chip
        // family. No more "tail" corner; the bubble's position
        // above the dog is enough direction cue on its own.
        borderRadius: R.chip,
        fontSize: TYPE.body,
        lineHeight: VOICE.lineHeight,
        fontFamily: VOICE.fontFamily,
        whiteSpace: 'pre-line',
        // A long unbroken token (a URL, a street name run together)
        // wraps at maxWidth instead of running out of the bubble
        // (UX-11.19).
        overflowWrap: 'anywhere',
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
