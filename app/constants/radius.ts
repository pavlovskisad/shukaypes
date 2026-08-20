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
  pill: 999,
} as const;
