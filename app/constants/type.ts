// Type scale. Six sizes covering caption → display, each with a
// canonical weight + letter-spacing. Style objects can be spread
// directly into a Text style; per-screen overrides (color,
// textAlign, etc.) are merged on top.
//
// Naming follows visual weight, not pixel size — that way a future
// retune of the actual numbers doesn't force a rename pass across
// the codebase. If you find yourself reaching for a 7th size, first
// check whether one of these adapted with a one-line override would
// do the job.
//
// Weights are strings (RN-Web cares about the difference between
// `'700'` and `700` in places where the renderer falls back to the
// system font stack — keep one type to avoid the audit churn we
// just resolved).

import type { TextStyle } from 'react-native';

export const TYPE = {
  // Chip labels, badges, distance pills, small counts. Always
  // letter-spaced so the all-lowercase chip text doesn't read as a
  // dense slab.
  caption: {
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 0.4,
  } satisfies TextStyle,
  // Row meta lines ("ago", "completed · +25 pts"), secondary text
  // in cards, address lines.
  small: {
    fontSize: 13,
    fontWeight: '600' as const,
  } satisfies TextStyle,
  // Default body — row labels, regular paragraph text.
  body: {
    fontSize: 15,
    fontWeight: '400' as const,
  } satisfies TextStyle,
  // Card and section titles ("кав'ярні", "щоденні квести"). Same
  // weight + lowercase + slight letter-spacing as the rest of the
  // app's title family.
  title: {
    fontSize: 17,
    fontWeight: '800' as const,
    letterSpacing: 0.2,
  } satisfies TextStyle,
  // Big card names — spot name on a SpotCardView, dog name on the
  // LostDog card.
  hero: {
    fontSize: 22,
    fontWeight: '800' as const,
  } satisfies TextStyle,
  // Modal hero — the giant name at the top of the LostDogModal /
  // SpotModal info section.
  display: {
    fontSize: 26,
    fontWeight: '800' as const,
  } satisfies TextStyle,
} as const;
