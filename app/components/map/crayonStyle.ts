// Shared MapLibre crayon style override. Both `/preview` and the
// production map import from here.
//
// Direction:
//   - Palette: BLACK / WHITE / GREEN / BLUE (+ greys for roads), or
//     dark mirrors for sniff mode.
//   - Roads: light-grey crayon-textured strokes with offset wobble
//     clones (lighter + darker shade).
//   - Buildings: 3D walls + thin dark crayon outline traced from above.
//   - Park + water FILLS get layered-noise grain (natural crayon
//     coverage, no motifs).
//   - Polygon corners SOFTENED via thick same-colour line + line-blur
//     so the rounded edge fades into the bg rather than reading as a
//     visible border.
//   - Labels via tiered system in installLabelOverride.

import type maplibregl from 'maplibre-gl';
import type { LayerSpecification } from 'maplibre-gl';

// ---------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------

// Palette tuned to the in-app pixel-art home screen: pastel grass green,
// pale sky blue, soft cards. Keeps crayon dark for legibility but the
// nature fills move from "vivid sticker" to "pastel storybook".
export const LIGHT_PALETTE = {
  paper: '#ffffff',
  crayon: '#2a2a2a',
  greyRoad: '#d4d4d4',
  green: '#9fcc6e',
  greenDark: '#6ea846',
  greenLight: '#d9ecbb',
  blue: '#88c5e4',
  blueDark: '#5aa2c8',
  blueLight: '#cae6f3',
  // Road wobble clone colours — kept close to greyRoad so the offset
  // copies read as a subtle "double line" texture instead of as a
  // stack of dark cables crossing the city.
  roadWobbleLight: '#e8e8e8',
  roadWobbleDark: '#bcbcbc',
  // Tinted speckles for the paper-tooth multiply overlay — warmer +
  // less saturated to match the soft pastel feel.
  paperSpeckleA: '#b4a578',
  paperSpeckleB: '#d6caa6',
  // Label tier colours.
  labelText: '#2a2a2a',
  labelHalo: '#ffffff',
  labelWater: '#3a7da0',
  labelStreet: '#3a3a3a',
  // Multiply overlay opacity (lightens darken effect).
  paperOpacity: 0.48,
};

export const DARK_PALETTE = {
  paper: '#1a1a1a',
  crayon: '#e0e0e0',
  greyRoad: '#a8a8a8',
  green: '#4a8c30',
  greenDark: '#2a5e1a',
  greenLight: '#1f4a14',
  blue: '#1f7099',
  blueDark: '#0c4e6f',
  blueLight: '#356b87',
  // Road wobble clones — light/dark relative to greyRoad on dark bg.
  roadWobbleLight: '#d0d0d0',
  roadWobbleDark: '#646464',
  // No paper-tooth multiply on dark (would just darken the already-
  // dark canvas). Use 'screen' blend in installPaperOverlay instead.
  paperSpeckleA: '#2c2c2c',
  paperSpeckleB: '#4a4a4a',
  labelText: '#e8e8e8',
  labelHalo: '#0a0a0a',
  labelWater: '#5cb5e5',
  labelStreet: '#c8c8c8',
  // Lower opacity on dark — the multiply/screen overlay is subtler.
  paperOpacity: 0.35,
};

export type Palette = typeof LIGHT_PALETTE;

const ROAD_WIDTH_SCALE = 0.22;

// ---------------------------------------------------------------------
// Canvas pattern generators
// ---------------------------------------------------------------------

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function ctxFor(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, ctx: c.getContext('2d')! };
}

