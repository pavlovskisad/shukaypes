// Territory rendering — the dog's marks, and the ground they enclose.
//
// The first cut drew a soft heat-glow over owned cells. It looked like
// weather: you couldn't tell where a claim started, why it was there, or
// how one patch related to the next. This version draws the mechanic
// instead of an impression of it:
//
//   • a DOT wherever the dog actually marked
//   • a solid FILL over every cell you own
//
// Territory is a function of the MARKS, not of the route walked between
// them — three marks near each other enclose a triangle of ground, and
// every mark after that grows the shape. So the story reads off the map
// directly: dots appear, and the ground between them fills in.
//
// Deliberately NO line joining the marks in walk order. An earlier cut
// drew one, and it implied the path mattered — which sent the eye looking
// for a loop to close instead of just watching the shape grow.
//
// The fill is the ACTUAL hull of the marks, not the ownership cells. An
// earlier cut drew the cells as squares and it came out as blocky
// rectangles bolted around each dot — nothing like the clean triangle
// three marks ought to enclose. Cells remain the ownership truth
// server-side (they're what stealing will operate on); this draws the
// shape a person would draw.

import { useEffect, useMemo } from 'react';
import type maplibregl from 'maplibre-gl';
import { useMaplibreMap } from './MapContext';
import type { TerritoryMark, TerritoryShape } from '../../services/api';

const AREA_SOURCE = 'territory-area-src';
const AREA_FILL = 'territory-area-fill';
const AREA_EDGE = 'territory-area-edge';
const LINK_SOURCE = 'territory-link-src';
const LINK_LAYER = 'territory-link';
const DOTS_SOURCE = 'territory-dots-src';
const DOTS_LAYER = 'territory-dots';

// Cool sky blue — cyan-ward of the search blue (#2f6bff) so territory and
// the lost-pet beacon stay distinguishable when both are on screen.
const BLUE = '#38bdf8';
const BLUE_DEEP = '#0ea5e9';

function areaGeoJSON(shapes: TerritoryShape[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: shapes
      .filter((s) => s.kind === 'area' && s.points.length >= 3)
      .map((s) => ({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          // GeoJSON rings must close explicitly.
          coordinates: [
            [...s.points.map((p) => [p.lng, p.lat]), [s.points[0]!.lng, s.points[0]!.lat]],
          ],
        },
        properties: {},
      })),
  };
}

// Two marks are a link, not a territory: drawn as a bare line so it's
// visible that they're related and that a third mark would close a shape.
function linkGeoJSON(shapes: TerritoryShape[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: shapes
      .filter((s) => s.kind === 'line' && s.points.length >= 2)
      .map((s) => ({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: s.points.map((p) => [p.lng, p.lat]),
        },
        properties: {},
      })),
  };
}

function dotsGeoJSON(marks: TerritoryMark[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: marks.map((m) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [m.lng, m.lat] },
      properties: { r: m.closedLoop ? 6.5 : 4.5 },
    })),
  };
}

export function TerritoryLayer({
  shapes,
  marks,
}: {
  shapes: TerritoryShape[];
  marks: TerritoryMark[];
}) {
  const map = useMaplibreMap();
  // The store hands us fresh array references every 15s sync even when
  // nothing changed; re-uploading geometry each tick would stutter the 3D
  // city. Signatures keep uploads to real changes.
  const shapeSig = useMemo(
    () =>
      shapes
        .map((s) => `${s.kind}:${s.points.map((p) => p.lat.toFixed(5)).join('|')}`)
        .join(','),
    [shapes],
  );
  const markSig = useMemo(
    () => marks.map((m) => `${m.lat.toFixed(5)},${m.lng.toFixed(5)}`).join(','),
    [marks],
  );

  useEffect(() => {
    if (!map) return;
    const areas = areaGeoJSON(shapes);
    const links = linkGeoJSON(shapes);
    const dots = dotsGeoJSON(marks);

    const apply = () => {
      const setOr = (id: string, data: GeoJSON.FeatureCollection): boolean => {
        const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
        if (src) {
          src.setData(data);
          return true;
        }
        map.addSource(id, { type: 'geojson', data });
        return false;
      };

      if (!setOr(AREA_SOURCE, areas)) {
        map.addLayer({
          id: AREA_FILL,
          type: 'fill',
          source: AREA_SOURCE,
          paint: { 'fill-color': BLUE, 'fill-opacity': 0.28 },
        });
        map.addLayer({
          id: AREA_EDGE,
          type: 'line',
          source: AREA_SOURCE,
          layout: { 'line-join': 'round' },
          paint: { 'line-color': BLUE_DEEP, 'line-width': 2, 'line-opacity': 0.75 },
        });
      }

      if (!setOr(LINK_SOURCE, links)) {
        map.addLayer({
          id: LINK_LAYER,
          type: 'line',
          source: LINK_SOURCE,
          layout: { 'line-cap': 'round' },
          paint: {
            'line-color': BLUE_DEEP,
            'line-width': 2,
            'line-opacity': 0.5,
            'line-dasharray': [2, 2],
          },
        });
      }

      if (!setOr(DOTS_SOURCE, dots)) {
        map.addLayer({
          id: DOTS_LAYER,
          type: 'circle',
          source: DOTS_SOURCE,
          paint: {
            'circle-radius': ['get', 'r'],
            'circle-color': BLUE_DEEP,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
          },
        });
      }
    };

    if (map.isStyleLoaded()) apply();
    else map.once('style.load', apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, shapeSig, markSig]);

  // Tear everything down on unmount (tab switch / mode change) so nothing
  // lingers over another screen's map.
  useEffect(() => {
    if (!map) return;
    return () => {
      try {
        for (const id of [AREA_FILL, AREA_EDGE, LINK_LAYER, DOTS_LAYER]) {
          if (map.getLayer(id)) map.removeLayer(id);
        }
        for (const id of [AREA_SOURCE, LINK_SOURCE, DOTS_SOURCE]) {
          if (map.getSource(id)) map.removeSource(id);
        }
      } catch {
        /* map already tearing down */
      }
    };
  }, [map]);

  return null;
}
