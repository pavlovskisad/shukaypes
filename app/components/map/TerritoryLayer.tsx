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
// The fill is the ACTUAL hull of the marks. An earlier cut drew per-cell
// ownership squares and it came out as blocky rectangles bolted around
// each dot — nothing like the clean triangle three marks ought to
// enclose. The cells are gone now; the marks are the only ownership
// truth, so what's drawn and what's owned can't drift apart.
//
// Rival ground is the fourth thing on this layer, and it's deliberately
// quiet: one graphite colour for everyone else, thinner than yours, only
// present while you're near it. The map is yours; running into someone
// else's edge should be an event, not a permanent second layer of paint.

import { useEffect, useMemo, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { useMaplibreMap } from './MapContext';
import { THREE_BUILDINGS_LAYER_ID } from './threeBuildingsLayer';
import type { RivalTerritory, TerritoryMark, TerritoryShape } from '../../services/api';

const AREA_SOURCE = 'territory-area-src';
const AREA_FILL = 'territory-area-fill';
const LINK_SOURCE = 'territory-link-src';
const LINK_LAYER = 'territory-link';
const DOTS_SOURCE = 'territory-dots-src';
const DOTS_LAYER = 'territory-dots';
const RIVAL_SOURCE = 'territory-rival-src';
const RIVAL_FILL = 'territory-rival-fill';
const RIVAL_EDGE = 'territory-rival-edge';

// Brand blue (the CTA pill blue, rgb(0,60,255)). The previous sky-blue
// was picked to sit clear of the search beacon, but on a pale map it read
// as water — which the map style already uses blue for, so claimed ground
// looked like a lake. Brand blue is unmistakably paint, not terrain.
const BLUE = 'rgb(0,60,255)';
const BLUE_DEEP = 'rgb(0,60,255)';

// Rival ground. ONE colour for everyone else, not a colour per player —
// the question the map has to answer is "is this mine or not", and a
// palette of owners turns that into a legend you have to learn. Graphite
// reads as "someone's been here" without competing with the brand blue
// for attention, and it's the only other paint on the floor, so there's
// never any doubt which one is yours. Drawn thinner than your own fill
// and given the outline yours doesn't have, so at a glance it's clearly
// somebody else's edge you're walking up to.
const RIVAL = 'rgb(72,78,96)';

// A dot is a moment, not a monument: it shows where the dog just marked,
// holds while you notice it, then fades out and leaves the territory
// behind. Without this the map slowly fills with a hundred old dots and
// the shape — the thing that actually matters — gets lost in them.
const DOT_HOLD_MS = 12_000;
const DOT_FADE_MS = 8_000;
const DOT_LIFE_MS = DOT_HOLD_MS + DOT_FADE_MS;

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

function dotsGeoJSON(marks: TerritoryMark[], now: number): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const m of marks) {
    const age = now - new Date(m.at).getTime();
    // Guard against a clock skewed into the future — treat it as brand new
    // rather than letting a negative age make the dot immortal.
    if (age >= DOT_LIFE_MS) continue;
    const o =
      age <= DOT_HOLD_MS ? 1 : 1 - (age - DOT_HOLD_MS) / DOT_FADE_MS;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [m.lng, m.lat] },
      properties: {
        // A hardened mark (revisited on a later walk) draws a little
        // bigger — the only place strength is visible, and it's the
        // difference between a soft edge and a core you'd defend.
        r: (m.closedLoop ? 6.5 : 4.5) + Math.max(0, (m.strength ?? 1) - 1) * 1.1,
        o: Math.max(0, Math.min(1, o)),
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

export function TerritoryLayer({
  shapes,
  marks,
  rivals,
}: {
  shapes: TerritoryShape[];
  marks: TerritoryMark[];
  rivals: RivalTerritory[];
}) {
  const map = useMaplibreMap();
  // Rival ground only arrives while you're near it, so most of the time
  // this is an empty list and the layer is a no-op.
  const rivalShapes = useMemo(() => rivals.flatMap((r) => r.shapes), [rivals]);
  const rivalSig = useMemo(
    () =>
      rivals
        .map((r) => `${r.ownerId}:${r.shapes.length}:${r.shapes[0]?.points[0]?.lat.toFixed(5) ?? ''}`)
        .join(','),
    [rivals],
  );
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
  // Dots fade over time, so the layer has to redraw while any of them is
  // still alive — and only then. Once the last one has gone the timer
  // stops and the map goes quiet again.
  const [tick, setTick] = useState(0);
  const anyAlive = marks.some(
    (m) => Date.now() - new Date(m.at).getTime() < DOT_LIFE_MS,
  );
  useEffect(() => {
    if (!anyAlive) return;
    const id = setInterval(() => setTick((n) => n + 1), 900);
    return () => clearInterval(id);
  }, [anyAlive, markSig]);

  useEffect(() => {
    if (!map) return;
    const areas = areaGeoJSON(shapes);
    const links = linkGeoJSON(shapes);
    const dots = dotsGeoJSON(marks, Date.now());
    const rivalAreas = areaGeoJSON(rivalShapes);

    const apply = () => {
      // Territory is paint on the FLOOR — it belongs under the city, not
      // over it. The 3D buildings are their own custom layer, so inserting
      // beneath it lets them stand on the claimed ground (and occlude it)
      // instead of the blue washing over their roofs. Falls back to the top
      // of the stack when the buildings layer isn't present (the flat map
      // style), where there's nothing to sit under anyway.
      const under = map.getLayer(THREE_BUILDINGS_LAYER_ID)
        ? THREE_BUILDINGS_LAYER_ID
        : undefined;
      const setOr = (id: string, data: GeoJSON.FeatureCollection): boolean => {
        const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
        if (src) {
          src.setData(data);
          return true;
        }
        map.addSource(id, { type: 'geojson', data });
        return false;
      };

      // Rivals go down FIRST so your own fill paints over theirs where the
      // two overlap — the contested strip should read as yours-with-a-
      // shadow, not as theirs-on-top-of-yours.
      if (!setOr(RIVAL_SOURCE, rivalAreas)) {
        map.addLayer(
          {
            id: RIVAL_FILL,
            type: 'fill',
            source: RIVAL_SOURCE,
            paint: { 'fill-color': RIVAL, 'fill-opacity': 0.18 },
          },
          under,
        );
        map.addLayer(
          {
            id: RIVAL_EDGE,
            type: 'line',
            source: RIVAL_SOURCE,
            layout: { 'line-join': 'round' },
            paint: { 'line-color': RIVAL, 'line-width': 1.5, 'line-opacity': 0.55 },
          },
          under,
        );
      }

      if (!setOr(AREA_SOURCE, areas)) {
        map.addLayer(
          {
            id: AREA_FILL,
            type: 'fill',
            source: AREA_SOURCE,
            // No outline any more, so the fill alone has to describe the
          // shape's edge — a touch stronger than it was when a stroke was
          // doing that work.
          paint: { 'fill-color': BLUE, 'fill-opacity': 0.32 },
          },
          under,
        );
      }

      if (!setOr(LINK_SOURCE, links)) {
        map.addLayer(
          {
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
          },
          under,
        );
      }

      if (!setOr(DOTS_SOURCE, dots)) {
        map.addLayer({
          id: DOTS_LAYER,
          type: 'circle',
          source: DOTS_SOURCE,
          paint: {
            'circle-radius': ['get', 'r'],
            'circle-color': BLUE_DEEP,
            'circle-opacity': ['get', 'o'],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
            'circle-stroke-opacity': ['get', 'o'],
          },
        });
      }
    };

    if (map.isStyleLoaded()) apply();
    else map.once('style.load', apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, shapeSig, markSig, rivalSig, tick]);

  // Tear everything down on unmount (tab switch / mode change) so nothing
  // lingers over another screen's map.
  useEffect(() => {
    if (!map) return;
    return () => {
      try {
        for (const id of [RIVAL_EDGE, RIVAL_FILL, AREA_FILL, LINK_LAYER, DOTS_LAYER]) {
          if (map.getLayer(id)) map.removeLayer(id);
        }
        for (const id of [RIVAL_SOURCE, AREA_SOURCE, LINK_SOURCE, DOTS_SOURCE]) {
          if (map.getSource(id)) map.removeSource(id);
        }
      } catch {
        /* map already tearing down */
      }
    };
  }, [map]);

  return null;
}
