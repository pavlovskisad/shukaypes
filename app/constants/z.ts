// Single source of truth for DOM z-index across the app. Tiered so
// new UI elements pick a tier instead of guessing a number.
//
// Tiers are global — they assume a single root stacking context for
// the tab screen + map. If an ancestor gains a `transform`,
// `opacity`, `filter`, or `will-change` style it creates a new
// stacking context and the tier numbers become RELATIVE inside that
// subtree, not absolute. Keep map-overlay containers free of those
// properties unless you mean it.
//
// Gaps of 5 between values so we can insert mid-tier without
// renumbering everything.

export const Z = {
  // ───────────────────────────────────────────────────────────────
  // TIER 1 — map markers (DOM children of .maplibregl-canvas-container)
  // ───────────────────────────────────────────────────────────────
  // Default markers (POI, token, waypoint, food, user, lost-dog,
  // cluster outer). MapLibre stacks by DOM order when no zIndex is
  // set; this explicit value gives every marker the same floor so
  // we can lift specific ones above the rest.
  MARKER_DEFAULT: 10,
  // The dog. Sits above other markers in dense areas — when the
  // map's covered in POI clusters the companion should still be
  // the visual anchor.
  MARKER_COMPANION: 15,
  // Spiderified children of an expanded cluster — local to the
  // cluster's stacking context, but bumped here so they paint
  // above other map markers while expanded.
  MARKER_CLUSTER_CHILD: 18,

  // ───────────────────────────────────────────────────────────────
  // TIER 2 — map-area HUD (DOM children of MapView, above markers)
  // ───────────────────────────────────────────────────────────────
  // StatusBar pills (sun% / bone% / paws), sniff toggle, corner
  // logo. Sit above markers so they're always reachable.
  HUD_PILLS: 30,
  // Off-screen lost-pet chips (sniff mode) + companion bookmark.
  // Above the HUD pills so a chip overlapping the pill row still
  // catches the tap.
  HUD_CHIPS: 35,
  // Bubble that mirrors the dog's current remark next to the
  // off-screen companion chip. One notch above chips so it reads
  // as the chip's speech.
  HUD_CHIP_BUBBLE: 37,
  // Companion bookmark sits above the lost-pet chips so it never
  // drowns underneath a stack of pet photos when the dog drifts
  // off-screen at the same edge as several pets.
  HUD_CHIP_COMPANION: 38,
  // Cancel-walk / abandon-quest / restack-all pills. Above chips
  // because they're contextual actions and the user is reaching
  // for them.
  HUD_PILLS_OVERLAY: 40,
  // Sniff "sniffing…" indicator + discovered-place story bubble.
  // Top of the HUD tier so it dominates marker re-renders during
  // viewport refetches.
  HUD_SNIFF_BUBBLE: 45,

  // ───────────────────────────────────────────────────────────────
  // TIER 3 — modals over the map (cover the map, not global UI)
  // ───────────────────────────────────────────────────────────────
  MODAL_MAP: 60,

  // ───────────────────────────────────────────────────────────────
  // TIER 4 — global overlays
  // ───────────────────────────────────────────────────────────────
  MODAL_GLOBAL: 80,
  SPLASH: 100,
} as const;
