interface SpeechBubbleProps {
  text: string | null;
}

// Dark bubble just above the companion (demo lines 296-304). The parent
// is the companion's overlay div, so it moves with the map. `bottom:85%`
// places the bubble's bottom edge ~14px above the nose so it hugs the
// companion instead of floating up into the top radial-menu button.
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
        fontFamily: 'system-ui, -apple-system, sans-serif',
        whiteSpace: 'nowrap',
        boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
        pointerEvents: 'none',
        opacity: 0.98,
      }}
    >
      {text}
    </div>
  );
}
