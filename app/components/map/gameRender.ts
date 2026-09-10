// The game render, behind one dynamic import.
//
// Both layers here depend on three.js, which is ~730KB of a 3.9MB web
// bundle — the second-largest thing in it after MapLibre. Metro splits
// `import()` into its own chunk on web, so importing this module lazily
// (MapView does, via loadGameRender) takes three.js off the critical
// path: the map can be up and drawing before the buildings chunk has
// finished downloading, and a device with no WebGL2 — which cannot run
// this render at all — never downloads it.
//
// Nothing here is exported by name from anywhere else. MapView holds the
// module handle and calls the two factories in the style.load block, and
// the ids they register under live in layerIds.ts so the rest of the app
// can ask for them without touching this chunk.
export { createGroundFogLayer } from './groundFogLayer';
export { createThreeBuildingsLayer } from './threeBuildingsLayer';
