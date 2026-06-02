// Phase 2 PREVIEW. Pure "judge call" screen — not a feature. Loads
// MapLibre GL + OpenFreeMap vector tiles centered on Kyiv with a
// minimal hand-drawn override on top of the `liberty` style.
// Production `/` map stays 100% Google.
//
// Direction (per the latest review):
//   - Paper-white background; no cream wash, no warm tint.
//   - Palette restricted to BLACK / WHITE / GREEN / BLUE only.
//   - Strokes only, simple fills — no decorative scribble patterns.
//     Roads are a single dark crayon line per class; liberty's
//     built-in per-class line widths give the "different weight"
//     stroke hierarchy for free (motorway thick → residential thin).
//   - Hide everything that isn't road / park / water (buildings,
//     residential / commercial / industrial fills, transit, POIs,
//     labels, boundaries, place names).

import { useEffect, useRef } from 'react';
import { View, StyleSheet, Text, Pressable } from 'react-native';
import { router } from 'expo-router';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const KYIV_CENTER: [number, number] = [30.5234, 50.4501]; // [lng, lat]

// Restricted palette.
const PAPER = '#fafafa';
const CRAYON = '#1a1a1a';
const GREEN = '#65b246';
const BLUE = '#2f99d8';

// Best-effort null-set so the previous preview's `fill-pattern` /
// `line-pattern` overrides don't linger when we redeploy. Wrapped
// because MapLibre throws if the layer doesn't support that prop.
function clear(map: maplibregl.Map, id: string, prop: string) {
  try {
    (map.setPaintProperty as (l: string, p: string, v: unknown) => void)(id, prop, undefined);
  } catch {
    /* ignore */
  }
}

function applyCrayonOverride(map: maplibregl.Map) {
  const layers = map.getStyle().layers ?? [];
  for (const l of layers) {
    const id = l.id;
    const sl = (l as { 'source-layer'?: string })['source-layer'];
    const type = l.type;
    const lower = id.toLowerCase();

    // Paper background.
    if (type === 'background') {
      clear(map, id, 'background-pattern');
      map.setPaintProperty(id, 'background-color', PAPER);
      continue;
    }

    // Water — flat crayon blue, no ripple pattern.
    if (sl === 'water') {
      if (type === 'fill') {
        clear(map, id, 'fill-pattern');
        map.setPaintProperty(id, 'fill-color', BLUE);
        map.setPaintProperty(id, 'fill-opacity', 0.95);
        continue;
      }
      // Lines / extrusions over water hidden.
      map.setLayoutProperty(id, 'visibility', 'none');
      continue;
    }

    // Buildings — hidden entirely. They were the source of the cream
    // wash in the previous preview, and "less decoration" wins over
    // keeping the 3D extrusion for now.
    if (sl === 'building') {
      map.setLayoutProperty(id, 'visibility', 'none');
      continue;
    }

    // Greenspace — flat crayon green. Hide non-green landuse so the
    // residential / commercial / industrial blocks stop tinting the
    // paper.
    if ((sl === 'landuse' || sl === 'landcover') && type === 'fill') {
      const isGreen =
        /park|grass|wood|forest|cemetery|recreation|pitch|meadow|farm|garden|scrub|playground|nature/.test(
          lower,
        );
      if (isGreen) {
        clear(map, id, 'fill-pattern');
        map.setPaintProperty(id, 'fill-color', GREEN);
        map.setPaintProperty(id, 'fill-opacity', 0.92);
      } else {
        map.setLayoutProperty(id, 'visibility', 'none');
      }
      continue;
    }
    // `park` source-layer (separate from landuse in OpenMapTiles).
    if (sl === 'park' && type === 'fill') {
      clear(map, id, 'fill-pattern');
      map.setPaintProperty(id, 'fill-color', GREEN);
      map.setPaintProperty(id, 'fill-opacity', 0.92);
      continue;
    }

    // Roads — single dark crayon line per class. Hide casings so a
    // road reads as ONE stroke (not casing + white inner fill). The
    // road weight hierarchy comes from liberty's own per-class line-
    // width zoom expressions, untouched.
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
      clear(map, id, 'line-pattern');
      clear(map, id, 'line-dasharray');
      map.setPaintProperty(id, 'line-color', CRAYON);
      // Slight transparency reads more pencil/crayon than ink-solid.
      map.setPaintProperty(id, 'line-opacity', 0.82);
      // Round caps + joins make the road graph feel less mechanical
      // — closer to a hand-drawn stroke at every intersection.
      try {
        map.setLayoutProperty(id, 'line-cap', 'round');
        map.setLayoutProperty(id, 'line-join', 'round');
      } catch {
        /* some layers don't accept these layout props */
      }
      continue;
    }

    // Everything else — hidden. POIs, place labels, boundaries,
    // transit, road shields, housenumbers, aeroways, etc.
    map.setLayoutProperty(id, 'visibility', 'none');
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
      maxPitch: 0, // no tilt — buildings are hidden, isometric adds nothing
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
          <Text style={styles.bannerText}>Phase 2 preview · B&amp;W crayon (minimal)</Text>
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
