// THE MAP, DRAWN BY HAND.
//
// components/ui/HandDrawn.tsx made every border in the app an ink line
// that wobbles — a card is a rectangle somebody drew, not a rectangle a
// browser computed, and no two are the same rectangle. This does the
// same thing to the city: the roads, the buildings, the parks and the
// river stop being the tile style's exact geometry and become lines with
// a hand in them.
//
// MapLibre cannot do this from a stylesheet. A style sets colour and
// width on geometry it already has; there is no hook that moves a vertex.
// So we take the geometry back: read the features out of the vector
// source, push every point off the true line, and draw the result from
// our own GeoJSON layers with the originals hidden.
//
// ---------------------------------------------------------------------
// WHY THE NOISE IS SPATIAL HERE AND PER-ELEMENT THERE
//
// HandDrawn seeds each element from its own id, which is exactly right
// for cards: they are independent, and a pet keeps its frame for as long
// as it exists. Map features are not independent. They arrive CLIPPED
// PER TILE — one road crossing a tile boundary comes back as two
// features, and a per-feature noise run restarts its phase at each
// half's own start, so the two halves meet at the seam pointing in
// different directions. Every tile edge in the city would show a kink.
//
// So the displacement is a FIELD: a smooth 2D noise over world position,
// sampled wherever a point happens to be. Both halves of a split road
// ask the field the same question at the seam and get the same answer,
// so they join. Every shape still gets its own wobble — it occupies its
// own ground — which is the property that made the cards worth drawing.
// It also closes rings for free: a ring's last point IS its first point,
// so it gets the same displacement and the shape stays shut.
//
// ---------------------------------------------------------------------
// WHAT IS DELIBERATELY NOT BORROWED
//
// HandDrawn runs its wobbled points through centripetal Catmull-Rom, so
// a card's corners come out round. This does not, and that is a decision
// rather than a shortcut: a building's corner is a REAL corner — the
// wall turns there — and rounding every footprint in the city turns a
// street of blocks into a street of lozenges. The map wants the bow in
// the straight run, not the rounding at the turn. Points are resampled
// close enough together (STEP_PX) that the field itself carries the
// curve.

import type maplibregl from 'maplibre-gl';
import type {
  GeoJSONSource,
  LayerSpecification,
  GeoJSONFeature,
} from 'maplibre-gl';
import type { Palette } from './crayonStyle';

// Every id we own. crayonStyle's whitelist skips this prefix for the
// same reason it skips `territory-`: a sweep that does not recognise a
// layer hides it, and these are not the tiles' furniture.
export const SKETCH_PREFIX = 'sketch-';

const SRC = {
  road: 'sketch-road-src',
  building: 'sketch-building-src',
  park: 'sketch-park-src',
  water: 'sketch-water-src',
} as const;

// ---------------------------------------------------------------------
// Web Mercator world pixels
// ---------------------------------------------------------------------

// The wobble has to be a constant number of PIXELS, not of metres. A
// fixed metre amplitude is invisible at z14 and a stagger at z18; a
// fixed pixel amplitude is a hand holding a pen at every zoom.
//
// So points are projected to world pixels at the zoom we are generating
// for — camera-independent, unlike map.project(), which folds in pitch
// and bearing and would re-wobble the whole city every time you turned.
const TILE = 512;

function worldScale(z: number): number {
  return TILE * Math.pow(2, z);
}

function lngToX(lng: number, scale: number): number {
  return ((lng + 180) / 360) * scale;
}

function latToY(lat: number, scale: number): number {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale;
}

function xToLng(x: number, scale: number): number {
  return (x / scale) * 360 - 180;
}

