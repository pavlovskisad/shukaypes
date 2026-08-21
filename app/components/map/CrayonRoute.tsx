import { useEffect, useId, useMemo, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import type { LatLng } from '@shukajpes/shared';
import { useMaplibreMap } from './MapContext';
import { colors } from '../../constants/colors';

// Hand-drawn walking route — rendered as a NATIVE MapLibre line layer
// off a GeoJSON source. Earlier versions painted an absolute-positioned
// SVG inside the canvas container, repositioned per `move` event. That
// approach drifted under pitch/pan because the SVG was cached in pixel
// space while the map was redrawing in lat/lng space; routes also
// painted above markers in DOM order.
//
// Going through MapLibre's own pipeline fixes both: the line is part
// of the same WebGL frame as the basemap (never drifts), and we insert
// it BEFORE marker layers so the dog and pins stay on top.
//
// "Crayon" character comes from pre-jittering the polyline vertices
// with a deterministic seed (same path → same wobble, no flicker) and
// a small line-blur for soft pencil edges.

// THE DEFAULTS BELOW ARE THE HOUSE ROUTE STYLE, and every route in the
// app is expected to take them: a planned walk, a detective quest, the
// line the dog leads you along in supersniff. They were three different
// weights and opacities on the same blue once, which read as three
// unrelated things rather than as one app speaking consistently.
//
// Override only with a reason worth writing down next to it.
interface CrayonRouteProps {
  path: LatLng[];
  color?: string;
  weight?: number;
  opacity?: number;
  // Default true — the route fits the camera to itself on first
  // render. Quests pass false because MapView does its own fit that
  // also includes the user position, so the dog can see themselves
  // relative to the quest waypoints.
  autoFit?: boolean;
  // Draw the line broken rather than solid — the product reference's
  // chunky dashes, and now how every route is drawn. Kept as a prop
  // rather than hard-wired so a solid line stays one word away if some
  // future route earns one.
  dashed?: boolean;
}

// Subdivide segments at this many meters so there are enough vertices
// to show the per-vertex jitter as a continuous wobble rather than a
// step every block.
const MAX_SEG_M = 8;
// Max perpendicular jitter per inserted vertex, in meters. ~1 m gives
// a hand-drawn wobble without making the route ambiguous about which
// street it follows.
const JITTER_M = 1.1;

// Blur on a SOLID route — the soft pencil edge. Dashed routes use 0.
const SOLID_BLUR = 0.6;

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function seedFor(path: LatLng[]): number {
  const a = path[0]!;
  const b = path[path.length - 1]!;
  return Math.abs(Math.floor((a.lat + a.lng + b.lat + b.lng) * 1000)) % 100000;
}

// Approx meters-per-degree at a given latitude. Flat-earth fine for
// our scale (one walking route in one city).
function metersPerDegLat(): number {
  return 111320;
}
function metersPerDegLng(lat: number): number {
  return 111320 * Math.cos((lat * Math.PI) / 180);
}

function jitteredCoords(path: LatLng[]): GeoJSON.Position[] {
  if (path.length < 2) return path.map((p) => [p.lng, p.lat]);
  const r = rng(seedFor(path));
  const out: GeoJSON.Position[] = [];
  out.push([path[0]!.lng, path[0]!.lat]);
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const midLat = (a.lat + b.lat) / 2;
    const mLat = metersPerDegLat();
    const mLng = metersPerDegLng(midLat);
    const dxM = (b.lng - a.lng) * mLng;
    const dyM = (b.lat - a.lat) * mLat;
    const lenM = Math.hypot(dxM, dyM);
    if (lenM < 1e-3) continue;
    const steps = Math.max(1, Math.floor(lenM / MAX_SEG_M));
    // Unit perpendicular (in meter space) — rotate the unit tangent
    // 90° so jitter shifts the route sideways, not along its length.
    const ux = dxM / lenM;
    const uy = dyM / lenM;
    const perpX = -uy;
    const perpY = ux;
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      // Skip end-vertex jitter — keep endpoints clean so the route
      // starts on the dog and ends on the destination pin.
      const isEnd = k === steps;
      const j = isEnd ? 0 : (r() - 0.5) * 2 * JITTER_M;
      const offLng = (perpX * j) / mLng;
      const offLat = (perpY * j) / mLat;
      const lat = a.lat + (b.lat - a.lat) * t + offLat;
      const lng = a.lng + (b.lng - a.lng) * t + offLng;
      out.push([lng, lat]);
    }
  }
  return out;
}

