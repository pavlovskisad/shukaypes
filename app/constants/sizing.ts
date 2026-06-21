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
  height: 38,
  icon: 32,           // 0.84 — beside-label density that reads
                      // crisp on HUD + filter chips.
  radius: 19,         // height / 2 — full pill
  paddingHoriz: 12,
} as const;

export const BUTTON = {
  size: 56,
  icon: 44,           // 0.79 — splits the difference between the
                      // original 47 (too dense against dark glass)
                      // and the 38 we tried last pass (too sparse).
  radius: 28,         // size / 2 — full round
} as const;

export const HERO = {
  size: 64,
  icon: 52,           // 0.81 — large icon-only, tab bar et al.
} as const;

export const INLINE_ICON = {
  cta: 34,            // primary modal-button icon next to label
                      // ("i've seen them" eye, "start search" lens,
                      // "ходімо сюди" walk). Sized ~2.3× the
                      // surrounding 15px button label so the icon
                      // carries glance-weight, not just punctuation.
  secondary: 24,      // secondary action icon
  badge: 22,          // status badge icon (urgent/searching crown)
  stat: 27,           // stat-row label icon in profile
  about: 44,          // about-modal row icons (no chip anymore, bare
                      // icon next to 15px title — ~2.9× ratio matches
                      // the spots-screen card rows).
} as const;

export const MAP_MARKER = {
  poi: 47,
  poiCluster: 54,
  spotHero: 70,       // SpotModal opening hero icon
  card: 45,           // spots screen list-row icon
} as const;
