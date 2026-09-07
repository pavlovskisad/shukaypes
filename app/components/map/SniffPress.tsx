import { useEffect, useId, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { LatLng } from '@shukajpes/shared';
import { useMaplibreMap } from './MapContext';
import { MapLibreMarker } from './MapLibreMarker';
import { api } from '../../services/api';
import { fetchWalkingRouteOrLine } from '../../services/directions';
import { LoreMore } from './LoreMore';
import { useGameStore } from '../../stores/gameStore';
import { colors } from '../../constants/colors';
import { SYSTEM_FONT } from '../../constants/fonts';
import { R } from '../../constants/radius';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
import { Z } from '../../constants/z';
import { playPop } from '../../utils/popOnTap';
import { useStrings } from '../../i18n/useStrings';
import { VOICE } from '../../constants/voice';
import { INK, SURFACE } from '../../constants/surface';
import { HandDrawnFrame } from '../ui/HandDrawn';

// Long-press "sniff this place" gesture.
//
// Press and hold on the bare map (not on a marker, not on the dog).
// A semi-transparent crayon-blue circle expands from the press point
// over ~2.5 s. When the hold completes, the dog picks one nearby
// kyiv_lore entry and surfaces it: a marker at its position, a
// short story bubble with a "read more" under it (LoreMore.tsx), and
// a "let's go here" button that fires the normal walking-route flow.
//
// Re-press anywhere → new sniff, new pick. Past finds are added to
// excludeIds so the dog keeps surfacing new things within the
// session. Re-press over an existing discovery dismisses the
// previous one too (single discovery on screen at a time).

const HOLD_MS = 2400;
// Finger-jitter tolerance: the press only cancels if the touch
// travels more than this many pixels from where it started. Was 8 —
// felt too sensitive in practice (a small unintended drift breaks
// the gesture), bumped to 16 (~3-4mm on most screens, comfortably
// inside finger-jitter range).
const MOVE_CANCEL_PX = 16;
const RADIUS_SEGMENTS = 48;
const EARTH_R = 6371000;
const MAX_RADIUS_M = 280;
const SNIFF_COLOR = colors.sniffBlue;

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
  detail: string | null;
  wikipediaTitle: string | null;
  sourceLang: string | null;
  position: LatLng;
  distM: number;
}