// How long the line takes to draw itself from the dog to the
// destination. Exported because WalkStops paces its dots against this:
// a stop pops when the line reaches it, which only reads as one motion
// if both sides agree on the clock.
// 900ms was over before the eye had followed it — the line arrived
// rather than being drawn, and the stops popping along it read as a
// single burst near the start. Longer lets the dots arrive one at a
// time, which is the point of pacing them against the line at all.
export const ROUTE_DRAW_MS = 1500;

// Near-overhead while a route is on screen. Not a flat 0: a little tilt
// keeps the city readable as a place rather than a diagram.
export const ROUTE_VIEW_PITCH = 20;

function prefixCoords(coords: number[][], t: number): number[][] {
  if (t >= 1 || coords.length < 2) return coords;
  const span = (coords.length - 1) * t;
  const whole = Math.floor(span);
  const frac = span - whole;
  const head = coords.slice(0, whole + 1);
  const a = coords[whole];
  const b = coords[whole + 1];
  if (a && b && frac > 0) {
    head.push([a[0]! + (b[0]! - a[0]!) * frac, a[1]! + (b[1]! - a[1]!) * frac]);
  }
  // A LineString needs two positions; below that MapLibre drops the
  // feature and the line flickers out on the first frame.
  return head.length >= 2 ? head : coords.slice(0, 2);
}