function yToLat(y: number, scale: number): number {
  const n = Math.PI * (1 - (2 * y) / scale);
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

// ---------------------------------------------------------------------
// The field
// ---------------------------------------------------------------------

// Lattice hash → [-1, 1]. Integer mixing rather than a seeded PRNG walk,
// because the field is asked for points in no particular order and has
// to answer the same way every time regardless.
function latticeAt(ix: number, iy: number, seed: number, axis: number): number {
  let n = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(axis, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177) ^ seed;
  return (((n ^ (n >>> 16)) >>> 0) / 2147483648) - 1;
}

// Smoothstep-interpolated value noise. One octave is a slow bow; the
// quiet second octave is the small tremor on top. Same shape as
// HandDrawn's noiseFn, which carries a dominant wave plus a harmonic at
// ~0.14–0.28 weight, and for the same reason: one long drift reads as a
// hand, a ripple reads as a bad printer.
const HARMONIC = 0.22;

function fieldAt(
  x: number,
  y: number,
  cell: number,
  seed: number,
  axis: number,
): number {
  const u = x / cell;
  const v = y / cell;
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const fx = u - x0;
  const fy = v - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = latticeAt(x0, y0, seed, axis);
  const b = latticeAt(x0 + 1, y0, seed, axis);
  const c = latticeAt(x0, y0 + 1, seed, axis);
  const d = latticeAt(x0 + 1, y0 + 1, seed, axis);
  return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
}

// How far apart the field's waves are, in world px. At 90 a city block
// bows once across its face, which is the "drifts off and comes back,
// once, over the whole run" that HandDrawn's comments argue for.
const CELL = 90;

function displace(
  x: number,
  y: number,
  amp: number,
  seed: number,
): [number, number] {
  const dx =
    fieldAt(x, y, CELL, seed, 1) * (1 - HARMONIC) +
    fieldAt(x, y, CELL / 3.7, seed, 3) * HARMONIC;
  const dy =
    fieldAt(x, y, CELL, seed, 2) * (1 - HARMONIC) +
    fieldAt(x, y, CELL / 3.7, seed, 4) * HARMONIC;
  return [x + dx * amp, y + dy * amp];
}

// ---------------------------------------------------------------------
// Resampling
// ---------------------------------------------------------------------

// A 400px straight road with two endpoints cannot bow: displacing two
// points just moves the line. Long runs get intermediate points so the
// field has something to push. 14px is the same trade HandDrawn's
// STEP_PX makes — close enough that the curve is smooth, far enough that
// the result is not a tremor and the vertex count stays sane.
const STEP_PX = 14;

// The wobble, in world px, on a shape big enough to carry it. HandDrawn
// uses 1.1 on a card; the map takes more, because a card's edge is
// 300px of one clean run where 1.1px is plainly a hand, and a city is
// thousands of short edges where the same amount averages out into
// looking straight.
const AMP = 1.9;

// …and the same 1.9px is not the same amount on a 300px park and a
// 14px shed — flat, it made HandDrawn's small discs read as potatoes,
// and it does exactly that to a row of houses. Amplitude scales with the
// shape down to a floor, so small footprints stay square.
const AMP_FULL_AT_PX = 120;
const AMP_MIN_SCALE = 0.28;

function ampForSpan(span: number): number {
  const s = span / AMP_FULL_AT_PX;
  return AMP * Math.max(AMP_MIN_SCALE, Math.min(1, s));
}

type Pt = [number, number];

// Resample a ring/line at STEP_PX and push every point off the true
// line. Returns world-pixel points; the caller unprojects.
function sketchRun(pts: Pt[], amp: number, seed: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i]!;
    const [bx, by] = pts[i + 1]!;
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.round(len / STEP_PX));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      out.push(displace(ax + (bx - ax) * t, ay + (by - ay) * t, amp, seed));
    }
  }
  const last = pts[pts.length - 1]!;
  out.push(displace(last[0], last[1], amp, seed));
  return out;
}

function spanOf(pts: Pt[]): number {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return Math.hypot(maxX - minX, maxY - minY);
}

// ---------------------------------------------------------------------
// Feature → sketched GeoJSON
// ---------------------------------------------------------------------

interface Ctx {
  scale: number;
  seed: number;
  // Rings shorter than this in world px are left alone — below a few
  // pixels a wobble is noise, and there are thousands of them.
  minSpan: number;
  // Polygons scale their amplitude with their own size; lines hold a
  // constant one so the two halves of a tile-split road agree.
  sizeScaled: boolean;
}

function toWorldRing(coords: number[][], scale: number): Pt[] {
  const out: Pt[] = new Array(coords.length);
  for (let i = 0; i < coords.length; i++) {
    const c = coords[i]!;
    out[i] = [lngToX(c[0]!, scale), latToY(c[1]!, scale)];
  }
  return out;
}

function toLngLatRing(pts: Pt[], scale: number): number[][] {
  const out: number[][] = new Array(pts.length);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    out[i] = [xToLng(p[0], scale), yToLat(p[1], scale)];
  }
  return out;
}

