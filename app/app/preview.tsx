// Phase 2 PREVIEW. Pure "judge call" screen — not a feature.
// Production `/` map stays 100% Google.
//
// Current direction (B&W crayon, minimal):
//   - Palette: BLACK / WHITE / GREEN / BLUE only.
//   - Roads as crayon strokes; weight hierarchy from liberty's
//     per-class widths, halved (was too fat).
//   - Buildings back as outline-only: paper fill (invisible on
//     paper bg) + dark crayon outline layer added on top of
//     liberty's stack.
//   - Park and water FILLS get a subtle crayon-coloring texture —
//     base color + sparse lighter streaks for "paper showing
//     through". Less decoration than the prior scribble patterns;
//     reads like a kid colouring with a crayon, not a sketch.
//   - Road strokes also get a granulated noise pattern (dark base
//     + sparse paper-color specks) so they're not marker-clean.
//   - Everything else (POIs, place labels, transit, boundaries,
//     residential / commercial / industrial fills) hidden.

import { useEffect, useRef } from 'react';
import { View, StyleSheet, Text, Pressable } from 'react-native';
import { router } from 'expo-router';
import maplibregl, { type LayerSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const KYIV_CENTER: [number, number] = [30.5234, 50.4501]; // [lng, lat]

// Restricted palette.
const PAPER = '#fafafa';
const CRAYON = '#1a1a1a';
const GREEN = '#65b246';
const BLUE = '#2f99d8';

// Multiplier applied to liberty's existing line-width expressions
// for every transportation line. Halving gets us out of "too fat"
// territory while keeping liberty's zoom + class hierarchy intact.
const ROAD_WIDTH_SCALE = 0.5;

// ---------------------------------------------------------------------
// Canvas pattern generators. All return ImageData; we hand them to
// `map.addImage` and reference by id in fill-pattern / line-pattern.
// Designed for "crayon coloring", not "scribble" — base color + sparse
// lighter streaks suggesting paper showing through the crayon.
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

// Park: solid green + sparse PAPER-coloured short curves (paper grain).
function parkPattern(): ImageData {
  const size = 64;
  const { c, ctx } = ctxFor(size, size);
  ctx.fillStyle = GREEN;
  ctx.fillRect(0, 0, size, size);
  const r = rng(7);
  ctx.strokeStyle = PAPER;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < 18; i++) {
    ctx.globalAlpha = 0.18 + r() * 0.18;
    ctx.lineWidth = 0.7 + r() * 0.9;
    let x = r() * size;
    let y = r() * size;
    const ang = r() * Math.PI * 2;
    const len = 6 + r() * 12;
    const segs = 2 + Math.floor(r() * 2);
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let j = 0; j < segs; j++) {
      const wob = (r() - 0.5) * 2;
      x += (Math.cos(ang) * len) / segs + wob;
      y += (Math.sin(ang) * len) / segs + wob;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return ctx.getImageData(0, 0, size, size);
}

// Water: solid blue + sparse lighter horizontal wavy "ripples".
function waterPattern(): ImageData {
  const size = 64;
  const { c, ctx } = ctxFor(size, size);
  ctx.fillStyle = BLUE;
  ctx.fillRect(0, 0, size, size);
  const r = rng(13);
  ctx.strokeStyle = '#a7ddf3';
  ctx.lineWidth = 1.0;
  ctx.lineCap = 'round';
  for (let i = 0; i < 8; i++) {
    ctx.globalAlpha = 0.28 + r() * 0.22;
    const y = r() * size;
    const amp = 1.0 + r() * 1.6;
    const phase = r() * Math.PI * 2;
    ctx.beginPath();
    for (let x = -4; x <= size + 4; x += 2) {
      const yy = y + Math.sin((x / size) * Math.PI * 3 + phase) * amp;
      if (x === -4) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return ctx.getImageData(0, 0, size, size);
}

// Road: dark crayon base + sparse PAPER specks for "crayon-miss" grain.
// line-pattern stretches the tile to the line's width, so we use a
// short fat horizontal tile (32×8) tuned to a typical road thickness.
function roadPattern(): ImageData {
  const w = 32;
  const h = 8;
  const { c, ctx } = ctxFor(w, h);
  ctx.fillStyle = CRAYON;
  ctx.fillRect(0, 0, w, h);
  const r = rng(23);
  // Random PAPER-coloured specks scattered for crayon grain.
  ctx.fillStyle = PAPER;
  for (let i = 0; i < 22; i++) {
    ctx.globalAlpha = 0.35 + r() * 0.45;
    const x = r() * w;
    const y = r() * h;
    const s = 0.6 + r() * 1.0;
    ctx.fillRect(x, y, s, s);
  }
  // A couple short horizontal lighter strokes too — crayon drags.
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = 0.6;
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    ctx.globalAlpha = 0.25 + r() * 0.2;
    const y = r() * h;
    const x0 = r() * (w - 8);
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + 4 + r() * 6, y + (r() - 0.5) * 1.6);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return ctx.getImageData(0, 0, w, h);
}

function addImg(map: maplibregl.Map, id: string, img: ImageData, pixelRatio = 2) {
  if (map.hasImage(id)) map.removeImage(id);
  map.addImage(id, img, { pixelRatio });
}

// Best-effort clear of a paint property — wrapped because MapLibre
// throws when the layer doesn't support that prop name.
function clear(map: maplibregl.Map, id: string, prop: string) {
  try {
    (map.setPaintProperty as (l: string, p: string, v: unknown) => void)(id, prop, undefined);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------

function applyCrayonOverride(map: maplibregl.Map) {
  addImg(map, 'crayon-park', parkPattern(), 2);
  addImg(map, 'crayon-water', waterPattern(), 2);
  // pixelRatio 1 on road so the 8px tile height maps ~1:1 to line
  // width on screen, instead of being squished by retina scaling.
  addImg(map, 'crayon-road', roadPattern(), 1);

  const layers = map.getStyle().layers ?? [];
  // Source name for the building outline layer we'll inject.
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

    // Buildings — paper fill (invisible against the bg) so the outline
    // layer we add later is the only visible building marker. Flatten
    // any 3D extrusion so the top-down view stays clean.
    if (sl === 'building') {
      if (type === 'fill') {
        clear(map, id, 'fill-pattern');
        map.setPaintProperty(id, 'fill-color', PAPER);
        map.setPaintProperty(id, 'fill-opacity', 1);
      } else if (type === 'fill-extrusion') {
        map.setPaintProperty(id, 'fill-extrusion-color', PAPER);
        map.setPaintProperty(id, 'fill-extrusion-opacity', 1);
        try {
          map.setPaintProperty(id, 'fill-extrusion-height', 0);
          map.setPaintProperty(id, 'fill-extrusion-base', 0);
        } catch {
          /* expressions may not be replaceable; leave as is */
        }
      }
      continue;
    }

    // Greenspace.
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

    // Roads.
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
      // Crayon stroke pattern; pattern provides the colour so we
      // explicitly clear any existing line-color so the pattern wins.
      clear(map, id, 'line-color');
      clear(map, id, 'line-dasharray');
      map.setPaintProperty(id, 'line-pattern', 'crayon-road');
      // Wrap existing width in a multiply so liberty's zoom + class
      // hierarchy stays intact, just halved.
      const curW = map.getPaintProperty(id, 'line-width');
      const newW: unknown = ['max', 0.4, ['*', ROAD_WIDTH_SCALE, curW ?? 1]];
      try {
        (map.setPaintProperty as (l: string, p: string, v: unknown) => void)(
          id,
          'line-width',
          newW,
        );
      } catch {
        /* fall back to a flat value if expression rejected */
        if (typeof curW === 'number') {
          map.setPaintProperty(id, 'line-width', curW * ROAD_WIDTH_SCALE);
        }
      }
      try {
        map.setLayoutProperty(id, 'line-cap', 'round');
        map.setLayoutProperty(id, 'line-join', 'round');
      } catch {
        /* some layers don't accept these layout props */
      }
      continue;
    }

    map.setLayoutProperty(id, 'visibility', 'none');
  }

  // Inject a dark crayon outline drawn from the building source-layer.
  // Added LAST so it paints on top of everything (roads etc) — building
  // shapes become the only visible building cue.
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
      attributionControl: { compact: true },
      pitch: 0,
      maxPitch: 0,
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
          <Text style={styles.bannerText}>Phase 2 preview · B&amp;W crayon (textured)</Text>
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
