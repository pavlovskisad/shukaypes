// THE DOG ASKS SOMETHING, AND YOU ANSWER IT.
//
// Supersniff used to make its decisions out of band: tapping a card
// launched a search immediately, arriving silently rolled you onto the
// next pet, and leaving was whatever the logo did. The dog talked the
// whole way through and then had nothing to say at either end.
//
// So every decision point in a search is now the same shape — the dog
// says a line, and the answers sit directly beneath it as buttons. One
// component for all four moments (start, leave, arrive, and where to
// find the owner) because they are the same interaction, and writing
// them separately is how the four would drift apart.
//
// Rendered where the carousel sits rather than above the dog's nose:
// these are questions with consequences, and they want the thumb's half
// of the screen, not the sky.

import { VOICE } from '../../constants/voice';
import { R } from '../../constants/radius';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
import { SYSTEM_FONT } from '../../constants/fonts';

export interface PromptAction {
  label: string;
  onPress: () => void;
  // The one that carries the conversation forward. Brand blue and solid;
  // everything else is a quiet outline so there is never a question about
  // which button is the answer and which is the way out.
  primary?: boolean;
}

export function DogPrompt({
  text,
  actions,
}: {
  text: string;
  actions: PromptAction[];
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: S.m,
        pointerEvents: 'auto',
      }}
    >
      {/* Same dark bubble as the companion's own voice — this is the dog
          speaking, and it should not look like a system dialog. */}
      <div
        style={{
          background: VOICE.background,
          color: VOICE.color,
          padding: '12px 14px',
          borderRadius: R.chip,
          fontFamily: VOICE.fontFamily,
          fontSize: TYPE.body,
          lineHeight: 1.4,
          boxShadow: VOICE.shadow,
          border: VOICE.border,
          maxWidth: 'min(78vw, 340px)',
          textAlign: 'center',
          whiteSpace: 'pre-line',
        }}
      >
        {text}
      </div>
      <div style={{ display: 'flex', gap: S.s, flexWrap: 'wrap', justifyContent: 'center' }}>
        {actions.map((a) => (
          <button
            key={a.label}
            onClick={a.onPress}
            style={{
              appearance: 'none',
              border: a.primary ? 'none' : '2px solid rgba(0,0,0,0.12)',
              background: a.primary ? 'rgb(0,60,255)' : '#ffffff',
              color: a.primary ? '#ffffff' : '#1a1a1a',
              fontFamily: SYSTEM_FONT,
              fontSize: TYPE.body,
              fontWeight: 700,
              padding: '12px 20px',
              borderRadius: R.pill,
              cursor: 'pointer',
              // Comfortably past the 44px tap target — these are pressed
              // outdoors, one-handed, usually while walking.
              minHeight: 48,
              boxShadow: a.primary
                ? '0 6px 18px rgba(0,60,255,0.35)'
                : '0 4px 14px rgba(0,0,0,0.16)',
            }}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