function sketchRing(coords: number[][], ctx: Ctx): number[][] | null {
  if (coords.length < 2) return null;
  const world = toWorldRing(coords, ctx.scale);
  const span = spanOf(world);
  if (span < ctx.minSpan) return null;
  const amp = ctx.sizeScaled ? ampForSpan(span) : AMP;
  return toLngLatRing(sketchRun(world, amp, ctx.seed), ctx.scale);
}

function sketchFeature(
  f: GeoJSONFeature,
  ctx: Ctx,
): GeoJSON.Feature | null {
  const g = f.geometry;
  if (g.type === 'LineString') {
    const r = sketchRing(g.coordinates as number[][], ctx);
    return r && { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r } };
  }
  if (g.type === 'MultiLineString') {
    const lines = (g.coordinates as number[][][])
      .map((l) => sketchRing(l, ctx))
      .filter((l): l is number[][] => l != null);
    return lines.length
      ? { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines } }
      : null;
  }
  if (g.type === 'Polygon') {
    const rings = (g.coordinates as number[][][])
      .map((r) => sketchRing(r, ctx))
      .filter((r): r is number[][] => r != null);
    // An outer ring that fell under minSpan takes its holes with it.
    return rings.length
      ? { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: rings } }
      : null;
  }
  if (g.type === 'MultiPolygon') {
    const polys = (g.coordinates as number[][][][])
      .map((p) => p.map((r) => sketchRing(r, ctx)).filter((r): r is number[][] => r != null))
      .filter((p) => p.length > 0);
    return polys.length
      ? { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: polys } }
      : null;
  }
  return null;
}

// ---------------------------------------------------------------------
// Which features
// ---------------------------------------------------------------------

// Mirrors the hide rules in crayonStyle's transportation branch — rail,
// service roads and footpaths are off the drawing there, and drawing
// them by hand here would put them back.
const ROAD_SKIP =
  /(^|[_-])(rail|railway|aerialway|cable|gondola|chair|funicular|ferry|transit|tram|monorail|subway|pier|service|track|construction|raceway|path|footway|pedestrian|cycleway|steps|bridleway)([_-]|$)/;

const GREEN_CLASS =
  /park|grass|wood|forest|cemetery|recreation|pitch|meadow|farm|garden|scrub|playground|nature/;

function classOf(f: GeoJSONFeature): string {
  const p = f.properties ?? {};
  return String(p.class ?? p.subclass ?? '').toLowerCase();
}

// ---------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------

