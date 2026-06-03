import { useEffect, useId, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { LatLng } from '@shukajpes/shared';
import { useMaplibreMap } from './MapContext';
import { MapLibreMarker } from './MapLibreMarker';
import { api } from '../../services/api';
import { fetchWalkingRoute } from '../../services/directions';
import { useGameStore } from '../../stores/gameStore';
import { SYSTEM_FONT } from '../../constants/fonts';

// Long-press "sniff this place" gesture.
//
// Press and hold on the bare map (not on a marker, not on the dog).
// A semi-transparent crayon-blue circle expands from the press point
// over ~2.5 s. When the hold completes, the dog picks one nearby
// kyiv_lore entry and surfaces it: a marker at its position, a
// short story bubble, and a "let's go here" button that fires the
// normal walking-route flow.
//
// Re-press anywhere → new sniff, new pick. Past finds are added to
// excludeIds so the dog keeps surfacing new things within the
// session. Re-press over an existing discovery dismisses the
// previous one too (single discovery on screen at a time).

const HOLD_MS = 2400;
const MOVE_CANCEL_PX = 8;
const RADIUS_SEGMENTS = 48;
const EARTH_R = 6371000;
const MAX_RADIUS_M = 280;
const SNIFF_COLOR = '#2f6bff';

function circlePolygon(center: LatLng, radiusM: number): GeoJSON.Feature {
  const ring: [number, number][] = [];
  const latR = (center.lat * Math.PI) / 180;
  const lngR = (center.lng * Math.PI) / 180;
  const dR = radiusM / EARTH_R;
  for (let i = 0; i <= RADIUS_SEGMENTS; i++) {
    const bearing = (i / RADIUS_SEGMENTS) * 2 * Math.PI;
    const newLatR = Math.asin(
      Math.sin(latR) * Math.cos(dR) +
        Math.cos(latR) * Math.sin(dR) * Math.cos(bearing),
    );
    const newLngR =
      lngR +
      Math.atan2(
        Math.sin(bearing) * Math.sin(dR) * Math.cos(latR),
        Math.cos(dR) - Math.sin(latR) * Math.sin(newLatR),
      );
    ring.push([(newLngR * 180) / Math.PI, (newLatR * 180) / Math.PI]);
  }
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: {},
  };
}

interface DiscoveredLore {
  id: string;
  name: string;
  category: string;
  story: string;
  position: LatLng;
  distM: number;
}

