interface SpeechBubbleProps {
  text: string | null;
}

// Dark bubble above the companion (demo lines 296-304). The parent is the
// companion's overlay div, so it moves with the map.
export function SpeechBubble({ text }: SpeechBubbleProps) {
  if (!text) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        bottom: '110%',
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
