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
  // the visual anchor. Bumped 15 → 42 so it (and the SpeechBubble
  // inside its marker container) paints ABOVE the off-screen chips
  // (HUD_CHIPS = 35) when the dog speaks near the viewport edge.
  // Still well below MODAL_MAP (60).
  MARKER_COMPANION: 42,
  // Spiderified children of an expanded cluster — local to the
  // cluster's stacking context, but bumped here so they paint
  // above other map markers while expanded.
  MARKER_CLUSTER_CHILD: 18,
  // Numbered stops on a planned walk. Above the ordinary POI field so
  // the points the route was built around stay findable in it, below
  // the dog. An OPEN stop's story bubble goes to HUD_SNIFF_BUBBLE
  // instead — it's the same voice, and it has to clear the other
  // stops' discs.
  MARKER_WALK_STOP: 20,

  // ───────────────────────────────────────────────────────────────
  // TIER 2 — map-area HUD (DOM children of MapView, above markers)
  // ───────────────────────────────────────────────────────────────
  // StatusBar pills (sun% / bone% / paws), sniff toggle, corner
  // logo. Sit above markers so they're always reachable.
  HUD_PILLS: 30,
  // The off-screen companion bookmark. Above the HUD pills so a chip
  // overlapping the pill row still catches the tap.
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
  // The walk's list of stops. ABOVE the companion (42) and its speech
  // bubble, which is the whole point: the card describes the walk the
  // dog just proposed, and the dog standing in front of its own
  // itinerary is unreadable.
  //
  // NB this only works because the container it lives in sets no
  // z-index of its own. A positioned ancestor WITH one opens a new
  // stacking context and traps every descendant at the ancestor's
  // level, no matter how high they number themselves — which is
  // exactly how the card ended up under the dog while nominally
  // sitting at 40 next to a 42.

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
