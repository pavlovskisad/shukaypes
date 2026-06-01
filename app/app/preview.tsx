// Phase 2 PREVIEW. Pure "judge call" screen — not a feature. Loads
// MapLibre GL + OpenFreeMap (no API key) vector tiles centered on
// Kyiv with a hand-drawn / crayon override applied on top of the
// `liberty` style. Production `/` map stays 100% Google.
//
// All pattern images are generated at runtime in <canvas> so this
// preview ships zero sprite assets. When the artist's tiles arrive
// they drop into app/public/textures/ and we point at those instead.

import { useEffect, useRef } from 'react';
import { View, StyleSheet, Text, Pressable } from 'react-native';
import { router } from 'expo-router';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const KYIV_CENTER: [number, number] = [30.5234, 50.4501]; // [lng, lat]

// ---------------------------------------------------------------------
// Canvas pattern generators. Each returns ImageData sized to power-of-2
// so MapLibre's GPU repeat tiles cleanly. Strokes are clipped past the
// tile edges so we get continuous repeats (canvas doesn't have a
// wrap-around mode; we just draw a lot and accept the seam noise is
// hidden by the strokes themselves).
// ---------------------------------------------------------------------

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

interface PatternOpts {
  size: number;
  bg: string | null;
  color: string;
  strokeCount: number;
  strokeOpacity: number;
  strokeWidth: number;
  segLen: number;
  segs: number;
  seed: number;
}

function makeScribblePattern(opts: PatternOpts): ImageData {
  const { size, bg, color, strokeCount, strokeOpacity, strokeWidth, segLen, segs, seed } = opts;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);
  } else {
    ctx.clearRect(0, 0, size, size);
  }
  const r = rng(seed);
  ctx.strokeStyle = color;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < strokeCount; i++) {
    ctx.globalAlpha = strokeOpacity * (0.45 + r() * 0.6);
    let x = r() * size;
    let y = r() * size;
    const ang = r() * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let j = 0; j < segs; j++) {
      const w = (r() - 0.5) * 3.5;
      x += (Math.cos(ang) * segLen) / segs + w;
      y += (Math.sin(ang) * segLen) / segs + w;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return ctx.getImageData(0, 0, size, size);
}

// Paper background — warm cream with faint pencil grain.
function paperPattern(): ImageData {
  return makeScribblePattern({
    size: 128,
    bg: '#f4eedb',
    color: '#cbc1a4',
    strokeCount: 18,
    strokeOpacity: 0.12,
    strokeWidth: 0.9,
    segLen: 14,
    segs: 3,
    seed: 3,
  });
}

// Park — bright grass green with darker scribbled overstrokes.
function parkPattern(): ImageData {
  return makeScribblePattern({
    size: 96,
    bg: '#7fc55b',
    color: '#2f6a1d',
    strokeCount: 110,
    strokeOpacity: 0.55,
    strokeWidth: 1.6,
    segLen: 14,
    segs: 3,
    seed: 7,
  });
}

