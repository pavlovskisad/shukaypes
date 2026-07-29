// Territory rendering — your dog's scent on the city.
//
// The server resolves ownership on a ~110 m grid, but drawing those cells
// as polygons would put a boardgame overlay on a map we've spent a long
// time keeping clean. So the cells never render as cells: each one feeds
// a MapLibre HEATMAP layer as a weighted point, and the layer's own
// falloff blends neighbouring cells into one soft blob. Grid underneath
// for the logic, scent on top for the eye.
//
// Weight is the cell's live strength, so freshly-marked ground reads
// solid while a claim that's been left to fade goes thin and patchy —
// the map itself tells you where you need to walk again.

import { useEffect, useMemo } from 'react';
import type maplibregl from 'maplibre-gl';
import { useMaplibreMap } from './MapContext';
import type { TerritoryCell } from '../../services/api';

const SOURCE_ID = 'territory-src';
const LAYER_ID = 'territory-heat';

// Cool sky-blue. The first cut used the brand lime, which on a pale map
// read exactly like what a dog actually leaves behind — technically
// on-theme, aesthetically not. Blue reads as clean scent-mist instead.
// Shifted noticeably cyan-ward of the search blue (#2f6bff) so territory
// and the lost-pet beacon still separate when both are on screen.
const MINE_RGB = '56, 189, 248';

// Yours is one colour, anyone else's is another (fog-of-war style) — no
// per-player rainbow, so the map's palette survives a crowded district.
// Unused until slice 2 puts other people's ground on screen.
const THEIRS_RGB = '255, 122, 122';

function toGeoJSON(cells: TerritoryCell[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: cells.map((c) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
      properties: {
        // 0-1 weight. Floored a little so a nearly-faded cell is still
        // faintly visible right up until the server drops it.
        w: Math.max(0.18, Math.min(1, c.strength / 100)),
        mine: c.mine ? 1 : 0,
      },
    })),
  };
}

export function TerritoryLayer({ cells }: { cells: TerritoryCell[] }) {
  const map = useMaplibreMap();
  // Rebuild the GeoJSON only when the cells actually change — the store
  // hands us a fresh array reference every 15 s sync even when nothing
  // moved, and re-uploading a few hundred points on each tick would
  // stutter the 3D city.
  const signature = useMemo(
    () => cells.map((c) => `${c.cellId}:${c.strength}`).join(','),
    [cells],
  );

  useEffect(() => {
    if (!map) return;
    const data = toGeoJSON(cells);

    const addOrUpdate = () => {
      const existing = map.getSource(SOURCE_ID) as
        | maplibregl.GeoJSONSource
        | undefined;
      if (existing) {
        existing.setData(data);
        return;
      }
      map.addSource(SOURCE_ID, { type: 'geojson', data });
      map.addLayer({
        id: LAYER_ID,
        type: 'heatmap',
        source: SOURCE_ID,
        paint: {
          'heatmap-weight': ['get', 'w'],
          // Kept low: this is ground scent, not a data viz. Overlapping
          // cells should pool into a soft wash, never a hot core.
          'heatmap-intensity': 0.55,
          // Radius grows with zoom so a claim covers the same REAL area
          // at every scale — ~110 m cells stay ~110 m of pavement whether
          // you're looking at your street or your district.
          'heatmap-radius': [
            'interpolate',
            ['exponential', 2],
            ['zoom'],
            12, 6,
            14, 22,
            16, 80,
            18, 300,
          ],
          'heatmap-opacity': 0.45,
          'heatmap-color': [
            'interpolate',
            ['linear'],
            ['heatmap-density'],
            0, `rgba(${MINE_RGB}, 0)`,
            0.2, `rgba(${MINE_RGB}, 0.25)`,
            0.5, `rgba(${MINE_RGB}, 0.5)`,
            1, `rgba(${MINE_RGB}, 0.72)`,
          ],
        },
      });
    };

    if (map.isStyleLoaded()) {
      addOrUpdate();
    } else {
      map.once('style.load', addOrUpdate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, signature]);

  // Drop the layer when the component unmounts (tab switch / mode change)
  // so a stale wash never lingers over another screen's map.
  useEffect(() => {
    if (!map) return;
    return () => {
      try {
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch {
        /* map already tearing down */
      }
    };
  }, [map]);

  return null;
}

export { THEIRS_RGB };
