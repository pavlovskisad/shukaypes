// Single source of truth for icon-and-container sizing across the
// app. Families with explicit icon:container ratios so the look
// stays consistent regardless of where the icon lives.
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
//   icon-dominant CONTAINER — tab bar, modal hero panels where the
//   icon IS the surface (64-px box, 52-px icon). Not to be confused
//   with `iconHero` below, which is the icon used as the primary
//   visual identity INSIDE a card / modal / marker.
//
// iconHero
//   The category / identity icon (e.g. ☕ for a cafe, 🐶 for a pet
//   store) when it serves as the centred hero of a surface. Same
//   identity, three sizes depending on the surface it lives on:
//   card (carousel), modal (detail sheet), marker (map dot).
//   Tokenising the relationship means "make the spot icon bigger"
//   touches one place, not three.
//
// emojiHero
//   Emoji fallback for iconHero when there's no pixel-art SVG for
//   the category. Sized smaller than the SVG counterpart because
//   the heavier glyph weight reads larger at the same px value.
//
// inlineIcon
//   icon that lives inline with text in a button / row / chip
//   label — no fixed surrounding container. Sized for visual weight
//   against neighbouring type, not against a chip wall.

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

// Category icon as the hero of a UI surface. Three surface tiers,
// same identity. All three currently feed off the spots tab's pixel
// category icons (cafe / bar / vet etc.), but the tiers stay
// generic so a future "lost-dog hero icon" or similar would have a
// home.
//   card    — carousel card (280-tall surface, icon ~0.78 of height)
//   modal   — modal hero (220-tall surface, icon ~0.82 of height)
//   marker  — map marker (47-px disc, icon = disc; cluster bigger
//             at 54 for the count chip)
export const ICON_HERO = {
  card: 220,
  modal: 180,
  marker: 47,
  markerCluster: 54,
} as const;

// Emoji fallback weights for the same hero tiers. Glyphs are
// denser than the line-art pixel icons so the px values run
// smaller for the same visual mass.
export const EMOJI_HERO = {
  card: 180,
  modal: 140,
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