// Water — marker-blue with wavy darker strokes for ripple feel.
function waterPattern(): ImageData {
  const size = 96;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#3aa8e6';
  ctx.fillRect(0, 0, size, size);
  const r = rng(13);
  ctx.strokeStyle = '#1d6c9c';
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'round';
  for (let i = 0; i < 14; i++) {
    ctx.globalAlpha = 0.38 + r() * 0.2;
    const y = r() * size;
    const amp = 1.5 + r() * 2.5;
    const phase = r() * Math.PI * 2;
    ctx.beginPath();
    for (let x = -4; x <= size + 4; x += 2) {
      const yy = y + Math.sin((x / size) * Math.PI * 4 + phase) * amp;
      if (x === -4) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return ctx.getImageData(0, 0, size, size);
}

// Road brush — opaque cream stroke with crayon grain.
// IMPORTANT: line-pattern's tile gets repeated ALONG the line, so the
// tile's HEIGHT becomes the road's stroke thickness. We draw a tall
// thin slice with horizontal crayon scribbles so it looks like a real
// crayon line dragged sideways.
function roadBrushPattern(): ImageData {
  const w = 64;
  const h = 16;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  // Solid casing
  ctx.fillStyle = '#fbf3da';
  ctx.fillRect(0, 0, w, h);
  // Darker top + bottom edge — irregular casing
  const r = rng(23);
  ctx.strokeStyle = '#a08b5e';
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'round';
  for (let i = 0; i < 24; i++) {
    ctx.globalAlpha = 0.4 + r() * 0.4;
    const y = r() * h;
    ctx.beginPath();
    ctx.moveTo(-2 + r() * 4, y);
    for (let x = 0; x < w; x += 3) {
      ctx.lineTo(x, y + (r() - 0.5) * 2.4);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return ctx.getImageData(0, 0, w, h);
}

function addImg(map: maplibregl.Map, id: string, img: ImageData, pixelRatio = 2) {
  if (map.hasImage(id)) map.removeImage(id);
  map.addImage(id, img, { pixelRatio });
}

// ---------------------------------------------------------------------
// Override the loaded liberty style. Strategy is: be VERY aggressive
// about hiding clutter (POI / labels / boundaries / transit), repaint
// the few visual layers we care about (water / parks / roads /
// buildings), and flatten 3D extrusions so it reads as a hand-drawn
// 2D map rather than a city-builder isometric.
// ---------------------------------------------------------------------

const GREEN_LANDUSE = new Set([
  'park',
  'pitch',
  'garden',
  'playground',
  'cemetery',
  'recreation_ground',
  'nature_reserve',
  'protected_area',
  'allotments',
  'meadow',
  'grass',
  'wood',
  'forest',
  'scrub',
  'farmland',
  'farm',
]);

function applyCrayonOverride(map: maplibregl.Map) {
  addImg(map, 'crayon-paper', paperPattern(), 2);
  addImg(map, 'crayon-park', parkPattern(), 2);
  addImg(map, 'crayon-water', waterPattern(), 2);
  // pixelRatio 1 for the road tile — its 16px height should ~match
  // the visible road thickness, not be halved by retina scaling.
  addImg(map, 'crayon-road', roadBrushPattern(), 1);

  const layers = map.getStyle().layers ?? [];
  for (const l of layers) {
    const id = l.id;
    const sl = (l as { 'source-layer'?: string })['source-layer'];
    const type = l.type;

    // Background — paper texture.
    if (type === 'background') {
      try {
        map.setPaintProperty(id, 'background-pattern', 'crayon-paper');
      } catch {
        /* some background layers don't accept pattern; ignore */
      }
      continue;
    }

    // Water — blue crayon ripples.
    if (sl === 'water' && (type === 'fill' || type === 'fill-extrusion')) {
      if (type === 'fill') {
        map.setPaintProperty(id, 'fill-pattern', 'crayon-water');
        map.setPaintProperty(id, 'fill-opacity', 1);
      } else {
        map.setLayoutProperty(id, 'visibility', 'none');
      }
      continue;
    }

    // Buildings — keep liberty's 3D extrusion (per request) but warm
    // the colour to a hand-drawn cream. Flat fills also get the same
    // treatment if liberty draws any.
    if (sl === 'building') {
      if (type === 'fill-extrusion') {
        map.setPaintProperty(id, 'fill-extrusion-color', '#e7dbb1');
        map.setPaintProperty(id, 'fill-extrusion-opacity', 0.85);
        continue;
      }
      if (type === 'fill') {
        map.setPaintProperty(id, 'fill-color', '#e7dbb1');
        map.setPaintProperty(id, 'fill-outline-color', '#b8a878');
        map.setPaintProperty(id, 'fill-opacity', 0.75);
        continue;
      }
    }

    // Landuse / landcover — only paint the GREEN categories with the
    // park pattern. Residential / industrial / commercial get hidden
    // so they don't dilute the paper background.
    if ((sl === 'landuse' || sl === 'landcover') && type === 'fill') {
      const cls = (l as { filter?: unknown }).filter; // can't easily read class; instead use a class-driven repaint below
      // Best-effort: if liberty's layer id hints at greenspace, paint;
      // otherwise hide.
      const idLower = id.toLowerCase();
      const greenHint =
        /park|grass|wood|forest|cemetery|recreation|pitch|meadow|farm|garden|scrub|playground|nature/.test(
          idLower,
        );
      if (greenHint) {
        map.setPaintProperty(id, 'fill-pattern', 'crayon-park');
        map.setPaintProperty(id, 'fill-opacity', 1);
      } else {
        map.setLayoutProperty(id, 'visibility', 'none');
      }
      // touch cls so unused-var lint doesn't complain
      void cls;
      continue;
    }

    // Hide aeroway / urban-area / hillshade noise.
    if (sl === 'aeroway' || sl === 'park' || sl === 'place') {
      // Note: 'park' source-layer (separate from landuse) — paint it.
      if (sl === 'park' && type === 'fill') {
        map.setPaintProperty(id, 'fill-pattern', 'crayon-park');
        map.setPaintProperty(id, 'fill-opacity', 1);
        continue;
      }
      map.setLayoutProperty(id, 'visibility', 'none');
      continue;
    }

    // Roads — crayon brush. Liberty layers roads in many id'd layers
    // (`tunnel_*`, `bridge_*`, `highway_*`, `road_*`). Apply the
    // pattern to ALL transportation lines.
    if (sl === 'transportation' && type === 'line') {
      try {
        map.setPaintProperty(id, 'line-pattern', 'crayon-road');
        // Bump width so the brush reads. Inspect current width if it's
        // a function/expression — only bump numeric constants.
        const cur = map.getPaintProperty(id, 'line-width');
        if (typeof cur === 'number') {
          map.setPaintProperty(id, 'line-width', Math.max(cur, 3) + 1.5);
        }
      } catch {
        /* not all line layers accept line-pattern */
      }
      continue;
    }

    // Hide the rest of the noise: every symbol layer (icons + text),
    // boundaries, transit lines, road shields, etc.
    if (
      type === 'symbol' ||
      sl === 'boundary' ||
      sl === 'transit' ||
      sl === 'transportation_name' ||
      sl === 'place' ||
      sl === 'place_label' ||
      sl === 'poi_label' ||
      sl === 'housenumber'
    ) {
      map.setLayoutProperty(id, 'visibility', 'none');
      continue;
    }
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
      // Default-flat but allow tilt (two-finger drag) since liberty's
      // 3D building extrusions are kept — gives users an isometric
      // option without forcing it.
      pitch: 0,
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
          <Text style={styles.bannerText}>Phase 2 preview · MapLibre + OpenFreeMap + crayon override</Text>
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
  root: { flex: 1, position: 'relative', backgroundColor: '#f4eedb' },
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
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  backText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
