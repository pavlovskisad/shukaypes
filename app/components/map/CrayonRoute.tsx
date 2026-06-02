import { useEffect, useId, useMemo, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import type { LatLng } from '@shukajpes/shared';
import { useMaplibreMap } from './MapContext';

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

interface CrayonRouteProps {
  path: LatLng[];
  color?: string;
  weight?: number;
  opacity?: number;
}

// Subdivide segments at this many meters so there are enough vertices
// to show the per-vertex jitter as a continuous wobble rather than a
// step every block.
const MAX_SEG_M = 8;
// Max perpendicular jitter per inserted vertex, in meters. ~1 m gives
// a hand-drawn wobble without making the route ambiguous about which
// street it follows.
const JITTER_M = 1.1;

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

export function CrayonRoute({
  path,
  color = '#2f6bff',
  weight = 9,
  opacity = 0.8,
}: CrayonRouteProps) {
  const map = useMaplibreMap();
  const uid = useId().replace(/[:]/g, '');
  const sourceId = useMemo(() => `route-${uid}`, [uid]);
  const layerId = `${sourceId}-line`;
  // Only autofit ONCE per route instance — re-centering on every prop
  // change would fight the user if they panned to read the route in
  // detail and a tick later we re-flew them home.
  const didFitRef = useRef(false);

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
        }
        return;
      }
      map.addSource(sourceId, { type: 'geojson', data });
      map.addLayer({
        id: layerId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': color,
          'line-width': weight,
          'line-opacity': opacity,
          // Soft pencil edge — keeps the crayon feel without the
          // expensive SVG filter the old implementation used.
          'line-blur': 0.6,
        },
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
      });
    };

    // Once the layer is on the map, ease the view to fit the route.
    // Padding clears the top HUD pills, the bottom tab bar, and gives
    // the side a touch of breathing room. minZoom respects the global
    // floor so a tiny round-trip doesn't slam the map all the way in.
    const fitOnce = () => {
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
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    };
  }, [map, path, color, weight, opacity, sourceId, layerId]);

  return null;
}
