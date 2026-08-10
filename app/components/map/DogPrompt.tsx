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
// The WORDS are not here. A question the dog asks comes out of the dog,
// in the same bubble as everything else it says (MapView feeds it as the
// companion's bubble) — a second bubble floating at the bottom of the
// screen read as a system dialog wearing the dog's voice.
//
// What lives here is the answers, down in the thumb's half of the
// screen, because that is where a hand actually is on a walk.

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

export function DogPrompt({ actions }: { actions: PromptAction[] }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: S.s,
        flexWrap: 'wrap',
        justifyContent: 'center',
        pointerEvents: 'auto',
      }}
    >
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
  );
}
