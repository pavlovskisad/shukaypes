// Feature flags for in-progress render experiments. These are toggled
// per-branch: the `experiment/game-render` branch flips GAME_RENDER on so
// its Vercel preview URL shows the Tier-2 look while `main` / prod stays
// on the shipped MapLibre render. If this ever merges, flip the flag (or
// wire it to an env / URL param) rather than deleting the plumbing.

// Tier-2 "game render": replace MapLibre's flat fill-extrusion buildings
// with real extruded Three.js meshes that get TRUE per-distance depth fog
// (FogExp2) + a directional sun. The screen-space atmosphere fog + sky
// still handle the ground/horizon; this adds correct volumetric fog on the
// buildings themselves — the one thing the 2D approximation can't do.
export const GAME_RENDER = true;

// PAPER MAP (experiment): the walking map as a flat pen drawing — see
// PAPER_PALETTE in map/crayonStyle.ts. Everything that carries tone comes
// off, and that includes the two WebGL layers this flag switches off: the
// Three.js extruded city and the ground fog it stands in are shading, and
// a line drawing has none. Buildings are traced as footprints instead.
//
// It does NOT touch GAME_RENDER's other work. The building AVOIDER still
// runs — it nudges tokens and food out of footprints, which is gameplay,
// not render, and a token buried under a block is just as lost on a flat
// map as on a raised one.
export const PAPER_MAP = true;

// Multiplayer presence: send `mp=1` on the map sync so the server tracks this
// walker and returns nearby online players (real + bots), and render them as
// other dogs on the map. Gated so prod clients (flag off) neither appear to
// nor see other players until we ship it.
export const MULTIPLAYER = true;

// Dog-cam (prototype): a low, close "car-navigation" chase camera that follows
// the companion — heading-locked to the dog's travel so forward is up. Exposes
// a toggle button; off by default. Flag-gated so we can pull the whole thing
// with one switch while we feel the dynamics out.
export const DOG_CAM = true;

// Flat ground camera for walks ('explore') and territory ('play'): the tilt
// goes to zero and is LOCKED there, and the camera keeps itself on the dog,
// standing down whenever the walker takes hold of the map. Supersniff keeps
// its own chase camera — this is the other half of the app, the half that is
// about ground rather than about a street ahead of you. Flag-gated for the
// same reason DOG_CAM is: a camera change is felt everywhere, and one switch
// should put it back.
export const FLAT_GROUND_CAM = true;

// Lost-pet PINS on the main map. Off for now: the search layer is meant to
// be the quiet half of the app — you meet a lost dog through the companion
// and the carousel, not through a map peppered with photo pins competing
// with the territory you're actually walking. The pets are still fetched
// and still drive supersniff, the carousel and the cinematic pet view;
// this only hides the scattered pins. Flip back on to restore them.
export const LOST_DOG_PINS = false;
