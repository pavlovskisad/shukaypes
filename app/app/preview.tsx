// Phase 2 PREVIEW. Pure "judge call" screen — not a feature. Loads
// MapLibre GL + OpenFreeMap (no API key) vector tiles centered on
// Kyiv with a hand-drawn / crayon override applied on top of the
// `liberty` style. Production `/` map stays 100% Google. Goal: see
// whether textured streets + textured parks + textured water are
// worth the full migration we'd need to bring this to production.
//
// Pattern images are generated in a <canvas> at runtime and added
// via map.addImage so we don't need any sprite assets shipped with
// the app — keeps this preview self-contained.

import { useEffect, useRef } from 'react';
import { View, StyleSheet, Text, Pressable } from 'react-native';
import { router } from 'expo-router';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const KYIV_CENTER: [number, number] = [30.5234, 50.4501]; // [lng, lat]

// Generate a tileable hand-drawn pattern as an RGBA pixel array.
// Approach: scribble a bunch of short jagged crayon strokes in
// `color` with low opacity over a paper-tinted background. The
// strokes wrap at the tile edges (we draw past them and rely on
// canvas being repeatable) for seamless tiling. Different `density`
// + `dotsPerStroke` give us "park" vs "water" vs "road" feels.
function makeCrayonPattern(opts: {
  size: number;
  bg: string | null;
  color: string;
  strokeCount: number;
  strokeOpacity: number;
  strokeWidth: number;
  seed: number;
}): ImageData {
  const { size, bg, color, strokeCount, strokeOpacity, strokeWidth, seed } = opts;
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
  // Tiny seeded PRNG so the pattern is stable across renders.
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  ctx.strokeStyle = color;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < strokeCount; i++) {
    ctx.globalAlpha = strokeOpacity * (0.5 + rnd() * 0.6);
    const x0 = rnd() * size;
    const y0 = rnd() * size;
    const len = 8 + rnd() * 18;
    const ang = rnd() * Math.PI * 2;
    // 3-4 jagged segments per stroke for the crayon-drag feel.
    const segs = 3 + Math.floor(rnd() * 2);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    let x = x0;
    let y = y0;
    for (let j = 0; j < segs; j++) {
      const wobble = (rnd() - 0.5) * 3;
      x += (Math.cos(ang) * len) / segs + wobble;
      y += (Math.sin(ang) * len) / segs + wobble;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return ctx.getImageData(0, 0, size, size);
}

function addPatternImage(map: maplibregl.Map, id: string, img: ImageData) {
  // pixelRatio: 2 so the pattern looks crisp at retina; visually the
  // pattern's footprint on the map is roughly half its pixel size.
  if (map.hasImage(id)) map.removeImage(id);
  map.addImage(id, img, { pixelRatio: 2 });
}

// Once the base liberty style has loaded, walk its layers and rewrite
// the visual ones to use our crayon palette + patterns. Anything we
// don't explicitly recolor (POI / labels / boundaries) gets hidden
// for the cleaner "game map" feel that matches the production look.
function applyCrayonOverride(map: maplibregl.Map) {
  // Paper background (the page beneath everything).
  const paper = makeCrayonPattern({
    size: 96,
    bg: '#f6f2e6',
    color: '#d8cfb6',
    strokeCount: 30,
    strokeOpacity: 0.18,
    strokeWidth: 1.1,
    seed: 1,
  });
  // Park scribble — bold grass-green.
  const park = makeCrayonPattern({
    size: 96,
    bg: '#82c560',
    color: '#3f7a2c',
    strokeCount: 60,
    strokeOpacity: 0.45,
    strokeWidth: 1.4,
    seed: 7,
  });
  // Water scribble — vivid marker-blue.
  const water = makeCrayonPattern({
    size: 96,
    bg: '#3aa8e6',
    color: '#1a6c9e',
    strokeCount: 55,
    strokeOpacity: 0.3,
    strokeWidth: 1.3,
    seed: 13,
  });
  // Road brush — slightly translucent warm-cream that the line-pattern
  // smears along the line. Color of the casing lives in the layer.
  const road = makeCrayonPattern({
    size: 32,
    bg: '#f2e9d0',
    color: '#a59770',
    strokeCount: 24,
    strokeOpacity: 0.55,
    strokeWidth: 1.4,
    seed: 23,
  });

  addPatternImage(map, 'crayon-paper', paper);
  addPatternImage(map, 'crayon-park', park);
  addPatternImage(map, 'crayon-water', water);
  addPatternImage(map, 'crayon-road', road);

  // Background — paper texture under everything else.
  if (map.getLayer('background')) {
    map.setPaintProperty('background', 'background-pattern', 'crayon-paper');
  }

  // Walk every layer; route them by source-layer (OpenMapTiles schema)
  // so the override is robust to liberty's per-layer id naming.
  const layers = map.getStyle().layers ?? [];
  for (const l of layers) {
    const sl = (l as { 'source-layer'?: string })['source-layer'];
    const id = l.id;

    if (sl === 'water' && l.type === 'fill') {
      map.setPaintProperty(id, 'fill-pattern', 'crayon-water');
      map.setPaintProperty(id, 'fill-opacity', 1);
      continue;
    }
    // Parks + other green landuse (forest, grass, recreation_ground).
    if (
      sl === 'park' ||
      (sl === 'landuse' && l.type === 'fill') ||
      (sl === 'landcover' && l.type === 'fill')
    ) {
      // Only paint the actually-green categories with the park pattern.
      // OpenMapTiles `landuse.class` covers park/garden/recreation
      // /cemetery; `landcover.class` covers wood/grass/farmland.
      map.setPaintProperty(id, 'fill-pattern', 'crayon-park');
      map.setPaintProperty(id, 'fill-opacity', 0.92);
      continue;
    }
    // Roads — line-pattern gives the crayon-brush stroke we couldn't
    // do on Google.
    if (sl === 'transportation' && l.type === 'line') {
      map.setPaintProperty(id, 'line-pattern', 'crayon-road');
      // Bump width a touch so the texture reads.
      const w = map.getPaintProperty(id, 'line-width');
      if (typeof w === 'number') map.setPaintProperty(id, 'line-width', w + 1.5);
      continue;
    }
    // Buildings — soft cream paper so the city reads as inhabited
    // without dominating.
    if (sl === 'building' && l.type === 'fill') {
      map.setPaintProperty(id, 'fill-color', '#e9deb8');
      map.setPaintProperty(id, 'fill-opacity', 0.8);
      continue;
    }
    // Hide everything else (POI markers, transit, boundaries, place
    // labels) — keep this a clean illustrative base, matching the
    // production map's no-clutter rule.
    if (l.type === 'symbol' || sl === 'boundary' || sl === 'transit') {
      map.setLayoutProperty(id, 'visibility', 'none');
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
      zoom: 13,
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
  root: { flex: 1, position: 'relative', backgroundColor: '#f6f2e6' },
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
    backgroundColor: 'rgba(255,255,255,0.85)',
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
