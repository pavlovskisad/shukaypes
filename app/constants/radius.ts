// Border-radius scale. Five values for the five kinds of corner
// the app actually has:
//
//   sm   — progress bars, slim inputs (was a long tail of 2/3/4/7
//          across the codebase; all collapse to 4).
//   md   — secondary surfaces (mid-sized panels that aren't card-
//          family but aren't pills either).
//   chip — chip / smaller button bodies.
//   card — full card / modal corners.
//   pill — full pill (also fully-round circle on any square element
//          via the 999 trick; replaces the old `borderRadius: 18`
//          on 36×36 close buttons since both render the same).

// THE RULE, so this stops being decided by feel each time:
//
//   Nested things take a TIGHTER corner than what contains them.
//   Free-floating things are capsules.
//
// This replaces an earlier rule here that said "content that can wrap
// gets a corner, content that cannot gets a capsule", which was built
// on a misreading of the reference. Measured off the screenshot: its
// card turns a corner at 5.8% of its own height, and the two buttons
// INSIDE that card turn one at 23.2% of theirs. A capsule is 50%.
// Neither of them is a capsule — the buttons are rounded rectangles
// with a corner tighter than the card's, which is the nested-radius
// principle and not a special case.
//
// So: a card is 18, a button sitting inside one is 12, a label naming
// one is 10. Each step down is a step further inside.
//
// Capsules are for elements that float on their own with nothing
// containing them — HUD pills, the dog's answer pills, the cancel-walk
// row, the tab bar. Nothing nests them, so nothing sets their corner.
//
// And a pill radius on a SQUARE box is a circle, not a capsule — close
// buttons, the send arrow, map pins, the radial discs. Those never
// enter the question.

export const R = {
  sm: 4,
  md: 12,
  // chip and card used to be 24 and 28. Measured against a device
  // screenshot of the reference, whose cards turn a corner at about
  // 5.9% of their height where ours were at 11.1% — the app read
  // noticeably softer than the thing it is meant to look like. 18 puts
  // our 252px card at 7.1%, and collapsing the two to one value means a
  // speech bubble, a card and a sheet all turn the same corner.
  chip: 18,
  card: 18,
  // Metadata labels that sit ON a card — the urgency badge, the
  // distance chip, the rating. These were full pills, which made them
  // lozenges stuck to a surface that had just learned to turn a proper
  // corner. A label is a small piece of the same paper, so it gets a
  // small version of the same corner rather than a different shape.
  //
  // Not R.card scaled down proportionally: 7.1% of a 33px chip is 2px,
  // which reads as a sharp rectangle. Corner radius does not scale
  // linearly with the eye. 10 is the value that still says "rounded"
  // at this size without going back to a capsule.
  label: 10,
  // An action button sitting inside a card or a sheet. Tighter than
  // the 18 of the surface holding it, looser than the 10 of a label
  // that merely names it — a button is a thing you press, not a tag.
  button: 12,
  pill: 999,
} as const;