export function SniffPress() {
  const map = useMaplibreMap();
  const t = useStrings();
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
  // Read-more state lives in LoreMore, keyed by the discovery's id so a
  // new find never inherits the last one's expanded article.
  // Mirror of the press position for the React tree. While set, a
  // "sniffing…" bubble sits above the press point so the gesture
  // reads as in-progress rather than as nothing happening. Stays up
  // through the server fetch and only clears when we have something
  // to swap to (story bubble or empty-radius fallback).
  const [sniffingAt, setSniffingAt] = useState<LatLng | null>(null);
  const excludeRef = useRef<Set<string>>(new Set());
  const userPos = useGameStore((s) => s.userPosition);
  const setWalkRoute = useGameStore((s) => s.setWalkRoute);

  // Tell the hint system the map is busy (sniffing or a discovery is
  // up) so it holds the next hint until the user is done reading.
  const setSniffActive = useGameStore((s) => s.setSniffActive);
  useEffect(() => {
    setSniffActive(!!discovered || !!sniffingAt);
  }, [discovered, sniffingAt, setSniffActive]);
  useEffect(() => () => setSniffActive(false), [setSniffActive]);

  // A discovery belongs to the mode it was sniffed in. Flipping to
  // supersniff (or back) used to leave the story bubble and its ring
  // hanging over the new view — the press was over, but nothing ever
  // told this component the world had changed underneath it. Skip the
  // first run so mounting doesn't count as a flip.
  const overlayEpoch = useGameStore((s) => s.overlayEpoch);
  const flipInitRef = useRef(true);
  useEffect(() => {
    if (flipInitRef.current) {
      flipInitRef.current = false;
      return;
    }
    setDiscovered(null);
    setSniffingAt(null);
    pressLatLngRef.current = null;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (bubbleTimerRef.current != null) {
      clearTimeout(bubbleTimerRef.current);
      bubbleTimerRef.current = null;
    }
    // The press ring is painted on the map itself, not in the React
    // tree, so clearing state alone would leave it burnt on.
    if (map?.getLayer(fillId)) map.setPaintProperty(fillId, 'fill-opacity', 0);
    if (map?.getLayer(lineId)) map.setPaintProperty(lineId, 'line-opacity', 0);
  }, [overlayEpoch, map, fillId, lineId]);

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

    // Lock the map's single-finger pan during a press so MapLibre's
    // dragstart (which fires on tiny finger jitter) can't cancel the
    // hold before our own MOVE_CANCEL_PX check adjudicates. Pinch
    // (touchZoomRotate) and wheel-zoom (scrollZoom) are LEFT enabled
    // — disabling them broke two-finger zoom entirely. Pinch starts
    // are caught separately in startHold via the touch-count guard.
    const lockMapGestures = () => {
      map.dragPan.disable();
    };
    const unlockMapGestures = () => {
      map.dragPan.enable();
    };

    const finishHold = async () => {
      const ll = pressLatLngRef.current;
      pressLatLngRef.current = null;
      startPxRef.current = null;
      cancelAnim();
      clearBubbleTimer();
      unlockMapGestures();
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
          // Place the find a touch BELOW screen centre. Its story
          // bubble stacks ABOVE the marker, so centring the marker (or
          // worse, the old top-biased padding) pushed the bubble up
          // under the HUD and clipped the text. A small downward offset
          // lands the whole result in the upper-centre, clear of the
          // HUD. Reset any padding a prior snap left so the offset is
          // measured from the true viewport centre.
          map.easeTo({
            center: [lore.position.lng, lore.position.lat],
            padding: { top: 0, bottom: 0, left: 0, right: 0 },
            offset: [0, 70],
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
            detail: null,
            wikipediaTitle: null,
            sourceLang: null,
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
      unlockMapGestures();
    };

    const startHold = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      // The gate makes the map inert, and that has to include the press —
      // a long hold on a screen that is asking you a question should not
      // send the dog off sniffing a landmark behind the ring.
      if (useGameStore.getState().appMode === 'gate') return;
      // Multi-touch (a pinch-zoom starting) must NOT trigger a hold —
      // the second finger landing should let MapLibre's pinch handler
      // take over. Bail out early for any touch event with > 1 finger.
      const oe = e.originalEvent;
      if ('touches' in oe && oe.touches.length > 1) {
        return;
      }
      // Only press on the BARE canvas. If the underlying DOM target
      // is a marker or any other overlay, ignore.
      const target = oe.target as HTMLElement | null;
      if (target && !target.classList.contains('maplibregl-canvas')) {
        return;
      }
      // Clear previous discovery before starting a new sniff.
      setDiscovered(null);
      const ll = { lat: e.lngLat.lat, lng: e.lngLat.lng };
      pressLatLngRef.current = ll;
      startPxRef.current = { x: e.point.x, y: e.point.y };
      startTRef.current = performance.now();
      // NB: dragPan stays ENABLED during the 0-200ms "is this a
      // press or a swipe?" window. If the user is swiping, MapLibre's
      // dragstart fires and our cancelHold listener bows out cleanly.
      // Only once the bubble timer fires (= commitment threshold)
      // do we lock dragPan so the visualisation isn't pulled out
      // from under the user mid-hold.
      clearBubbleTimer();
      bubbleTimerRef.current = setTimeout(() => {
        bubbleTimerRef.current = null;
        if (pressLatLngRef.current) {
          setSniffingAt(ll);
          lockMapGestures();
        }
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
      // Second finger arrived → user wants to pinch-zoom, not sniff.
      // Cancel cleanly so MapLibre's touchZoomRotate can take over.
      const oe = e.originalEvent;
      if ('touches' in oe && oe.touches.length > 1) {
        cancelHold();
        return;
      }
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
      // Guard against unmounting mid-press leaving the map's drag /
      // zoom gestures permanently disabled.
      unlockMapGestures();
    };
  }, [map, sourceId, fillId, lineId]);

  const goHere = async () => {
    if (!discovered || !userPos || routing) return;
    if (discovered.id === '__none__') return;
    setRouting(true);
    try {
      // Falls back to a straight line when Google can't route, so
      // "ходімо сюди" always puts something on the map — the place we
      // are pointing at is ours, only the way there was Google's.
      const line = await fetchWalkingRouteOrLine(userPos, [discovered.position]);
      if (line) setWalkRoute(line, { shape: 'oneway', spotId: null });
    } finally {
      setRouting(false);
    }
  };

  if (sniffingAt && !discovered) {
    return <SniffingBubble position={sniffingAt} />;
  }
  if (!discovered) return null;
  return (
    <MapLibreMarker position={discovered.position} anchor="bottom" zIndex={Z.HUD_SNIFF_BUBBLE}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: S.s,
          maxWidth: 260,
        }}
      >
        <div
          style={{
            // Bumped to match the chunkier SpeechBubble family —
            // padding 8/12 → 12/14, radius 14 → 22, type 13/1.35
            // → 16/1.4.
            padding: '12px 14px',
            // White paper, not the dog's dark voice — see the note in
            // this file's header. This panel carries a place you can
            // walk to and a button to do it.
            background: SURFACE.fill,
            color: INK,
            borderRadius: R.card,
            fontFamily: VOICE.fontFamily,
            fontSize: TYPE.body,
            lineHeight: 1.4,
            boxShadow: SURFACE.shadow,
            position: 'relative',
            textAlign: 'center',
          }}
        >
          {/* Drawn edge — see HandDrawn.tsx. */}
          <HandDrawnFrame radius={R.card} />
          <div style={{ fontWeight: 700, marginBottom: 2 }}>{discovered.name}</div>
          <div>{discovered.story}</div>
          {discovered.id !== '__none__' ? (
            <LoreMore key={discovered.id} lore={discovered} tone="paper" />
          ) : null}
        </div>
        {discovered.id !== '__none__' ? (
          <div
            role="button"
            onClick={(e) => {
              e.stopPropagation();
              playPop(e.currentTarget);
              void goHere();
            }}
            style={{
              cursor: 'pointer',
              // Bigger CTA pill to match the rest of the action
              // buttons across the app — padding 6/14 → 10/18,
              // type 12 → 14.
              padding: '10px 18px',
              // Ink, not sniff-blue. This one survived the first pass
              // because it lives on a map marker rather than in a modal,
              // but it is a button, and blue here means the circle and
              // the dot below it — the place being pointed at — not the
              // thing you tap.
              background: INK,
              color: '#ffffff',
              borderRadius: R.button,
              // Ink on ink — kept for the height, never seen.
              border: SURFACE.hair,
              fontFamily: SYSTEM_FONT,
              fontSize: TYPE.small,
              fontWeight: 700,
              boxShadow: SURFACE.shadow,
              userSelect: 'none',
              opacity: routing ? 0.6 : 1,
            }}
          >
            {routing ? t.sniff.sniffingRoute : t.sniff.letsGoHere}
          </div>
        ) : null}
        {/* Small dot anchoring the bubble to the lat/lng. Round so it
            reads as a "place marker" without competing with the dog. */}
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: R.pill,
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
  const t = useStrings();
  // Strip any static trailing ellipsis from the i18n label so the
  // animated "." → ".." → "..." cycle doesn't double up.
  const sniffingBase = t.sniff.sniffing.replace(/[.…]+$/, '');
  useEffect(() => {
    const id = setInterval(() => {
      setDots((d) => (d.length >= 3 ? '.' : d + '.'));
    }, 380);
    return () => clearInterval(id);
  }, []);
  return (
    <MapLibreMarker
      position={position}
      anchor="bottom"
      // Lift the bubble ~60 px above the press point so it clears the
      // finger holding the screen. The expanding radial fill already
      // anchors the gesture visually; the small dot we used to render
      // here was redundant once that fill is in.
      offset={[0, -60]}
      zIndex={Z.HUD_SNIFF_BUBBLE}
    >
      <div
        style={{
          // Sniffing indicator — same family as the discovery
          // bubble above (12/14 padding, 22 radius, 16 type).
          padding: '12px 14px',
          background: VOICE.background,
          color: VOICE.color,
          borderRadius: R.chip,
          fontFamily: VOICE.fontFamily,
          fontSize: TYPE.body,
          fontStyle: 'italic',
          boxShadow: VOICE.shadow,
          border: VOICE.border,
          pointerEvents: 'none',
        }}
      >
        {sniffingBase}{dots}
      </div>
    </MapLibreMarker>
  );
}
