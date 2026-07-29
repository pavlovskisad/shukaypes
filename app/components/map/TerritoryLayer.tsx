// Territory rendering — dots, the line joining them, and the ground you
// enclosed.
//
// The first cut drew a soft heat-glow over owned cells. It looked like
// weather: you couldn't tell where a claim started, why it was there, or
// how one patch related to the next. This version draws the mechanic
// instead of an impression of it:
//
//   • a DOT wherever the dog actually marked
//   • a LINE joining them in the order you walked
//   • a solid FILL over every cell you own
//
// So the story reads off the map directly: dots appear, the line grows,
// and the moment it loops back on itself the enclosed block floods blue.
//
// The fill is drawn from the ownership cells themselves — real squares,
// not a blur — so what you see is exactly what the server says you own.
// Adjacent cells share edges exactly, so they merge into one clean shape
// with no seams and no dissolve step.

import { useEffect, useMemo } from 'react';
import type maplibregl from 'maplibre-gl';
import { useMaplibreMap } from './MapContext';
import type { TerritoryCell, TerritoryMark } from '../../services/api';

const FILL_SOURCE = 'territory-fill-src';
const FILL_LAYER = 'territory-fill';
const EDGE_LAYER = 'territory-edge';
const CHAIN_SOURCE = 'territory-chain-src';
const CHAIN_LAYER = 'territory-chain';
const DOTS_SOURCE = 'territory-dots-src';
const DOTS_LAYER = 'territory-dots';

// Cool sky blue — cyan-ward of the search blue (#2f6bff) so territory and
// the lost-pet beacon stay distinguishable when both are on screen.
const BLUE = '#38bdf8';
const BLUE_DEEP = '#0ea5e9';

// Grid constants, mirrored from the server's utils/territoryGrid.ts. The
// cell id encodes its indices, so corners are derived rather than sent —
// and derived with the SAME band formula, so squares tile exactly and the
// fill has no hairline seams between them.
const CELL_M = 110;
const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LNG_EQ = 111320;
const LAT_STEP = CELL_M / M_PER_DEG_LAT;

function lngStepForBand(latIdx: number): number {
  const bandLat = (latIdx + 0.5) * LAT_STEP;
  const cos = Math.max(0.05, Math.cos((bandLat * Math.PI) / 180));
  return CELL_M / (M_PER_DEG_LNG_EQ * cos);
}

function cellSquare(cellId: string): [number, number][] | null {
  const dot = cellId.indexOf('.');
  if (dot < 0) return null;
  const latIdx = Number(cellId.slice(0, dot));
  const lngIdx = Number(cellId.slice(dot + 1));
  if (!Number.isFinite(latIdx) || !Number.isFinite(lngIdx)) return null;
  const lngStep = lngStepForBand(latIdx);
  const s = latIdx * LAT_STEP;
  const n = (latIdx + 1) * LAT_STEP;
  const w = lngIdx * lngStep;
  const e = (lngIdx + 1) * lngStep;
  return [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
    [w, s],
  ];
}

function fillGeoJSON(cells: TerritoryCell[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const c of cells) {
    // Optimistic client-side cells (added the instant the dog marks, before
    // the server's own list arrives) carry no real cell id — skip them here
    // rather than drawing a square in the wrong place.
    const ring = cellSquare(c.cellId);
    if (!ring) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      // Faded ground draws thinner, so the map shows you where to walk again.
      properties: { o: Math.max(0.12, Math.min(0.4, (c.strength / 100) * 0.4)) },
    });
  }
  return { type: 'FeatureCollection', features };
}

function chainGeoJSON(marks: TerritoryMark[]): GeoJSON.FeatureCollection {
  if (marks.length < 2) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: marks.map((m) => [m.lng, m.lat]),
        },
        properties: {},
      },
    ],
  };
}

function dotsGeoJSON(marks: TerritoryMark[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: marks.map((m) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [m.lng, m.lat] },
      // The mark that closed a ring reads a touch bigger — it's the one
      // that won you the block.
      properties: { r: m.closedLoop ? 7 : 4.5 },
    })),
  };
}

export function TerritoryLayer({
  cells,
  marks,
}: {
  cells: TerritoryCell[];
  marks: TerritoryMark[];
}) {
  const map = useMaplibreMap();
  // The store hands us fresh array references every 15s sync even when
  // nothing changed; re-uploading hundreds of polygons each tick would
  // stutter the 3D city. Signatures keep the uploads to real changes.
  const cellSig = useMemo(
    () => cells.map((c) => `${c.cellId}:${c.strength}`).join(','),
    [cells],
  );
  const markSig = useMemo(
    () => marks.map((m) => `${m.lat.toFixed(5)},${m.lng.toFixed(5)}`).join(','),
    [marks],
  );

  useEffect(() => {
    if (!map) return;
    const fill = fillGeoJSON(cells);
    const chain = chainGeoJSON(marks);
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

      if (!setOr(FILL_SOURCE, fill)) {
        // Claimed ground: flat translucent blue, per-feature opacity from
        // strength. No outline on the squares themselves — only the shape's
        // outer edge is drawn (below), so a region reads as one area rather
        // than a grid.
        map.addLayer({
          id: FILL_LAYER,
          type: 'fill',
          source: FILL_SOURCE,
          paint: { 'fill-color': BLUE, 'fill-opacity': ['get', 'o'] },
        });
        map.addLayer({
          id: EDGE_LAYER,
          type: 'line',
          source: FILL_SOURCE,
          paint: {
            'line-color': BLUE_DEEP,
            'line-width': 1,
            // Very faint: interior seams between neighbouring cells would
            // otherwise draw the grid we're trying to hide.
            'line-opacity': 0.18,
          },
        });
      }

      if (!setOr(CHAIN_SOURCE, chain)) {
        map.addLayer({
          id: CHAIN_LAYER,
          type: 'line',
          source: CHAIN_SOURCE,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': BLUE_DEEP, 'line-width': 3, 'line-opacity': 0.85 },
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
  }, [map, cellSig, markSig]);

  // Tear everything down on unmount (tab switch / mode change) so nothing
  // lingers over another screen's map.
  useEffect(() => {
    if (!map) return;
    return () => {
      try {
        for (const id of [FILL_LAYER, EDGE_LAYER, CHAIN_LAYER, DOTS_LAYER]) {
          if (map.getLayer(id)) map.removeLayer(id);
        }
        for (const id of [FILL_SOURCE, CHAIN_SOURCE, DOTS_SOURCE]) {
          if (map.getSource(id)) map.removeSource(id);
        }
      } catch {
        /* map already tearing down */
      }
    };
  }, [map]);

  return null;
}
