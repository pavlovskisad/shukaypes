// Single source of truth for icon-and-container sizing across the
// app. Three families with explicit icon:container ratios so the
// look stays consistent regardless of where the icon lives.
//
// chip
//   horizontal pill with icon + label/value side by side.
//   Used: HUD meter pills, spots filter chips, quest pill, badges.
//   Icon sits beside text so the ratio runs hot without feeling
//   cramped (icon visually borrows space from the label column).
//
// button
//   round (or round-rect) button, usually icon-only or icon-on-top.
//   Used: radial menu around the companion, modal/floating CTAs
//   that don't have inline text.
//   Standalone icon needs breathing room around the circle, so the
//   ratio is the most generous.
//
// hero
//   large, icon-dominant surface. Tab bar, modal hero panels.
//   Icon carries 100% of the meaning, sized to dominate.
//
// inlineIcon
//   icon that lives inline with text in a button / row / chip
//   label — no fixed surrounding container. Sized for visual weight
//   against neighbouring type, not against a chip wall.
//
// mapMarker
//   icons drawn on the map itself (POI dots, cluster discs, modal
//   hero from the SpotModal opener). Sized for legibility at zoom
//   14-18 against the OFM tile backdrop.

export const CHIP = {
  // Bumped 38 → 48 to match the chunkier card / button / bubble
  // family across the app. Off-screen companion bookmark is 56,
  // radial button 68 — HUD pills at 48 read as part of the same
  // family instead of looking dinky.
  height: 48,
  icon: 40,           // 0.83 — same ratio as before.
  radius: 24,         // height / 2 — full pill
  paddingHoriz: 14,
} as const;

export const BUTTON = {
  // Radial-menu button — bumped 56 → 68 for a chunkier feel that
  // matches the chunkier cards / pills / bubbles family across the
  // rest of the app. Only consumed by RadialMenu; tab-bar icons
  // use the HERO token below.
  size: 68,
  icon: 54,           // 0.79 — same ratio as before.
  radius: 34,         // size / 2 — full round
} as const;

export const HERO = {
  size: 64,
  icon: 52,           // 0.81 — large icon-only, tab bar et al.
} as const;

export const INLINE_ICON = {
  cta: 34,            // primary modal-button icon next to label.
                      // Buttons are tight pills (8×14 padding, 14px
                      // text) — icon at ~2.4× the label so it
                      // dominates the silhouette and the label is
                      // a quiet confirmation rather than the visual
                      // anchor.
  secondary: 24,      // secondary action icon
  badge: 22,          // status badge icon (urgent/searching crown)
  stat: 27,           // stat-row label icon in profile
  about: 44,          // about-modal row icons (no chip, bare icon
                      // next to 15px title — ~2.9× ratio).
  navGlyph: 22,       // close/prev/next on modal overlays.
} as const;

export const MAP_MARKER = {
  poi: 47,
  poiCluster: 54,
  spotHero: 70,       // SpotModal opening hero icon
  card: 52,           // spots screen list-row icon — sits inside
                      // the 60px white chip with a comfortable rim.
} as const;
