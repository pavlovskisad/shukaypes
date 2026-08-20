// Paper-and-ink surfaces: the shared recipe for every card, sheet and
// popup in the app.
//
// The app used to build surfaces out of fill + shadow alone, with
// borders down at `1px solid rgba(0,0,0,0.06)` — a hairline that reads
// as an anti-aliasing artefact rather than as a drawn edge. That works
// for a flat material UI; it does not work for this app, whose map is
// drawn in crayon and whose dog is a pixel sprite. A surface with no
// edge looks like a hole in the screen. A surface with an inked edge
// looks like a piece of paper somebody put there.
//
// So: white fill, a real black stroke, and a soft shadow underneath to
// lift the paper off whatever it is lying on. The shadow stays soft and
// low-contrast on purpose — with an ink edge doing the work of defining
// the shape, a heavy shadow just muddies it.
//
// Pill FORMS are not defined here. `constants/buttons.ts` owns those and
// they are deliberately untouched by this file; what changes is only the
// paint they use — see MODAL_PILL_LIGHT, which now carries a real edge.

export const INK = '#1a1a1a';

export const SURFACE = {
  fill: '#ffffff',

  // INTEGERS ONLY. Chrome floors border-width to whole CSS pixels, at
  // every device pixel ratio — a 2.5px stroke renders at 2, and the
  // 1.5px this file first shipped with was rendering at 1, which is the
  // hairline weight the whole change exists to get away from. Measured,
  // not assumed: getComputedStyle reported 2px for a 2.5px rule on a
  // dpr-3 viewport.
  //
  // Cards, sheets, popups — anything that is a page of paper in its own
  // right. The reference's stroke runs about 1.4% of card height; 3px
  // on our 252px card is 1.19%, near enough to read as the same hand.
  stroke: `3px solid ${INK}`,

  // Chips, badges, close buttons, small pills. One step down, so a 36px
  // control doesn't read as heavier than the 400px card behind it —
  // and one step is all there is room for once fractions are off the
  // table.
  hair: `2px solid ${INK}`,

  // Resting shadow for a card sitting on the map.
  shadow: '0 6px 18px rgba(0,0,0,0.14)',

  // Sheets, which cover more and should feel further off the surface.
  lift: '0 10px 26px rgba(0,0,0,0.18)',

  // For a chip lying on top of a photo, where the ink edge alone can
  // land on a dark patch and vanish.
  onPhoto: '0 4px 14px rgba(0,0,0,0.28)',
} as const;