export function CrayonRoute({
  path,
  color = colors.routeLine,
  // 7.2 rather than a round number because it is 9 × 0.8 — the line
  // read as too heavy at 9 on a phone. The dash pattern is expressed in
  // LINE WIDTHS, so the marks and gaps narrowed with it and the rhythm
  // is unchanged.
  weight = 7.2,
  opacity = 0.95,
  autoFit = true,
  dashed = true,
}: CrayonRouteProps) {
  const map = useMaplibreMap();
  const uid = useId().replace(/[:]/g, '');
  const sourceId = useMemo(() => `route-${uid}`, [uid]);
  const layerId = `${sourceId}-line`;
  // Dash lengths are in LINE WIDTHS, not pixels, so this reads the same
  // at any weight the callers pass. Roughly square marks with a gap a
  // touch under them: the line still reads as one route at a glance,
  // but you can see it is made of marks. Only meaningful with butt caps
  // — see the layout block below.
  const dashPattern = useMemo(
    () => (dashed ? [1.1, 0.85] : undefined),
    [dashed],
  );
  // Only autofit ONCE per route instance — re-centering on every prop
  // change would fight the user if they panned to read the route in
  // detail and a tick later we re-flew them home.
  const didFitRef = useRef(false);
  // Which path we have already drawn. A colour or weight change must
  // not replay the draw — only a genuinely new route does.
  const drawnRef = useRef<CrayonRouteProps['path'] | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!map || path.length < 2) return;
    const coords = jitteredCoords(path);
    const data: GeoJSON.Feature = {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: {},
    };

    // Place the route ABOVE basemap layers but BELOW our injected
    // building outline + the first marker layer — markers themselves
    // are DOM elements layered separately, so all we need to do is
    // not jump above other LINE layers in the style. Passing no
    // `before` argument appends to the top of the style stack; the
    // DOM layering then keeps markers on top automatically.
    // Draw the line on from its start. Runs once per route: `drawnRef`
    // is set before the first frame so a re-render mid-animation does
    // not restart it from zero.
    const animateDraw = () => {
      const src = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      const startedAt = performance.now();
      const frame = () => {
        const raw = Math.min(1, (performance.now() - startedAt) / ROUTE_DRAW_MS);
        // Ease-out: quick off the mark, settling into the destination,
        // which is how a finger draws a line and how the dog's own
        // camera eases already behave.
        const t = 1 - Math.pow(1 - raw, 3);
        src.setData({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: prefixCoords(coords, t) },
          properties: {},
        } as GeoJSON.Feature);
        rafRef.current = raw < 1 ? requestAnimationFrame(frame) : null;
      };
      rafRef.current = requestAnimationFrame(frame);
    };

    const add = () => {
      const existing = map.getSource(sourceId) as
        | maplibregl.GeoJSONSource
        | undefined;
      if (existing) {
        existing.setData(data);
        if (map.getLayer(layerId)) {
          map.setPaintProperty(layerId, 'line-color', color);
          map.setPaintProperty(layerId, 'line-width', weight);
          map.setPaintProperty(layerId, 'line-opacity', opacity);
          map.setPaintProperty(layerId, 'line-blur', dashed ? 0 : SOLID_BLUR);
          // undefined clears the dash back to solid, so a route
          // re-rendered as a different kind doesn't keep the wrong one.
          map.setPaintProperty(layerId, 'line-dasharray', dashPattern);
          map.setLayoutProperty(layerId, 'line-cap', dashed ? 'butt' : 'round');
        }
        return;
      }
      const fresh = drawnRef.current !== path;
      map.addSource(sourceId, {
        type: 'geojson',
        // Start as a stub the length of one segment when this is a new
        // route; the rAF below grows it. An existing route (a remount
        // from a style reload, say) goes straight to full so the line
        // does not redraw itself every time the map reloads.
        data: fresh
          ? ({
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: coords.slice(0, 2) },
              properties: {},
            } as GeoJSON.Feature)
          : data,
      });
      map.addLayer({
        id: layerId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': color,
          'line-width': weight,
          'line-opacity': opacity,
          // Soft pencil edge — keeps the crayon feel without the
          // expensive SVG filter the old implementation used. A DASHED
          // line gets none: blur on a short dash eats its ends and the
          // whole pattern turns to mush.
          'line-blur': dashed ? 0 : SOLID_BLUR,
          ...(dashPattern ? { 'line-dasharray': dashPattern } : {}),
        },
        layout: {
          // BUTT CAPS ON A DASHED LINE, and this is not cosmetic. A round
          // cap extends every dash by half the line width at BOTH ends —
          // at weight 9 that is +9 px of ink per dash against an ~8 px
          // gap, so the caps meet in the middle and the "dashes" render
          // as one solid line with bulges. Round caps are right for a
          // solid route and fatal for a dashed one.
          'line-cap': dashed ? 'butt' : 'round',
          'line-join': 'round',
        },
      });
      if (fresh) {
        drawnRef.current = path;
        animateDraw();
      }
    };

    // Once the layer is on the map, ease the view to fit the route.
    // Padding clears the top HUD pills, the bottom tab bar, and gives
    // the side a touch of breathing room. minZoom respects the global
    // floor so a tiny round-trip doesn't slam the map all the way in.
    const fitOnce = () => {
      if (!autoFit) return;
      if (didFitRef.current) return;
      didFitRef.current = true;
      const bounds = coords.reduce(
        (b, [lng, lat]) => b.extend([lng, lat]),
        new maplibregl.LngLatBounds(
          coords[0] as [number, number],
          coords[0] as [number, number],
        ),
      );
      map.fitBounds(bounds, {
        padding: { top: 110, bottom: 130, left: 40, right: 40 },
        maxZoom: 17,
        duration: 700,
        // Helicopter view. The map normally sits pitched for the 3D
        // buildings, which is the right look for walking but the wrong
        // one for reading a route: a tilted street turns every stop dot
        // into an ellipse near the horizon, small and awkward to hit.
        // Flattening toward overhead for the duration of the route puts
        // the whole shape on screen and gives every dot its full
        // diameter as a tap target.
        pitch: ROUTE_VIEW_PITCH,
      });
    };

    if (map.isStyleLoaded()) {
      add();
      fitOnce();
    } else {
      map.once('style.load', () => {
        add();
        fitOnce();
      });
    }

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    };
  }, [map, path, color, weight, opacity, sourceId, layerId, autoFit, dashed, dashPattern]);

  return null;
}
