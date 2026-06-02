// Phase 2 PREVIEW. Pure "judge call" screen — not a feature.
// Production `/` map stays 100% Google.
//
// Direction:
//   - Palette: BLACK / WHITE / GREEN / BLUE only.
//   - Roads as crayon strokes at half liberty's width hierarchy.
//   - Buildings BACK as 3D (paper walls + dark crayon outline).
//   - Park / water / road TEXTURES rewritten as natural grain
//     instead of scribble patterns:
//       * Bigger tiles (256×256 fills, 128×16 roads) so repeats
//         are harder for the eye to catch.
//       * pixelRatio: 1 so the tile renders at its true size on
//         screen (prior 2x made each repeat tiny + obvious).
//       * Three stacked noise layers per tile — large soft accent
//         blobs (uneven coverage), medium scattered dots, fine 1px
//         speckles. No recognisable motifs / curves / lines.
//   - Everything else (POIs, place labels, transit, boundaries,
//     residential / commercial / industrial fills) hidden.

import { useEffect, useRef } from 'react';
import { View, StyleSheet, Text, Pressable } from 'react-native';
import { router } from 'expo-router';
import maplibregl, { type LayerSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const KYIV_CENTER: [number, number] = [30.5234, 50.4501]; // [lng, lat]

const PAPER = '#fafafa';
const CRAYON = '#1a1a1a';
const GREEN = '#65b246';
const GREEN_DARK = '#3a7e2a';
const GREEN_LIGHT = '#d8eccb';
const BLUE = '#2f99d8';
const BLUE_DARK = '#1a679a';
const BLUE_LIGHT = '#a7ddf3';

// Multiplier wrapped around liberty's line-width expression for every
// transportation line. Preserves liberty's per-class + per-zoom
// hierarchy. Aggressive cut — liberty's motorway is ~14px at zoom 14
// so even 0.5 still read as fat after the dark line-pattern fill.
// 0.22 lands motorway around 3px (hand-drawn marker thickness) while
// keeping residential streets visible at a thin ~0.6-0.8px.
const ROAD_WIDTH_SCALE = 0.22;

// ---------------------------------------------------------------------
// Canvas pattern generators — layered noise, NOT scribble motifs.
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

// Three-layer noise fill: soft accent blobs (uneven coverage) +
// medium scattered dots + fine 1px speckles. No motifs. Reads as
// natural crayon grain at any viewport scale.
function noiseFill(opts: {
  size: number;
  base: string;
  darker: string;
  lighter: string;
  seed: number;
  // Tuning knobs per layer.
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

  // Layer 1: large soft accent blobs — "uneven coverage" feel a
  // crayon naturally leaves.
  ctx.globalCompositeOperation = 'source-over';
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

  // Layer 2: medium scattered dots of varied size + color.
  for (let i = 0; i < dots; i++) {
    ctx.fillStyle = r() > 0.55 ? darker : lighter;
    ctx.globalAlpha = dotAlpha[0] + r() * (dotAlpha[1] - dotAlpha[0]);
    const x = r() * size;
    const y = r() * size;
    const s = dotSize[0] + r() * (dotSize[1] - dotSize[0]);
    ctx.fillRect(x, y, s, s);
  }

  // Layer 3: very fine 1px speckles — the high-frequency grain that
  // sells "crayon on paper" up close.
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
  });
}

function waterPattern(): ImageData {
  return noiseFill({
    size: 256,
    base: BLUE,
    darker: BLUE_DARK,
    lighter: BLUE_LIGHT,
    seed: 13,
    // A touch more blob variation on water for a subtle "depth" feel
    // without going back into directional ripple lines.
    blobs: 18,
    blobAlpha: 0.07,
  });
}

// Road tile: dark CRAYON base + paper specks. Wider tile (128×16)
// drastically reduces visible repeats vs the prior 32×8. No
// horizontal "drag" lines (those created visible streaks).
function roadPattern(): ImageData {
  const w = 128;
  const h = 16;
  const { c, ctx } = ctxFor(w, h);
  ctx.fillStyle = CRAYON;
  ctx.fillRect(0, 0, w, h);
  const r = rng(23);

  // Soft darker blobs for subtle uneven darkness across the line.
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = '#0a0a0a';
    ctx.globalAlpha = 0.06 + r() * 0.1;
    const x = r() * w;
    const y = r() * h;
    const radius = 4 + r() * 14;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  // Paper specks — "crayon missed paper".
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = PAPER;
    ctx.globalAlpha = 0.18 + r() * 0.4;
    const x = r() * w;
    const y = r() * h;
    const s = 0.4 + r() * 1.0;
    ctx.fillRect(x, y, s, s);
  }
  // Fine 1px speckles for paper texture.
  for (let i = 0; i < 300; i++) {
    ctx.fillStyle = r() > 0.5 ? PAPER : '#3a3a3a';
    ctx.globalAlpha = 0.06 + r() * 0.15;
    const x = Math.floor(r() * w);
    const y = Math.floor(r() * h);
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.globalAlpha = 1;
  return ctx.getImageData(0, 0, w, h);
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
  // pixelRatio: 1 so each tile renders at its full pixel size on
  // screen (prior 2x halved the rendered tile size, making repeats
  // tiny + obvious).
  addImg(map, 'crayon-park', parkPattern(), 1);
  addImg(map, 'crayon-water', waterPattern(), 1);
  addImg(map, 'crayon-road', roadPattern(), 1);

  const layers = map.getStyle().layers ?? [];
  const buildingLayer = layers.find(
    (l) => (l as { 'source-layer'?: string })['source-layer'] === 'building',
  );
  const buildingSource = (buildingLayer as { source?: string } | undefined)?.source;

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
        continue;
      }
      map.setLayoutProperty(id, 'visibility', 'none');
      continue;
    }

    // Buildings: KEEP 3D extrusion (per request), paint walls PAPER
    // white. The injected dark outline layer (below) gives the
    // building footprint a crayon stroke seen from above.
    if (sl === 'building') {
      if (type === 'fill') {
        clear(map, id, 'fill-pattern');
        map.setPaintProperty(id, 'fill-color', PAPER);
        map.setPaintProperty(id, 'fill-opacity', 1);
      } else if (type === 'fill-extrusion') {
        clear(map, id, 'fill-extrusion-pattern');
        map.setPaintProperty(id, 'fill-extrusion-color', PAPER);
        map.setPaintProperty(id, 'fill-extrusion-opacity', 1);
        // Leave liberty's height expression intact — that's what
        // makes them 3D. Keep vertical-gradient default (subtle
        // wall shading toward gray) for a hint of dimension without
        // breaking the B&W palette.
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
      // Drop the line a touch — dark-fill line-pattern reads visually
      // heavier than its actual width, opacity 0.78 nudges it back
      // toward pencil-on-paper instead of ink-solid.
      map.setPaintProperty(id, 'line-opacity', 0.78);
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

  // Dark crayon outline drawn from the building source-layer.
  // Painted LAST so the outline sits above roads + walls.
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
          'interpolate',
          ['linear'],
          ['zoom'],
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

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: KYIV_CENTER,
      zoom: 14,
      pitch: 30, // slight default tilt to show off the 3D extrusion
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
      <View style={styles.banner} pointerEvents="box-none">
        <View style={styles.bannerInner}>
          <Text style={styles.bannerText}>Phase 2 preview · B&amp;W crayon · natural grain</Text>
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
