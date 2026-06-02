// Phase 2 PREVIEW. Pure "judge call" screen — not a feature.
// Production `/` map stays 100% Google.
//
// Direction:
//   - Palette: BLACK / WHITE / GREEN / BLUE (+ greys for roads).
//   - Roads: light-grey crayon-textured strokes, solid opacity 1.0.
//     Earlier opacity-based "pencil" + wobble approach was dropped
//     because translucent lines stacked at intersections into ink-
//     puddle darkness. The grey colour in the pattern itself gives
//     the pencil/crayon read without alpha stacking.
//   - Buildings: 3D B&W (paper walls + dark crayon outline on top).
//   - Park + water FILLS get layered-noise grain (natural crayon
//     coverage, no motifs).
//   - Polygon corners SOFTENED: each park / water polygon gets a
//     thick same-colour line drawn around it with round caps + joins.
//     MapLibre has no native rounded-fill, so the thick stroke covers
//     the polygon's sharp edges and arcs every corner — the shape
//     appears as a rounded crayon blob.

import { useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, Text, Pressable } from 'react-native';
import { router } from 'expo-router';
import maplibregl, { type LayerSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const KYIV_CENTER: [number, number] = [30.5234, 50.4501]; // [lng, lat]

const PAPER = '#ffffff';
const CRAYON = '#1a1a1a';
const GREY_ROAD = '#6a6a6a';
const GREEN = '#65b246';
const GREEN_DARK = '#3a7e2a';
const GREEN_LIGHT = '#d8eccb';
const BLUE = '#2f99d8';
const BLUE_DARK = '#1a679a';
const BLUE_LIGHT = '#a7ddf3';

// Liberty's per-class line-width preserved; halved further (was 0.5
// then 0.22). Keeps motorway around 3px / residential around 0.6px.
const ROAD_WIDTH_SCALE = 0.22;

// ---------------------------------------------------------------------
// Canvas pattern generators — layered noise, no motifs.
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
  blobs?: number;
  blobAlpha?: number;
  blobRadius?: [number, number];
  dots?: number;
  dotAlpha?: [number, number];
  dotSize?: [number, number];
  speckles?: number;
  speckleAlpha?: [number, number];
}): ImageData {
  const {
    size,
    base,
    darker,
    lighter,
    seed,
    blobs = 14,
    blobAlpha = 0.06,
    blobRadius = [25, 80],
    dots = 600,
    dotAlpha = [0.1, 0.32],
    dotSize = [0.5, 1.6],
    speckles = 1800,
    speckleAlpha = [0.03, 0.12],
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
    ctx.globalAlpha = speckleAlpha[0] + r() * (speckleAlpha[1] - speckleAlpha[0]);
    const x = Math.floor(r() * size);
    const y = Math.floor(r() * size);
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.globalAlpha = 1;
  return ctx.getImageData(0, 0, size, size);
}

function parkPattern(): ImageData {
  return noiseFill({
    size: 256,
    base: GREEN,
    darker: GREEN_DARK,
    lighter: GREEN_LIGHT,
    seed: 7,
    // Boosted crayon grain — higher contrast + more density across
    // all three layers so the texture obviously reads as hand-coloured.
    blobs: 18,
    blobAlpha: 0.1,
    dots: 950,
    dotAlpha: [0.16, 0.45],
    dotSize: [0.5, 1.9],
    speckles: 2400,
    speckleAlpha: [0.06, 0.22],
  });
}

function waterPattern(): ImageData {
  return noiseFill({
    size: 256,
    base: BLUE,
    darker: BLUE_DARK,
    lighter: BLUE_LIGHT,
    seed: 13,
    blobs: 22,
    blobAlpha: 0.11,
    dots: 950,
    dotAlpha: [0.16, 0.42],
    dotSize: [0.5, 1.9],
    speckles: 2400,
    speckleAlpha: [0.06, 0.22],
  });
}

// Road tile: medium-grey base (NOT pure black — avoids the ink-puddle
// darkening at intersections) + paper specks + light grey speckles.
function roadPattern(): ImageData {
  const w = 128;
  const h = 16;
  const { c, ctx } = ctxFor(w, h);
  ctx.fillStyle = GREY_ROAD;
  ctx.fillRect(0, 0, w, h);
  const r = rng(23);
  for (let i = 0; i < 110; i++) {
    ctx.fillStyle = PAPER;
    ctx.globalAlpha = 0.22 + r() * 0.4;
    const x = r() * w;
    const y = r() * h;
    const s = 0.4 + r() * 1.0;
    ctx.fillRect(x, y, s, s);
  }
  for (let i = 0; i < 220; i++) {
    ctx.fillStyle = r() > 0.5 ? '#888888' : '#2c2c2c';
    ctx.globalAlpha = 0.08 + r() * 0.18;
    const x = Math.floor(r() * w);
    const y = Math.floor(r() * h);
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.globalAlpha = 1;
  return ctx.getImageData(0, 0, w, h);
}

// Paper-tooth overlay. A large cream-tinted canvas with horizontal
// pencil-grain streaks + dense darker speckles. Used as a CSS
// `mix-blend-mode: multiply` overlay over the whole MapLibre canvas
// so the paper texture pervades EVERYTHING (parks, water, roads,
// buildings, the white land in between). Same trick a pencil-on-
// textured-paper rendering uses — the noisy multiply tints darken
// the surfaces unevenly, which both reads as paper grain AND
// roughens crisp MapLibre line edges as a freebie.
function generatePaperTextureUrl(): string {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  // WHITE base — the multiply blend only darkens where speckles are
  // dark, so a white "blank" means no cream tint of the underlying
  // colours, just the texture grain showing.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  const r = rng(99);
  // Long faint horizontal paper streaks for "tooth direction".
  for (let i = 0; i < 140; i++) {
    ctx.globalAlpha = 0.05 + r() * 0.12;
    ctx.fillStyle = r() > 0.5 ? '#b0a47a' : '#c8bd97';
    const y = r() * size;
    const x0 = r() * size;
    const len = 70 + r() * 260;
    ctx.fillRect(x0, y, len, 0.4 + r() * 0.8);
  }
  // Dense fine speckles — the high-frequency grain that reads as
  // "paper fibres" when multiplied. Boosted density + contrast so
  // the texture is clearly visible at the lower overlay opacity.
  for (let i = 0; i < 9500; i++) {
    ctx.globalAlpha = 0.05 + r() * 0.22;
    ctx.fillStyle = r() > 0.6 ? '#9a8d5c' : '#cdc097';
    const x = Math.floor(r() * size);
    const y = Math.floor(r() * size);
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.globalAlpha = 1;
  return c.toDataURL('image/png');
}

function addImg(map: maplibregl.Map, id: string, img: ImageData, pixelRatio = 1) {
  if (map.hasImage(id)) map.removeImage(id);
  map.addImage(id, img, { pixelRatio });
}

function clear(map: maplibregl.Map, id: string, prop: string) {
  try {
    (map.setPaintProperty as (l: string, p: string, v: unknown) => void)(id, prop, undefined);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------

function applyCrayonOverride(map: maplibregl.Map) {
  addImg(map, 'crayon-park', parkPattern(), 1);
  addImg(map, 'crayon-water', waterPattern(), 1);
  addImg(map, 'crayon-road', roadPattern(), 1);

  const layers = map.getStyle().layers ?? [];
  const buildingLayer = layers.find(
    (l) => (l as { 'source-layer'?: string })['source-layer'] === 'building',
  );
  const buildingSource = (buildingLayer as { source?: string } | undefined)?.source;

  // Track polygons that should get a softening outline AFTER the main
  // pass — we need the original layer's source + filter to know what
  // shapes to outline.
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

    if (type === 'background') {
      clear(map, id, 'background-pattern');
      map.setPaintProperty(id, 'background-color', PAPER);
      continue;
    }

    if (sl === 'water') {
      if (type === 'fill') {
        clear(map, id, 'fill-color');
        map.setPaintProperty(id, 'fill-pattern', 'crayon-water');
        map.setPaintProperty(id, 'fill-opacity', 1);
        const src = (l as { source?: string }).source;
        const filt = (l as { filter?: unknown }).filter;
        if (src) polygonsToSoften.push({
          baseId: id, source: src, sourceLayer: 'water', filter: filt, color: BLUE,
        });
        continue;
      }
      map.setLayoutProperty(id, 'visibility', 'none');
      continue;
    }

    if (sl === 'building') {
      if (type === 'fill') {
        clear(map, id, 'fill-pattern');
        map.setPaintProperty(id, 'fill-color', PAPER);
        map.setPaintProperty(id, 'fill-opacity', 1);
      } else if (type === 'fill-extrusion') {
        clear(map, id, 'fill-extrusion-pattern');
        map.setPaintProperty(id, 'fill-extrusion-color', PAPER);
        map.setPaintProperty(id, 'fill-extrusion-opacity', 1);
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
        if (src && sl) polygonsToSoften.push({
          baseId: id, source: src, sourceLayer: sl, filter: filt, color: GREEN,
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
      clear(map, id, 'line-color');
      clear(map, id, 'line-dasharray');
      map.setPaintProperty(id, 'line-pattern', 'crayon-road');
      // Solid opacity — the grey colour in the pattern handles the
      // "pencil" feel without alpha stacking at intersections.
      map.setPaintProperty(id, 'line-opacity', 1);
      const curW = map.getPaintProperty(id, 'line-width');
      const newW: unknown = ['max', 0.4, ['*', ROAD_WIDTH_SCALE, curW ?? 1]];
      try {
        (map.setPaintProperty as (l: string, p: string, v: unknown) => void)(
          id,
          'line-width',
          newW,
        );
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

    map.setLayoutProperty(id, 'visibility', 'none');
  }

  // Polygon corner softening. MapLibre has no native rounded-fill, so
  // we draw a thick same-colour line around each green / water polygon
  // with line-cap/join round. The stroke covers the polygon's sharp
  // perimeter and ARCS every corner — the shape ends up reading as a
  // rounded crayon blob instead of a hard polygon. Stroke width is
  // zoom-interpolated so the rounding stays proportional.
  for (const p of polygonsToSoften) {
    const softId = `soften-${p.baseId}`;
    if (map.getLayer(softId)) continue;
    try {
      map.addLayer({
        id: softId,
        type: 'line',
        source: p.source,
        'source-layer': p.sourceLayer,
        ...(p.filter !== undefined ? { filter: p.filter } : {}),
        paint: {
          'line-color': p.color,
          // Hard-outline-visible was the prior pain. Switch to a
          // SOFT FADE: thin same-colour line + big line-blur. The
          // blur (bigger than the line width) feathers the edge to
          // invisible at distance — reads as a watercolor halo
          // softening the polygon boundary, not a sticker border.
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
      /* skip silently — some layer specs may reject */
    }
  }

  // Wobble — boosted version. Each transportation line gets two
  // offset clones (+1.0 / -1.0 px perpendicular) drawn in SOLID
  // contrasting greys (one lighter, one darker) at full opacity.
  // Reads as three parallel pencil passes; the colour variation
  // (instead of alpha) keeps intersections clean — opaque grey-on-
  // grey overpaint, no alpha darkening.
  const roadIds: string[] = [];
  for (const l of map.getStyle().layers ?? []) {
    const sl = (l as { 'source-layer'?: string })['source-layer'];
    if (
      l.type === 'line' &&
      sl === 'transportation' &&
      !l.id.startsWith('wobble-')
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
    // Bigger offsets so the parallel passes are clearly visible past
    // the base line. ±3.5 px lands them just past the edge of a 3px
    // motorway / well outside thinner roads.
    const variants: Array<{ suffix: string; offset: number; color: string }> = [
      { suffix: 'lo', offset: 3.5, color: '#b0b0b0' },
      { suffix: 'hi', offset: -3.5, color: '#1f1f1f' },
    ];
    for (const v of variants) {
      const id = `wobble-${baseId}-${v.suffix}`;
      if (map.getLayer(id)) continue;
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
              'line-opacity': 1,
              // Feather the clones into pencil-scuff trails alongside
              // the main stroke, rather than crisp parallel lines.
              'line-blur': 1.5,
            },
            layout: {
              'line-cap': 'round',
              'line-join': 'round',
            },
          } as LayerSpecification,
          baseId, // insert before the original = below in z-order
        );
      } catch {
        /* skip — some classes may reject */
      }
    }
  }

  // Dark crayon building outline drawn LAST so it paints above the
  // walls + the polygon softeners.
  if (buildingSource && !map.getLayer('crayon-building-outline')) {
    const outlineLayer: LayerSpecification = {
      id: 'crayon-building-outline',
      type: 'line',
      source: buildingSource,
      'source-layer': 'building',
      minzoom: 13,
      paint: {
        'line-color': CRAYON,
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
  }
}

export default function PhaseTwoPreview() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  // Paper-tooth overlay generated once on mount.
  const paperUrl = useMemo(() => generatePaperTextureUrl(), []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: KYIV_CENTER,
      zoom: 14,
      pitch: 30,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.on('style.load', () => {
      applyCrayonOverride(map);
    });
    return () => {
      mapRef.current = null;
      map.remove();
    };
  }, []);

  return (
    <View style={styles.root}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {/* Paper-tooth multiply overlay. Sits ABOVE the MapLibre canvas
          so paper grain pervades every fill / line / building wall. The
          noisy darkening also roughens MapLibre's crisp line edges as a
          freebie — no extra layers needed for "hand-drawn" edge feel. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          pointerEvents: 'none',
          backgroundImage: `url(${paperUrl})`,
          backgroundRepeat: 'repeat',
          backgroundSize: '512px 512px',
          mixBlendMode: 'multiply',
          opacity: 0.55,
        }}
      />
      <View style={styles.banner} pointerEvents="box-none">
        <View style={styles.bannerInner}>
          <Text style={styles.bannerText}>Phase 2 preview · grey roads · soft corners</Text>
          <Pressable
            onPress={() => router.replace('/')}
            style={styles.backBtn}
            accessibilityRole="button"
          >
            <Text style={styles.backText}>back to app</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, position: 'relative', backgroundColor: PAPER },
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 12,
    paddingHorizontal: 12,
  },
  bannerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.88)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    gap: 8,
  },
  bannerText: { fontSize: 12, color: '#3a352a', flex: 1 },
  backBtn: {
    backgroundColor: CRAYON,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  backText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
