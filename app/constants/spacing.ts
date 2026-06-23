// Spacing scale. Eight steps, mostly 4-based. Covers ~95% of the
// padding / margin / gap values currently in the app; outliers
// (6, 10, 14, 18, 22) snap to the nearest scale value during the
// migration.
//
// Use the named tokens (`S.m`, `S.l`) when you can — that's what
// makes "tighten this row" / "loosen that section" possible without
// hunting through unrelated screens. Raw numbers are fine for the
// rare case where the rhythm has to break (e.g. lining up a 36-px
// chip with a 38-px label).

export const S = {
  xs: 4,
  s: 8,
  m: 12,
  l: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;
