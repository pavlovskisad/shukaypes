export const colors = {
  black: '#1a1a1a',
  grey: '#777',
  greyLight: '#aaa',
  greyPale: '#ddd',
  greyBg: '#f0f0f0',
  white: '#ffffff',
  accent: '#c8ff00',
  red: '#e84040',
  redBg: '#fde8e8',
  amber: '#d9a030',
  amberBg: '#fdf3e0',
  // THE BLUES, which the app had for a long time and never named.
  //
  // blue — the interface asking for a tap. CTA pills (constants/
  // buttons.ts), progress bars, the selected POI, your own territory.
  // territoryColor.ts already calls this "the CTA pill blue".
  blue: 'rgb(0,60,255)',
  // sniffBlue — the app pointing AT something on the map: the long-press
  // sniff ring, a pet's search zone, the highlight on a selected lost
  // dog, the building glow. Not a route.
  sniffBlue: '#2f6bff',
  // routeLine — every route the app draws, without exception: a planned
  // walk, a detective quest, the line the dog leads you along in
  // supersniff. CrayonRoute holds the rest of that style (weight,
  // opacity, dashes) as its own defaults, so a route is drawn by
  // rendering one and passing no styling at all.
  //
  // One style for all three because they are the same promise to the
  // walker — go this way — and three different blues for one promise is
  // noise, not information.
  routeLine: '#29a8ff',
  // The stops on a planned walk, sitting on that line. The one place a
  // route gets annotated, and the only green in the map's vocabulary.
  walkStop: '#7CFB00',
} as const;

export type ColorKey = keyof typeof colors;
