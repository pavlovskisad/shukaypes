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
//
// RN-web gives EVERY <View> `position: relative; z-index: 0`, which
// makes each one a stacking context. A View anywhere between a layer
// and the tab screen's root caps that layer at the View's own level,
// whatever number it carries. The map tab's `mapLayer` was exactly that
// (UX-7.4): every marker and in-map pill below sat under the HUD at 30
// regardless of its tier. It is a plain <div> now, so the tiers below
// really are compared against each other — which means the companion
// (42), the lost-pet deck (35) and the sniff bubble (52) DO paint over
// the corner logo and the status pills, as this file always said.

export const Z = {
  // ───────────────────────────────────────────────────────────────
  // TIER 1 — map markers (DOM children of .maplibregl-canvas-container)
  // ───────────────────────────────────────────────────────────────
  // Default markers (POI, token, waypoint, food, user, lost-dog,
  // cluster outer). MapLibre stacks by DOM order when no zIndex is
  // set; this explicit value gives every marker the same floor so
  // we can lift specific ones above the rest.
  MARKER_DEFAULT: 10,
  // Every lost-pet pin and collapsed cluster. One notch over the floor
  // so the other walkers (which sit ON the floor) can never paint over
  // a pet: the pets are what the map is for, the walkers are company
  // (UX-8.2). It has to be set on every pin, not just some — a marker
  // with no z-index stacks at 0, under anything that has one.
  MARKER_LOST_PET: 12,
  // The dog. Sits above other markers in dense areas — when the
  // map's covered in POI clusters the companion should still be
  // the visual anchor. Bumped 15 → 42 so it (and the SpeechBubble
  // inside its marker container) paints ABOVE the off-screen chips
  // (HUD_CHIPS = 35) when the dog speaks near the viewport edge.
  // Still well below MODAL_MAP (60).
  MARKER_COMPANION: 42,
  // The one thing the person has picked on the map — the lost pet whose
  // close-up is open, the spot the Spots tab sent them to. One step over
  // the dog, so the chosen pin is never under anything (UX-8.6).
  MARKER_SELECTED: 43,
  // Spiderified children of an expanded cluster — local to the
  // cluster's stacking context, but bumped here so they paint
  // above other map markers while expanded.
  MARKER_CLUSTER_CHILD: 18,
  // Stops on a planned walk. These are NOT in the marker tier's own
  // range, deliberately: the dots are the only way to hear a stop's
  // story now that the roster card is gone, so while a walk is on the
  // map they are the most important thing to be able to hit. At 20 they
  // sat under the dog, under its speech bubble, and under every HUD
  // chip — a dot could be right there and refuse the tap.
  //
  // They exist only while `walkStops` is non-empty, so "above the HUD"
  // is scoped to a live walk on its own; there is no state where these
  // numbers cover chrome with no walk under it.
  MARKER_WALK_STOP: 46,
  // An open stop's story bubble, one notch up so it clears the other
  // stops' discs.
  MARKER_WALK_STOP_OPEN: 50,

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
  // as the chip's speech. It now renders INSIDE the chip's portal
  // wrapper (UX-7.11), whose transform makes a stacking context, so
  // in practice it paints at the wrapper's HUD_CHIP_COMPANION; the
  // number is kept for anything that mirrors it outside a chip.
  HUD_CHIP_BUBBLE: 37,
  // Companion bookmark sits above the lost-pet chips so it never
  // drowns underneath a stack of pet photos when the dog drifts
  // off-screen at the same edge as several pets.
  HUD_CHIP_COMPANION: 38,
  // Cancel-walk / GPS-status / restack-all pills. Above chips
  // because they're contextual actions and the user is reaching
  // for them — and above the walk stops, which is the one exception
  // to "the dots are on top": the route runs across the whole
  // viewport, so a dot can land exactly on the pill that leaves the
  // walk, and leaving must never be the thing you cannot press.
  HUD_PILLS_OVERLAY: 54,
  // The "X waved at you" toast (multiplayer). Portaled to <body>. Above
  // the overlay pills it is offset below, so a wrapped pill row can
  // never sit on top of it, but BELOW MODAL_MAP: it used to carry a raw
  // 9000 and painted over every open sheet, where a tap on it panned a
  // map the person could not see (UX-7.3).
  TOAST: 56,
  // Sniff "sniffing…" indicator + discovered-place story bubble.
  // Above the walk stops (46/50), so a story you just sniffed up is not
  // covered by the dots of a walk that happens to pass it — it was 45
  // and called itself "top of the tier" while sitting under both
  // (UX-8.5). It YIELDS to the dog's menu the way the stops do: while
  // the ring is open SniffPress drops to MARKER_DEFAULT (UX-8.4),
  // because the menu cannot climb out of the companion's own context.
  HUD_SNIFF_BUBBLE: 52,
  //
  // NB the walk-stop numbers above only clear this tier because the
  // container they live in sets no z-index of its own. A positioned
  // ancestor WITH one opens a new stacking context and traps every
  // descendant at the ancestor's level, no matter how high they
  // number themselves.

  // The offline / slow-connection banner (app/_layout.tsx). Lives in
  // #root, anchored above the tab bar. Above the map chrome, and below
  // every modal on purpose: a sheet the person opened is the thing they
  // are reading, and the banner will still be there when it closes.
  BANNER: 50,

  // ───────────────────────────────────────────────────────────────
  // TIER 3 — modals over the map (cover the map, not global UI)
  // ───────────────────────────────────────────────────────────────
  MODAL_MAP: 60,

  // ───────────────────────────────────────────────────────────────
  // TIER 4 — global overlays
  // ───────────────────────────────────────────────────────────────
  MODAL_GLOBAL: 80,
  // The about sheet. Its own step rather than MODAL_GLOBAL: it has to
  // clear every global sheet (the account edit sheet included), and at
  // an equal number the winner is whichever mounted last. It carried a
  // raw 1000 before, which also put it over the splash.
  MODAL_INFO: 90,
  // Portaled to <body> (UX-7.7) so body-level sheets cannot paint over
  // it during the first second.
  SPLASH: 100,
} as const;
