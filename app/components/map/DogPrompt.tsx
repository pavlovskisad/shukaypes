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
// What lives here is the answers, up in the TOP HUD on the corner
// logo's line — the same strip the nav HUD's distance-and-exit row
// borrows during a running search (the two never show together). Two
// earlier placements both lost to the card: mid-screen they covered
// the photo the question was about, and at the bottom they fought the
// deck for its ground. The buttons are sized to the strip — pill
// height matching the nav HUD's, weight 800 — and they POP in with a
// stagger, so a question appearing reads as the interface stepping
// forward rather than two pills quietly materialising.

import { R } from '../../constants/radius';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
import { SYSTEM_FONT } from '../../constants/fonts';
import { INK, SURFACE } from '../../constants/surface';

export interface PromptAction {
  label: string;
  onPress: () => void;
  // The one that carries the conversation forward. Solid ink; everything
  // else is white with the same edge, so there is never a question about
  // which button is the answer and which is the way out.
  primary?: boolean;
}

export function DogPrompt({ actions }: { actions: PromptAction[] }) {
  return (
    <div
      style={{
        // A COLUMN, on purpose — not a row that happens to wrap. The
        // first answer stands on the corner logo's line and the rest
        // stack under it, which is the arrangement that survived on a
        // real phone: two full-width-ish pills never fit beside the
        // logo in one row, and the accidental wrap of the row layout
        // turned out to be the right design. Same shape at every
        // screen width now, for every prompt kind.
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: S.s,
        pointerEvents: 'auto',
      }}
    >
      {/* Scoped keyframes — the overshoot curve is the same
          cubic-bezier(0.34,1.56,0.64,1) family the supersniff HUD's
          pop-in already speaks. Drops in from above: the buttons live
          at the top of the screen now, so that's where they come from. */}
      <style>{`
        @keyframes dog-prompt-pop {
          0%   { transform: scale(0.55) translateY(-16px); opacity: 0; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }
      `}</style>
      {actions.map((a, i) => (
        <button
          key={a.label}
          onClick={a.onPress}
          style={{
            appearance: 'none',
            // The house edge — same ink on both, so the two buttons are
            // the same size and only their fill says which is the
            // answer. On the primary the edge is ink-on-ink and
            // invisible; it is there to keep the heights equal.
            border: SURFACE.hair,
            background: a.primary ? INK : '#ffffff',
            color: a.primary ? '#ffffff' : INK,
            fontFamily: SYSTEM_FONT,
            fontSize: TYPE.body,
            fontWeight: 800,
            padding: '14px 22px',
            borderRadius: R.button,
            cursor: 'pointer',
            // Past the 44px tap target — these are pressed outdoors,
            // one-handed, usually while walking — and matched to the
            // corner logo's height so the strip reads as one HUD line.
            minHeight: 52,
            boxShadow: SURFACE.shadow,
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
