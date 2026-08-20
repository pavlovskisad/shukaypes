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
  // THE TWO BLUES, which the app has always had and never named.
  //
  // blue — the interface asking for a tap. CTA pills (constants/
  // buttons.ts), progress bars, the selected POI, your own territory.
  // territoryColor.ts already calls this "the CTA pill blue".
  //
  // routeBlue — paint on the MAP. Walking routes, the sniff ring,
  // search zones, and the numbered stops on a planned walk. Lighter,
  // because it sits on top of the basemap rather than on white.
  //
  // Keep the distinction: a walk's stop disc is routeBlue because it
  // belongs to the line, and the button under it is blue because it
  // belongs to the interface. Both were scattered as literals across a
  // dozen files before this; new code takes them from here.
  blue: 'rgb(0,60,255)',
  routeBlue: '#2f6bff',
  // A PLANNED WALK has its own two colours, taken from the product
  // reference on the landing page: a chunky cyan dashed line with
  // bright green discs sitting on it. Deliberately not routeBlue — a
  // quest route and a sniff ring are the app pointing at one place, a
  // tour is a route with stops, and they should not read as the same
  // object.
  //
  walkLine: '#29a8ff',
  walkStop: '#7CFB00',
} as const;

export type ColorKey = keyof typeof colors;