function noiseFill(opts: {
  size: number;
  base: string;
  darker: string;
  lighter: string;
  seed: number;
  blobs: number;
  blobAlpha: number;
  blobRadius: [number, number];
  dots: number;
  dotAlpha: [number, number];
  dotSize: [number, number];
  speckles: number;
  speckleAlpha: [number, number];
}): ImageData {
  const {
    size,
    base,
    darker,
    lighter,
    seed,
    blobs,
    blobAlpha,
    blobRadius,
    dots,
    dotAlpha,
    dotSize,
    speckles,
    speckleAlpha,
  } = opts;
  const { c, ctx } = ctxFor(size, size);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const r = rng(seed);
  for (let i = 0; i < blobs; i++) {
    ctx.fillStyle = r() > 0.5 ? darker : lighter;
    ctx.globalAlpha = blobAlpha * (0.5 + r() * 1.0);
    const x = r() * size;
    const y = r() * size;
    const radius = blobRadius[0] + r() * (blobRadius[1] - blobRadius[0]);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < dots; i++) {
    ctx.fillStyle = r() > 0.55 ? darker : lighter;
    ctx.globalAlpha = dotAlpha[0] + r() * (dotAlpha[1] - dotAlpha[0]);
    const x = r() * size;
    const y = r() * size;
    const s = dotSize[0] + r() * (dotSize[1] - dotSize[0]);
    ctx.fillRect(x, y, s, s);
  }
  for (let i = 0; i < speckles; i++) {
    ctx.fillStyle = r() > 0.6 ? darker : lighter;
    ctx.globalAlpha =
      speckleAlpha[0] + r() * (speckleAlpha[1] - speckleAlpha[0]);
    const x = Math.floor(r() * size);
    const y = Math.floor(r() * size);
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.globalAlpha = 1;
  return ctx.getImageData(0, 0, size, size);
}

function parkPattern(p: Palette): ImageData {
  return noiseFill({
    size: 256,
    base: p.green,
    darker: p.greenDark,
    lighter: p.greenLight,
    seed: 7,
    blobs: 18,
    blobAlpha: 0.1,
    blobRadius: [25, 80],
    dots: 950,
    dotAlpha: [0.16, 0.45],
    dotSize: [0.5, 1.9],
    speckles: 2400,
    speckleAlpha: [0.06, 0.22],
  });
}

function waterPattern(p: Palette): ImageData {
  return noiseFill({
    size: 256,
    base: p.blue,
    darker: p.blueDark,
    lighter: p.blueLight,
    seed: 13,
    blobs: 22,
    blobAlpha: 0.11,
    blobRadius: [25, 80],
    dots: 950,
    dotAlpha: [0.16, 0.42],
    dotSize: [0.5, 1.9],
    speckles: 2400,
    speckleAlpha: [0.06, 0.22],
  });
}

function roadPattern(p: Palette): ImageData {
  const w = 128;
  const h = 16;
  const { c, ctx } = ctxFor(w, h);
  ctx.fillStyle = p.greyRoad;
  ctx.fillRect(0, 0, w, h);
  const r = rng(23);
  for (let i = 0; i < 110; i++) {
    ctx.fillStyle = p.paper;
    ctx.globalAlpha = 0.32 + r() * 0.4;
    const x = r() * w;
    const y = r() * h;
    const s = 0.4 + r() * 1.0;
    ctx.fillRect(x, y, s, s);
  }
  // Keep some darker grain but never near-black — roads should read
  // as a light pencil hatch, not as a stack of dark cables.
  for (let i = 0; i < 160; i++) {
    ctx.fillStyle = r() > 0.5 ? '#b8b8b8' : '#9a9a9a';
    ctx.globalAlpha = 0.06 + r() * 0.14;
    const x = Math.floor(r() * w);
    const y = Math.floor(r() * h);
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.globalAlpha = 1;
  return ctx.getImageData(0, 0, w, h);
}

export function generatePaperTextureUrl(palette: Palette): string {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = palette.paper;
  ctx.fillRect(0, 0, size, size);
  const r = rng(99);
  for (let i = 0; i < 11000; i++) {
    ctx.globalAlpha = 0.05 + r() * 0.22;
    ctx.fillStyle =
      r() > 0.6 ? palette.paperSpeckleA : palette.paperSpeckleB;
    const x = Math.floor(r() * size);
    const y = Math.floor(r() * size);
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.globalAlpha = 1;
  return c.toDataURL('image/png');
}

// ---------------------------------------------------------------------
// MapLibre helpers
// ---------------------------------------------------------------------

function addImg(
  map: maplibregl.Map,
  id: string,
  img: ImageData,
  pixelRatio = 1,
) {
  if (map.hasImage(id)) map.removeImage(id);
  map.addImage(id, img, { pixelRatio });
}

function clear(map: maplibregl.Map, id: string, prop: string) {
  try {
    (map.setPaintProperty as (l: string, p: string, v: unknown) => void)(
      id,
      prop,
      undefined,
    );
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------
// Style override entry point. Idempotent — safe to call again on sniff
// toggle with a different palette. Re-styles existing liberty layers
// and injects our own (polygon softening outlines, road wobble clones,
// building outlines).
// ---------------------------------------------------------------------

export function applyCrayonOverride(
  map: maplibregl.Map,
  palette: Palette,
): void {
  addImg(map, 'crayon-park', parkPattern(palette), 1);
  addImg(map, 'crayon-water', waterPattern(palette), 1);
  addImg(map, 'crayon-road', roadPattern(palette), 1);

  const layers = map.getStyle().layers ?? [];
  const buildingLayer = layers.find(
    (l) => (l as { 'source-layer'?: string })['source-layer'] === 'building',
  );
  const buildingSource = (buildingLayer as { source?: string } | undefined)
    ?.source;

  type PolygonInfo = {
    baseId: string;
    source: string;
    sourceLayer: string;
    filter: unknown;
    color: string;
  };
  const polygonsToSoften: PolygonInfo[] = [];

  for (const l of layers) {
    const id = l.id;
    const sl = (l as { 'source-layer'?: string })['source-layer'];
    const type = l.type;
    const lower = id.toLowerCase();

    if (id.startsWith('soften-') || id.startsWith('wobble-') || id.startsWith('crayon-')) {
      // Layers we've injected previously — re-style updates them via
      // setPaintProperty in the appropriate branch below if needed.
      continue;
    }

    if (type === 'background') {
      clear(map, id, 'background-pattern');
      map.setPaintProperty(id, 'background-color', palette.paper);
      continue;
    }

    if (sl === 'water') {
      if (type === 'fill') {
        clear(map, id, 'fill-color');
        map.setPaintProperty(id, 'fill-pattern', 'crayon-water');
        map.setPaintProperty(id, 'fill-opacity', 1);
        const src = (l as { source?: string }).source;
        const filt = (l as { filter?: unknown }).filter;
        if (src)
          polygonsToSoften.push({
            baseId: id,
            source: src,
            sourceLayer: 'water',
            filter: filt,
            color: palette.blue,
          });
        continue;
      }
      map.setLayoutProperty(id, 'visibility', 'none');
      continue;
    }

    if (sl === 'building') {
      if (type === 'fill') {
        clear(map, id, 'fill-pattern');
        map.setPaintProperty(id, 'fill-color', palette.paper);
        map.setPaintProperty(id, 'fill-opacity', 1);
      } else if (type === 'fill-extrusion') {
        clear(map, id, 'fill-extrusion-pattern');
        map.setPaintProperty(id, 'fill-extrusion-color', palette.paper);
        map.setPaintProperty(id, 'fill-extrusion-opacity', 0.7);
      }
      continue;
    }

    const isLanduseFill =
      (sl === 'landuse' || sl === 'landcover') && type === 'fill';
    const isParkLayer = sl === 'park' && type === 'fill';
    if (isLanduseFill || isParkLayer) {
      const isGreen =
        isParkLayer ||
        /park|grass|wood|forest|cemetery|recreation|pitch|meadow|farm|garden|scrub|playground|nature/.test(
          lower,
        );
      if (isGreen) {
        clear(map, id, 'fill-color');
        map.setPaintProperty(id, 'fill-pattern', 'crayon-park');
        map.setPaintProperty(id, 'fill-opacity', 1);
        const src = (l as { source?: string }).source;
        const filt = (l as { filter?: unknown }).filter;
        if (src && sl)
          polygonsToSoften.push({
            baseId: id,
            source: src,
            sourceLayer: sl,
            filter: filt,
            color: palette.green,
          });
      } else {
        map.setLayoutProperty(id, 'visibility', 'none');
      }
      continue;
    }

    if (sl === 'transportation' && type === 'line') {
      const isCasing =
        lower.includes('casing') ||
        lower.endsWith('-bg') ||
        lower.endsWith('_bg') ||
        lower.includes('outline');
      if (isCasing) {
        map.setLayoutProperty(id, 'visibility', 'none');
        continue;
      }
      // Non-road transportation classes — rail, aerialway, ferry,
      // transit, tram, etc. — also live under the `transportation`
      // source-layer. If we apply the road pattern to them they read
      // as wide ghostly diagonals crossing the city. Hide them.
      const isNonRoad =
        /(^|[_-])(rail|railway|aerialway|cable|gondola|chair|funicular|ferry|transit|tram|monorail|subway|pier)([_-]|$)/.test(
          lower,
        );
      if (isNonRoad) {
        map.setLayoutProperty(id, 'visibility', 'none');
        continue;
      }
      // Service / construction / track / raceway — driveways, alleys,
      // dead-end utility roads. Pure noise at any zoom; hide.
      const isAlwaysHidden =
        /(^|[_-])(service|track|construction|raceway)([_-]|$)/.test(lower);
      if (isAlwaysHidden) {
        map.setLayoutProperty(id, 'visibility', 'none');
        continue;
      }
      // Path / footway / pedestrian / cycleway / steps / bridleway —
      // these are the classes that draw sidewalk doubles along
      // Хрещатик AND the actual paths through Маріїнський park. We
      // can't tell them apart from tags alone, so zoom-gate: only
      // render at zoom >= 16, where the user is plainly looking at
      // one place and a path is detail, not city-overview clutter.
      const isPathish =
        /(^|[_-])(path|footway|pedestrian|cycleway|steps|bridleway)([_-]|$)/.test(
          lower,
        );
      if (isPathish) {
        try {
          (
            map as unknown as {
              setLayerZoomRange: (id: string, min: number, max: number) => void;
            }
          ).setLayerZoomRange(id, 16, 24);
        } catch {
          /* skip */
        }
        // Continue through so the path still gets the crayon-road
        // pattern at the zooms it does appear at.
      }
      clear(map, id, 'line-color');
      clear(map, id, 'line-dasharray');
      map.setPaintProperty(id, 'line-pattern', 'crayon-road');
      map.setPaintProperty(id, 'line-opacity', 1);
      const curW = map.getPaintProperty(id, 'line-width');
      const newW: unknown = ['max', 0.4, ['*', ROAD_WIDTH_SCALE, curW ?? 1]];
      try {
        (
          map.setPaintProperty as (l: string, p: string, v: unknown) => void
        )(id, 'line-width', newW);
      } catch {
        if (typeof curW === 'number') {
          map.setPaintProperty(id, 'line-width', curW * ROAD_WIDTH_SCALE);
        }
      }
      try {
        map.setLayoutProperty(id, 'line-cap', 'round');
        map.setLayoutProperty(id, 'line-join', 'round');
      } catch {
        /* not all line layers accept these layout props */
      }
      continue;
    }

    // LABEL TIERS.
    if (sl === 'place' && type === 'symbol') {
      try {
        map.setLayoutProperty(id, 'text-font', ['Caveat Regular']);
        map.setPaintProperty(id, 'text-color', palette.labelText);
        map.setPaintProperty(id, 'text-halo-color', palette.labelHalo);
        map.setPaintProperty(id, 'text-halo-width', 2);
        map.setPaintProperty(id, 'text-halo-blur', 0.5);
        map.setLayoutProperty(id, 'text-letter-spacing', 0.08);
      } catch {
        /* skip */
      }
      continue;
    }
    if (sl === 'water_name' && type === 'symbol') {
      try {
        map.setLayoutProperty(id, 'text-font', ['Caveat Regular']);
        map.setPaintProperty(id, 'text-color', palette.labelWater);
        map.setPaintProperty(id, 'text-halo-color', palette.labelHalo);
        map.setPaintProperty(id, 'text-halo-width', 2);
        map.setLayoutProperty(id, 'text-letter-spacing', 0.08);
      } catch {
        /* skip */
      }
      continue;
    }
    if (sl === 'transportation_name' && type === 'symbol') {
      try {
        map.setLayoutProperty(id, 'visibility', 'visible');
        (
          map as unknown as {
            setLayerZoomRange: (id: string, min: number, max: number) => void;
          }
        ).setLayerZoomRange(id, 15, 24);
        map.setLayoutProperty(id, 'text-font', ['Caveat Regular']);
        map.setPaintProperty(id, 'text-color', palette.labelStreet);
        map.setPaintProperty(id, 'text-halo-color', palette.labelHalo);
        map.setPaintProperty(id, 'text-halo-width', 1.8);
        map.setLayoutProperty(id, 'text-letter-spacing', 0.05);
      } catch {
        /* skip */
      }
      continue;
    }

    map.setLayoutProperty(id, 'visibility', 'none');
  }

  // Soft polygon halos.
  for (const p of polygonsToSoften) {
    const softId = `soften-${p.baseId}`;
    if (map.getLayer(softId)) {
      map.setPaintProperty(softId, 'line-color', p.color);
      continue;
    }
    try {
      map.addLayer({
        id: softId,
        type: 'line',
        source: p.source,
        'source-layer': p.sourceLayer,
        ...(p.filter !== undefined ? { filter: p.filter } : {}),
        paint: {
          'line-color': p.color,
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            10, 0.6,
            14, 1.6,
            18, 3.5,
          ],
          'line-blur': [
            'interpolate', ['linear'], ['zoom'],
            10, 1.5,
            14, 4,
            18, 9,
          ],
          'line-opacity': 0.9,
        },
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
      } as LayerSpecification);
    } catch {
      /* skip silently */
    }
  }

  // Road wobble clones — light + dark grey offset shadows of each
  // transportation line. Skip layers we just hid (rail, paths, etc.)
  // so we don't draw wobble shadows under invisible features.
  const roadIds: string[] = [];
  for (const l of map.getStyle().layers ?? []) {
    const sl = (l as { 'source-layer'?: string })['source-layer'];
    if (
      l.type === 'line' &&
      sl === 'transportation' &&
      !l.id.startsWith('wobble-') &&
      (l.layout?.visibility ?? 'visible') !== 'none'
    ) {
      roadIds.push(l.id);
    }
  }
  for (const baseId of roadIds) {
    const base = map.getLayer(baseId) as
      | (LayerSpecification & {
          source?: string;
          'source-layer'?: string;
          filter?: unknown;
          minzoom?: number;
          maxzoom?: number;
        })
      | undefined;
    if (!base || !base.source || !base['source-layer']) continue;
    const lineWidth = map.getPaintProperty(baseId, 'line-width');
    // Single subtle wobble companion at +1.5 px — just enough to
    // hint at a doubled crayon stroke, not enough to read as a
    // separate cable. Two clones at ±5 with blur 2 stacked into the
    // "wires across the city" effect.
    const variants: Array<{ suffix: string; offset: number; color: string }> = [
      { suffix: 'lo', offset: 1.5, color: palette.roadWobbleLight },
    ];
    for (const v of variants) {
      const id = `wobble-${baseId}-${v.suffix}`;
      if (map.getLayer(id)) {
        map.setPaintProperty(id, 'line-color', v.color);
        continue;
      }
      try {
        map.addLayer(
          {
            id,
            type: 'line',
            source: base.source,
            'source-layer': base['source-layer'],
            ...(base.filter !== undefined ? { filter: base.filter } : {}),
            ...(base.minzoom !== undefined ? { minzoom: base.minzoom } : {}),
            ...(base.maxzoom !== undefined ? { maxzoom: base.maxzoom } : {}),
            paint: {
              'line-color': v.color,
              'line-width': lineWidth,
              'line-offset': v.offset,
              'line-opacity': 0.7,
              'line-blur': 0.8,
            },
            layout: {
              'line-cap': 'round',
              'line-join': 'round',
            },
          } as LayerSpecification,
          baseId,
        );
      } catch {
        /* skip */
      }
    }
  }

  // Dark building outline.
  if (buildingSource && !map.getLayer('crayon-building-outline')) {
    const outlineLayer: LayerSpecification = {
      id: 'crayon-building-outline',
      type: 'line',
      source: buildingSource,
      'source-layer': 'building',
      minzoom: 13,
      paint: {
        'line-color': palette.crayon,
        'line-opacity': 0.55,
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          13, 0.4,
          16, 0.9,
          19, 1.4,
        ],
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    } as LayerSpecification;
    map.addLayer(outlineLayer);
  } else if (buildingSource && map.getLayer('crayon-building-outline')) {
    map.setPaintProperty('crayon-building-outline', 'line-color', palette.crayon);
  }
}

// ---------------------------------------------------------------------
// Style fetcher — fetch liberty's style.json, swap its glyphs URL to
// our locally-hosted Caveat PBFs, hand the mutated style to MapLibre.
// Returns the style ready to pass to `new maplibregl.Map({ style })`.
// ---------------------------------------------------------------------

export async function fetchCrayonStyleSpec(): Promise<unknown> {
  const resp = await fetch('https://tiles.openfreemap.org/styles/liberty');
  const style = (await resp.json()) as Record<string, unknown>;
  style.glyphs = `${window.location.origin}/fonts/{fontstack}/{range}.pbf`;
  return style;
}

// ---------------------------------------------------------------------
// Paper-tooth overlay sync — anchors a CSS overlay's background-position
// to a fixed lat/lng so the texture travels with the geography on pan
// (not "dirty glass" effect).
// ---------------------------------------------------------------------

export interface OverlayRef {
  current: HTMLDivElement | null;
}

export function installPaperOverlaySync(
  map: maplibregl.Map,
  overlayRef: OverlayRef,
  anchorLng: number,
  anchorLat: number,
): () => void {
  const anchor = { lng: anchorLng, lat: anchorLat };
  const initialPx = map.project(anchor);
  const sync = () => {
    const el = overlayRef.current;
    if (!el) return;
    const px = map.project(anchor);
    el.style.backgroundPosition = `${px.x - initialPx.x}px ${px.y - initialPx.y}px`;
  };
  map.on('move', sync);
  sync();
  return () => {
    map.off('move', sync);
  };
}
