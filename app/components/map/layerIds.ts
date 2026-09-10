// Layer ids for the custom WebGL layers, on their own so a module that
// only needs to ASK whether a layer exists (TerritoryLayer, MapView) does
// not have to import the module that BUILDS it. That matters for
// threeBuildingsLayer and groundFogLayer, which pull three.js — ~730KB of
// the bundle — and are loaded as a separate chunk (see gameRender.ts).
// An id imported from the layer module itself would drag the whole
// chunk back into the main bundle.
export const THREE_BUILDINGS_LAYER_ID = 'three-buildings';
export const GROUND_FOG_LAYER_ID = 'ground-fog';