export function SniffPress() {
  const map = useMaplibreMap();
  const uid = useId().replace(/[:]/g, '');
  const sourceId = useMemo(() => `sniff-${uid}`, [uid]);
  const fillId = `${sourceId}-fill`;
  const lineId = `${sourceId}-line`;

  // Animation state. progressRef avoids re-renders during the rAF
  // loop — only the React-tree updates that matter (discovered lore
  // surfacing) trigger re-renders.
  const pressLatLngRef = useRef<LatLng | null>(null);
  const startTRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const startPxRef = useRef<{ x: number; y: number } | null>(null);
  // Grace timer before showing the "sniffing…" bubble. A quick tap or
  // a pan that starts as a press shouldn't flash a sniffing label
  // for one frame.
  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const SNIFFING_BUBBLE_DELAY_MS = 350;

  const [discovered, setDiscovered] = useState<DiscoveredLore | null>(null);
  const [routing, setRouting] = useState(false);
  // Mirror of the press position for the React tree. While set, a
  // "sniffing…" bubble sits above the press point so the gesture
  // reads as in-progress rather than as nothing happening. Stays up
  // through the server fetch and only clears when we have something
  // to swap to (story bubble or empty-radius fallback).
  const [sniffingAt, setSniffingAt] = useState<LatLng | null>(null);
  const excludeRef = useRef<Set<string>>(new Set());
  const userPos = useGameStore((s) => s.userPosition);
  const setWalkRoute = useGameStore((s) => s.setWalkRoute);

  // Source + layer lifecycle. Created once when the map style is
  // ready, removed on unmount. Data is mutated in place during the
  // animation via setData.
  useEffect(() => {
    if (!map) return;
    const ensure = () => {
      if (map.getSource(sourceId)) return;
      map.addSource(sourceId, {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [[]] },
          properties: {},
        },
      });
      map.addLayer({
        id: fillId,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': SNIFF_COLOR,
          'fill-opacity': 0,
        },
      });
      map.addLayer({
        id: lineId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': SNIFF_COLOR,
          'line-opacity': 0,
          'line-width': 1.5,
        },
      });
    };
    if (map.isStyleLoaded()) ensure();
    else map.once('style.load', ensure);

    return () => {
      if (map.getLayer(lineId)) map.removeLayer(lineId);
      if (map.getLayer(fillId)) map.removeLayer(fillId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    };
  }, [map, sourceId, fillId, lineId]);

  // Gesture wiring. Bound to the maplibre map directly so we get the
  // lng/lat of the press for free and so MapLibre's pan/zoom gesture
  // detection still works on the same canvas.
  useEffect(() => {
    if (!map) return;

    const setRadius = (r: number, alpha: number) => {
      const ll = pressLatLngRef.current;
      if (!ll) return;
      const src = map.getSource(sourceId) as
        | maplibregl.GeoJSONSource
        | undefined;
      if (!src) return;
      src.setData(circlePolygon(ll, r));
      if (map.getLayer(fillId)) {
        map.setPaintProperty(fillId, 'fill-opacity', alpha * 0.16);
      }
      if (map.getLayer(lineId)) {
        map.setPaintProperty(lineId, 'line-opacity', alpha * 0.45);
      }
    };

    const cancelAnim = () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    const clearBubbleTimer = () => {
      if (bubbleTimerRef.current != null) {
        clearTimeout(bubbleTimerRef.current);
        bubbleTimerRef.current = null;
      }
    };

    const clearVisuals = () => {
      if (map.getLayer(fillId)) {
        map.setPaintProperty(fillId, 'fill-opacity', 0);
      }
      if (map.getLayer(lineId)) {
        map.setPaintProperty(lineId, 'line-opacity', 0);
      }
    };

    const finishHold = async () => {
      const ll = pressLatLngRef.current;
      pressLatLngRef.current = null;
      startPxRef.current = null;
      cancelAnim();
      clearBubbleTimer();
      // Tween the fill out and shrink slightly so the moment of
      // discovery reads as "found".
      clearVisuals();
      if (!ll) return;
      try {
        const exclude = Array.from(excludeRef.current);
        const { lore } = await api.discoverLore(ll.lat, ll.lng, exclude);
        if (lore) {
          excludeRef.current.add(lore.id);
          setDiscovered(lore);
          // Ease the map so the surfaced place lands in the centre of
          // the visible area — padding clears the HUD pills + tab bar
          // so the story bubble isn't sitting under an overlay. Same
          // tween shape as the walk-route / quest fits for consistency.
          map.easeTo({
            center: [lore.position.lng, lore.position.lat],
            padding: { top: 110, bottom: 200, left: 40, right: 40 },
            duration: 600,
          });
        } else {
          // Nothing within range — give a tiny prompt so the gesture
          // doesn't read as broken.
          setDiscovered({
            id: '__none__',
            name: 'тут поки тиша',
            category: 'none',
            story: '*ніс у землю* нічого знайомого. далі від цього кутка є щось — спробуй там.',
            position: ll,
            distM: 0,
          });
        }
      } catch {
        /* swallow — gesture is best-effort */
      } finally {
        setSniffingAt(null);
      }
    };

    const cancelHold = () => {
      pressLatLngRef.current = null;
      startPxRef.current = null;
      cancelAnim();
      clearBubbleTimer();
      clearVisuals();
      setSniffingAt(null);
    };

    const startHold = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      // Only press on the BARE canvas. If the underlying DOM target
      // is a marker or any other overlay, ignore.
      const target = e.originalEvent.target as HTMLElement | null;
      if (target && !target.classList.contains('maplibregl-canvas')) {
        return;
      }
      // Clear previous discovery before starting a new sniff.
      setDiscovered(null);
      const ll = { lat: e.lngLat.lat, lng: e.lngLat.lng };
      pressLatLngRef.current = ll;
      startPxRef.current = { x: e.point.x, y: e.point.y };
      startTRef.current = performance.now();
      // Delay the "sniffing…" bubble so quick taps + the first frames
      // of a pan don't flash a bubble. If the press is still alive
      // after the grace window, show it.
      clearBubbleTimer();
      bubbleTimerRef.current = setTimeout(() => {
        bubbleTimerRef.current = null;
        if (pressLatLngRef.current) setSniffingAt(ll);
      }, SNIFFING_BUBBLE_DELAY_MS);

      const tick = (t: number) => {
        const elapsed = t - startTRef.current;
        const k = Math.min(1, elapsed / HOLD_MS);
        // Ease-out so the early growth feels eager, then settles.
        const eased = 1 - Math.pow(1 - k, 1.6);
        setRadius(MAX_RADIUS_M * eased, eased);
        if (k >= 1) {
          rafRef.current = null;
          void finishHold();
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    };

    const onMove = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      const start = startPxRef.current;
      if (!start) return;
      const dx = e.point.x - start.x;
      const dy = e.point.y - start.y;
      if (dx * dx + dy * dy > MOVE_CANCEL_PX * MOVE_CANCEL_PX) cancelHold();
    };

    const onUp = () => {
      // Up before the timer fires = cancel. If finishHold has already
      // claimed the ref, this is a no-op.
      if (pressLatLngRef.current) cancelHold();
    };

    map.on('mousedown', startHold);
    map.on('touchstart', startHold);
    map.on('mousemove', onMove);
    map.on('touchmove', onMove);
    map.on('mouseup', onUp);
    map.on('touchend', onUp);
    map.on('dragstart', cancelHold);
    map.on('zoomstart', cancelHold);

    return () => {
      map.off('mousedown', startHold);
      map.off('touchstart', startHold);
      map.off('mousemove', onMove);
      map.off('touchmove', onMove);
      map.off('mouseup', onUp);
      map.off('touchend', onUp);
      map.off('dragstart', cancelHold);
      map.off('zoomstart', cancelHold);
      cancelAnim();
      clearBubbleTimer();
    };
  }, [map, sourceId, fillId, lineId]);

  const goHere = async () => {
    if (!discovered || !userPos || routing) return;
    if (discovered.id === '__none__') return;
    setRouting(true);
    try {
      const route = await fetchWalkingRoute(userPos, [discovered.position]);
      if (route) {
        setWalkRoute(route, { shape: 'oneway', spotId: null });
      }
    } finally {
      setRouting(false);
    }
  };

  if (sniffingAt && !discovered) {
    return <SniffingBubble position={sniffingAt} />;
  }
  if (!discovered) return null;
  return (
    <MapLibreMarker position={discovered.position} anchor="bottom">
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
          maxWidth: 260,
        }}
      >
        <div
          style={{
            padding: '8px 12px',
            background: '#ffffff',
            color: '#1a1a1a',
            borderRadius: 14,
            fontFamily: SYSTEM_FONT,
            fontSize: 13,
            lineHeight: 1.35,
            boxShadow: '0 4px 14px rgba(0,0,0,0.14)',
            border: '1px solid rgba(0,0,0,0.06)',
            textAlign: 'center',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 2 }}>{discovered.name}</div>
          <div>{discovered.story}</div>
        </div>
        {discovered.id !== '__none__' ? (
          <div
            role="button"
            onClick={(e) => {
              e.stopPropagation();
              void goHere();
            }}
            style={{
              cursor: 'pointer',
              padding: '6px 14px',
              background: SNIFF_COLOR,
              color: '#ffffff',
              borderRadius: 999,
              fontFamily: SYSTEM_FONT,
              fontSize: 12,
              fontWeight: 700,
              boxShadow: '0 4px 12px rgba(47,107,255,0.35)',
              userSelect: 'none',
              opacity: routing ? 0.6 : 1,
            }}
          >
            {routing ? 'sniffing route…' : "let's go here →"}
          </div>
        ) : null}
        {/* Small dot anchoring the bubble to the lat/lng. Round so it
            reads as a "place marker" without competing with the dog. */}
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: 5,
            background: SNIFF_COLOR,
            boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
          }}
        />
      </div>
    </MapLibreMarker>
  );
}

// Animated "sniffing…" bubble that sits above the press point while
// the radial scan is in progress. Same dot-cycle as the chat tab's
// typing indicator so the metaphor (dog is thinking) is consistent
// across surfaces.
function SniffingBubble({ position }: { position: LatLng }) {
  const [dots, setDots] = useState('.');
  useEffect(() => {
    const t = setInterval(() => {
      setDots((d) => (d.length >= 3 ? '.' : d + '.'));
    }, 380);
    return () => clearInterval(t);
  }, []);
  return (
    <MapLibreMarker position={position} anchor="bottom">
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            padding: '6px 12px',
            background: '#ffffff',
            color: '#1a1a1a',
            borderRadius: 14,
            fontFamily: SYSTEM_FONT,
            fontSize: 13,
            fontStyle: 'italic',
            boxShadow: '0 4px 14px rgba(0,0,0,0.12)',
            border: '1px solid rgba(0,0,0,0.06)',
          }}
        >
          sniffing{dots}
        </div>
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            background: SNIFF_COLOR,
            opacity: 0.7,
            boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
          }}
        />
      </div>
    </MapLibreMarker>
  );
}
