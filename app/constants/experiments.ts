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
