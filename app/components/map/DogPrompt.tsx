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
// What lives here is the answers, at the bottom HUD — the ground the
// tab bar stands on in normal mode and vacates in supersniff — because
// that is where a hand actually is on a walk. The buttons are sized
// for that job: big, and they POP in with a stagger, so a question
// appearing reads as the interface stepping forward rather than two
// pills quietly materialising mid-screen.

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
        gap: S.m,
        flexWrap: 'wrap',
        justifyContent: 'center',
        pointerEvents: 'auto',
        paddingLeft: S.l,
        paddingRight: S.l,
      }}
    >
      {/* Scoped keyframes — the overshoot curve is the same
          cubic-bezier(0.34,1.56,0.64,1) family the supersniff HUD's
          pop-in already speaks. */}
      <style>{`
        @keyframes dog-prompt-pop {
          0%   { transform: scale(0.55) translateY(22px); opacity: 0; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }
      `}</style>
      {actions.map((a, i) => (
        <button
          key={a.label}
          onClick={a.onPress}
          style={{
            appearance: 'none',
            // The house hairline (modals, spot cards): 1px at 0.06 alpha.
            // Anything heavier reads as a different design language.
            border: a.primary ? 'none' : '1px solid rgba(0,0,0,0.06)',
            background: a.primary ? 'rgb(0,60,255)' : '#ffffff',
            color: a.primary ? '#ffffff' : '#1a1a1a',
            fontFamily: SYSTEM_FONT,
            fontSize: TYPE.title,
            fontWeight: 800,
            padding: '16px 28px',
            borderRadius: R.pill,
            cursor: 'pointer',
            // Well past the 44px tap target — these are pressed outdoors,
            // one-handed, usually while walking, and they are the only
            // controls on screen at that moment. Tab-bar height, in fact:
            // they stand where it stands.
            minHeight: 58,
            boxShadow: a.primary
              ? '0 6px 18px rgba(0,60,255,0.35)'
              : '0 4px 14px rgba(0,0,0,0.16)',
            // Staggered pop-in, the way-out first and the answer landing
            // on top of it a beat later.
            animation: `dog-prompt-pop 360ms cubic-bezier(0.34, 1.56, 0.64, 1) ${i * 70}ms both`,
          }}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
