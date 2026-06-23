// Phase 2 PREVIEW. Was the judge-call screen for the hand-drawn
// MapLibre map; the styling work that started here now lives in
// `components/map/crayonStyle.ts` and is shared with the production
// map. This screen stays around as a stripped-down place to see the
// base style without any pet/paw overlays on top — useful for tuning.

import { useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, Text, Pressable } from 'react-native';
import { router } from 'expo-router';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { TYPE } from '../constants/type';

import {
  LIGHT_PALETTE,
  applyCrayonOverride,
  fetchCrayonStyleSpec,
  generatePaperTextureUrl,
  installPaperOverlaySync,
} from '../components/map/crayonStyle';

const KYIV_CENTER: [number, number] = [30.5234, 50.4501];

export default function PhaseTwoPreview() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const paperOverlayRef = useRef<HTMLDivElement | null>(null);
  const paperUrl = useMemo(() => generatePaperTextureUrl(LIGHT_PALETTE), []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;
    let cleanupPaper: (() => void) | null = null;

    (async () => {
      const style = await fetchCrayonStyleSpec();
      if (cancelled || !containerRef.current) return;
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: style as maplibregl.StyleSpecification,
        center: KYIV_CENTER,
        zoom: 14,
        pitch: 30,
        attributionControl: { compact: true },
      });
      mapRef.current = map;
      map.on('style.load', () => {
        applyCrayonOverride(map, LIGHT_PALETTE);
      });
      cleanupPaper = installPaperOverlaySync(
        map,
        paperOverlayRef,
        KYIV_CENTER[0],
        KYIV_CENTER[1],
      );
    })();

    return () => {
      cancelled = true;
      cleanupPaper?.();
      const m = mapRef.current;
      mapRef.current = null;
      if (m) m.remove();
    };
  }, []);

  return (
    <View style={styles.root}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div
        ref={paperOverlayRef}
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
          opacity: LIGHT_PALETTE.paperOpacity,
        }}
      />
      <View style={styles.banner} pointerEvents="box-none">
        <View style={styles.bannerInner}>
          <Text style={styles.bannerText}>Phase 2 preview · crayon base</Text>
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
  root: { flex: 1, position: 'relative', backgroundColor: LIGHT_PALETTE.paper },
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
  bannerText: { fontSize: TYPE.small, color: '#3a352a', flex: 1 },
  backBtn: {
    backgroundColor: LIGHT_PALETTE.crayon,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  backText: { color: '#fff', fontSize: TYPE.small, fontWeight: '700' },
});