function ensureSource(map: maplibregl.Map, id: string) {
  if (!map.getSource(id)) {
    map.addSource(id, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }
}

function setData(map: maplibregl.Map, id: string, features: GeoJSON.Feature[]) {
  const src = map.getSource(id) as GeoJSONSource | undefined;
  src?.setData({ type: 'FeatureCollection', features });
}

function ensureLayer(map: maplibregl.Map, spec: LayerSpecification, before?: string) {
  if (map.getLayer(spec.id)) return;
  try {
    map.addLayer(spec, before && map.getLayer(before) ? before : undefined);
  } catch {
    /* the style is mid-update; the next refresh puts it in */
  }
}

// Paint that follows a palette change without rebuilding geometry.
function paintSketch(map: maplibregl.Map, p: Palette) {
  const ink = p.outline ?? p.crayon;
  const set = (id: string, prop: string, v: unknown) => {
    if (!map.getLayer(id)) return;
    try {
      (map.setPaintProperty as (l: string, k: string, v: unknown) => void)(id, prop, v);
    } catch {
      /* ignore */
    }
  };
  set('sketch-water-fill', 'fill-color', p.blue);
  set('sketch-park-fill', 'fill-color', p.green);
  set('sketch-building-fill', 'fill-color', p.paper);
  for (const id of ['sketch-water-line', 'sketch-park-line', 'sketch-building-line']) {
    set(id, 'line-color', ink);
  }
  set('sketch-road-line', 'line-color', p.greyRoad);
  set('sketch-water-line', 'line-opacity', p.outlineOpacity || 0.85);
  set('sketch-park-line', 'line-opacity', p.outlineOpacity || 0.85);
  set('sketch-building-line', 'line-opacity', p.buildingOutline || 0.55);
}

const SKETCH_LAYERS = [
  'sketch-water-fill', 'sketch-park-fill', 'sketch-water-line', 'sketch-park-line',
  'sketch-building-fill', 'sketch-building-line', 'sketch-road-line',
] as const;

// Show or hide the whole hand-drawn city in one call. Hidden rather than
// disposed on a palette that does not want it (play mode), because the
// geometry took real work to build and the mode is a toggle: throwing it
// away means paying for it again on the way back.
export function setSketchVisible(map: maplibregl.Map, visible: boolean): void {
  for (const id of SKETCH_LAYERS) {
    if (!map.getLayer(id)) continue;
    try {
      map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    } catch {
      /* style mid-update */
    }
  }
}

export interface MapSketch {
  // Rebuild from whatever the source currently holds. Cheap to call —
  // it no-ops unless the zoom bucket moved or a tile arrived.
  refresh(force?: boolean): void;
  restyle(palette: Palette): void;
  // What the last build cost. Read by the render probes so a claim about
  // this being affordable is a measurement rather than a hope.
  stats(): { features: number; ms: number; zoomBucket: number };
  dispose(): void;
}

// Buildings are the expensive half (699 features / 51k vertices in one
// city viewport, measured) and the least legible when tiny. Below this
// many world px across, a footprint is a smudge either way.
const MIN_BUILDING_SPAN = 10;
const MIN_LINE_SPAN = 8;
// Water takes anything — a pond is a landmark on a walk. Green does
// not: `landcover` carries a grass polygon for every verge and traffic
// island in the city, and drawn at this weight they stipple the whole
// page with slivers that are not places anybody walks a dog.
const MIN_WATER_SPAN = 6;
const MIN_GREEN_SPAN = 22;

export function createMapSketch(
  map: maplibregl.Map,
  palette: Palette,
  vectorSource: string,
): MapSketch {
  for (const id of Object.values(SRC)) ensureSource(map, id);

  // Order: water and park under the buildings under the roads, and the
  // whole stack under the first label so street names stay on top.
  const firstSymbol = map
    .getStyle()
    .layers?.find((l) => l.type === 'symbol')?.id;

  const ink = palette.outline ?? palette.crayon;
  ensureLayer(map, {
    id: 'sketch-water-fill', type: 'fill', source: SRC.water,
    paint: { 'fill-color': palette.blue, 'fill-opacity': 1 },
  } as LayerSpecification, firstSymbol);
  ensureLayer(map, {
    id: 'sketch-park-fill', type: 'fill', source: SRC.park,
    paint: { 'fill-color': palette.green, 'fill-opacity': 1 },
  } as LayerSpecification, firstSymbol);
  ensureLayer(map, {
    id: 'sketch-water-line', type: 'line', source: SRC.water,
    paint: {
      'line-color': ink,
      'line-opacity': palette.outlineOpacity || 0.85,
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.7, 14, 1.2, 18, 2.1],
    },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  } as LayerSpecification, firstSymbol);
  ensureLayer(map, {
    id: 'sketch-park-line', type: 'line', source: SRC.park,
    paint: {
      'line-color': ink,
      'line-opacity': palette.outlineOpacity || 0.85,
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.7, 14, 1.2, 18, 2.1],
    },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  } as LayerSpecification, firstSymbol);
  ensureLayer(map, {
    id: 'sketch-building-fill', type: 'fill', source: SRC.building,
    paint: { 'fill-color': palette.paper, 'fill-opacity': 1 },
  } as LayerSpecification, firstSymbol);
  ensureLayer(map, {
    id: 'sketch-building-line', type: 'line', source: SRC.building,
    minzoom: 13,
    paint: {
      'line-color': ink,
      'line-opacity': palette.buildingOutline || 0.55,
      'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.4, 16, 0.9, 19, 1.4],
    },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  } as LayerSpecification, firstSymbol);
  ensureLayer(map, {
    id: 'sketch-road-line', type: 'line', source: SRC.road,
    paint: {
      'line-color': palette.greyRoad,
      'line-opacity': 1,
      // The tile style's per-class widths are gone with its layers, so
      // the hierarchy is rebuilt from the feature's own class: a
      // motorway is not a lane.
      // Streets lead the drawing, as they do on the styled paper map —
      // the first ramp here was carried over from the tile style's own
      // weights and came out finer than the building footprints, which
      // is the same mistake in a new place: a page of blocks with no
      // network through it.
      'line-width': [
        'interpolate', ['linear'], ['zoom'],
        12, ['match', ['get', 'k'], 3, 2.2, 2, 1.5, 1, 1.0, 0.7],
        16, ['match', ['get', 'k'], 3, 5.0, 2, 3.4, 1, 2.4, 1.6],
        19, ['match', ['get', 'k'], 3, 9.0, 2, 6.2, 1, 4.2, 2.8],
      ],
    },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  } as LayerSpecification, firstSymbol);

  // One seed for the whole city, so the field is continuous across every
  // feature and every tile. Fixed rather than random: a reload should
  // not redraw Kyiv.
  const seed = 0x5ce7c4;
  let lastBucket = -1;
  let lastCount = 0;
  let lastMs = 0;
  let disposed = false;

  // Redrawing the city is not free and it runs on a user-visible thread.
  // Anything past this is a hitch somebody can feel while panning, and a
  // silent one — so it says so. Threshold rather than always-on: a log
  // line per tile batch is its own kind of noise.
  const SLOW_MS = 120;

  const build = (z: number) => {
    const t0 = performance.now();
    const scale = worldScale(z);
    const q = (sourceLayer: string) => {
      try {
        return map.querySourceFeatures(vectorSource, { sourceLayer });
      } catch {
        return [] as GeoJSONFeature[];
      }
    };

    const roads: GeoJSON.Feature[] = [];
    for (const f of q('transportation')) {
      const cls = classOf(f);
      if (ROAD_SKIP.test(cls)) continue;
      const s = sketchFeature(f, { scale, seed, minSpan: MIN_LINE_SPAN, sizeScaled: false });
      if (!s) continue;
      // Road weight tier, read once here so the style expression above
      // stays a lookup rather than a chain of string comparisons.
      const k = /motorway|trunk/.test(cls) ? 3
        : /primary/.test(cls) ? 2
        : /secondary|tertiary/.test(cls) ? 1
        : 0;
      s.properties = { k };
      roads.push(s);
    }

    const buildings: GeoJSON.Feature[] = [];
    for (const f of q('building')) {
      const s = sketchFeature(f, { scale, seed, minSpan: MIN_BUILDING_SPAN, sizeScaled: true });
      if (s) buildings.push(s);
    }

    const water: GeoJSON.Feature[] = [];
    for (const f of q('water')) {
      const s = sketchFeature(f, { scale, seed, minSpan: MIN_WATER_SPAN, sizeScaled: true });
      if (s) water.push(s);
    }

    const parks: GeoJSON.Feature[] = [];
    const pushGreen = (f: GeoJSONFeature) => {
      const s = sketchFeature(f, { scale, seed, minSpan: MIN_GREEN_SPAN, sizeScaled: true });
      if (s) parks.push(s);
    };
    for (const f of q('park')) pushGreen(f);
    for (const sl of ['landuse', 'landcover'] as const) {
      for (const f of q(sl)) {
        if (GREEN_CLASS.test(classOf(f))) pushGreen(f);
      }
    }

    setData(map, SRC.road, roads);
    setData(map, SRC.building, buildings);
    setData(map, SRC.water, water);
    setData(map, SRC.park, parks);
    lastCount = roads.length + buildings.length + water.length + parks.length;
    const ms = performance.now() - t0;
    lastMs = ms;
    if (ms > SLOW_MS) {
      // eslint-disable-next-line no-console
      console.warn(
        `[sketch] redrew ${lastCount} features in ${ms.toFixed(0)}ms at z${z.toFixed(1)}`,
      );
    }
  };

  return {
    refresh(force = false) {
      if (disposed) return;
      // Geometry is generated for one zoom, because the wobble is a
      // pixel amount and a pixel is a different distance at every zoom.
      // Rebuilding on the integer bucket means the wobble breathes a
      // little between whole zooms and is never more than ~40% off.
      const bucket = Math.round(map.getZoom());
      // An empty city is never a finished build. The first run happens
      // before any tile has arrived and legitimately produces nothing;
      // without this it would also SET the bucket and lock the sketch
      // blank until the user changed zoom.
      if (!force && bucket === lastBucket && lastCount > 0) return;
      lastBucket = bucket;
      build(map.getZoom());
    },
    restyle(next: Palette) {
      paintSketch(map, next);
    },
    stats() {
      return { features: lastCount, ms: lastMs, zoomBucket: lastBucket };
    },
    dispose() {
      disposed = true;
      for (const id of SKETCH_LAYERS) {
        try { if (map.getLayer(id)) map.removeLayer(id); } catch { /* ignore */ }
      }
      for (const id of Object.values(SRC)) {
        try { if (map.getSource(id)) map.removeSource(id); } catch { /* ignore */ }
      }
    },
  };
}
