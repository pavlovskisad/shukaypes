interface SpeechBubbleProps {
  text: string | null;
}

// Dark bubble just above the companion (demo lines 296-304). The parent
// is the companion's overlay div, so it moves with the map. `bottom:85%`
// places the bubble's bottom edge ~14px above the nose so it hugs the
// companion instead of floating up into the top radial-menu button.
//
// maxWidth is `min(60vw, 320px)` — roughly half the screen on most
// phones, capped so it doesn't get unwieldy on tablets. The previous
// 280px cap was wrapping common bubbles ("long roundtrip to St.
// Andrew's Church 🚶") into 8-line strips. whiteSpace stays
// `pre-line` so explicit \n breaks (e.g. *sniff sniff*\n…) render as
// real lines.
export function SpeechBubble({ text }: SpeechBubbleProps) {
  if (!text) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        bottom: '85%',
        transform: 'translateX(-50%)',
        background: '#1a1a1a',
        color: '#ffffff',
        padding: '8px 14px',
        borderRadius: '18px 18px 18px 4px',
        fontSize: 14,
        lineHeight: 1.35,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        whiteSpace: 'pre-line',
        wordBreak: 'break-word',
        maxWidth: 'min(60vw, 320px)',
        textAlign: 'center',
        boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
        pointerEvents: 'none',
        opacity: 0.98,
      }}
    >
      {text}
    </div>
  );
}
