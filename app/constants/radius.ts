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
  pill: 999,
} as const;
