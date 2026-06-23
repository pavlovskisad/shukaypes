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
  chip: 24,
  card: 28,
  pill: 999,
} as const;
