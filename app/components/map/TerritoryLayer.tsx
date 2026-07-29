// Territory rendering — the dog's marks, and the ground they enclose.
//
// The first cut drew a soft heat-glow over owned cells. It looked like
// weather: you couldn't tell where a claim started, why it was there, or
// how one patch related to the next. This version draws the mechanic
// instead of an impression of it:
//
//   • a DOT wherever the dog actually marked
//   • a solid FILL over the ground those marks hold
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
// EVERYONE'S ground is drawn, each owner in their own colour, across the
// whole map view — a city carved up between neighbours, which is the
// thing a territory game is actually about. An earlier cut showed rivals
// in one grey and only within 900m, and the map just looked empty.
//
// Zones never overlap: the server partitions all ground by nearest mark,
// so a patch someone else holds inside your range arrives as a HOLE in
// your shape and as their polygon in their colour. That's why this can be
// a single fill layer with a data-driven colour rather than a layer per
// owner with a stacking order to argue about.
//
// No outlines anywhere — not around your shape, not between neighbours.
// Every stroked version of this has read as a diagram of the mechanic
// rather than paint on the ground, and the map already has plenty of
// lines in it. The fill colour alone carries the edge.

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

// Brand blue (the CTA pill blue, rgb(0,60,255)). The previous sky-blue
// was picked to sit clear of the search beacon, but on a pale map it read
// as water — which the map style already uses blue for, so claimed ground
// looked like a lake. Brand blue is unmistakably paint, not terrain.
const BLUE = 'rgb(0,60,255)';
const BLUE_DEEP = 'rgb(0,60,255)';

// Every neighbour gets their OWN colour, derived from their id so it's
// the same one on every device and across sessions — the city reads as a
// patchwork of who holds what, which is the whole appeal of a territory
// game. Yours stays brand blue and nobody else can be issued it.
//
// Hue comes off a hash of the id, then gets pushed out of the band around
// brand blue (~226°) so no neighbour can be mistaken for you. Saturation
// and lightness are fixed, so twenty owners still read as one family of
// paint rather than a bag of highlighters.
const OWN_HUE_LO = 200;
const OWN_HUE_HI = 252;
function ownerColor(id: string): string {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let hue = (h >>> 0) % 360;
  // Fold the reserved band away rather than clamping to its edges, which
  // would pile several owners onto the same two hues.
  if (hue >= OWN_HUE_LO && hue < OWN_HUE_HI) {
    hue = (hue + (OWN_HUE_HI - OWN_HUE_LO)) % 360;
  }
  return `hsl(${hue}, 62%, 45%)`;
}

// A dot is a moment, not a monument: it shows where the dog just marked,
// holds while you notice it, then fades out and leaves the territory
// behind. Without this the map slowly fills with a hundred old dots and
// the shape — the thing that actually matters — gets lost in them.
const DOT_HOLD_MS = 12_000;
const DOT_FADE_MS = 8_000;
const DOT_LIFE_MS = DOT_HOLD_MS + DOT_FADE_MS;

// GeoJSON rings must close explicitly.
function ring(pts: { lat: number; lng: number }[]): number[][] {
  return [...pts.map((p) => [p.lng, p.lat]), [pts[0]!.lng, pts[0]!.lat]];
}

// `color` rides on each feature so one fill layer can paint every owner
// in their own colour via a data-driven expression, instead of a layer
// per neighbour.
function areaGeoJSON(
  groups: { shapes: TerritoryShape[]; color: string }[],
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const g of groups) {
    for (const s of g.shapes) {
      if (s.kind !== 'area' || s.points.length < 3) continue;
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          // Holes are ground a neighbour holds inside this shape — the
          // server has already decided whose it is, so we just cut it out.
          coordinates: [ring(s.points), ...(s.holes ?? []).map(ring)],
        },
        properties: { color: g.color },
      });
    }
  }
  return { type: 'FeatureCollection', features };
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
  // One group per owner, each with its own colour. Yours goes LAST so
  // that if two ever did overlap, yours is the one on top — the server
  // partitions the ground so they shouldn't, but if the geometry ever
  // disagrees, the answer the user cares about is "which bit is mine".
  const areaGroups = useMemo(
    () => [
      ...rivals.map((r) => ({ shapes: r.shapes, color: ownerColor(r.ownerId) })),
      { shapes, color: BLUE },
    ],
    [rivals, shapes],
  );
  // The store hands us fresh array references every 15s sync even when
  // nothing changed; re-uploading geometry each tick would stutter the 3D
  // city. Signatures keep uploads to real changes.
  const rivalSig = useMemo(
    () =>
      rivals
        .map(
          (r) =>
            `${r.ownerId}:${r.shapes.length}:${r.shapes.reduce((n, s) => n + s.points.length + (s.holes?.length ?? 0), 0)}`,
        )
        .join(','),
    [rivals],
  );
  const shapeSig = useMemo(
    () =>
      shapes
        .map(
          (s) =>
            `${s.kind}:${s.points.map((p) => p.lat.toFixed(5)).join('|')}:${s.holes?.length ?? 0}`,
        )
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
    const areas = areaGeoJSON(areaGroups);
    const links = linkGeoJSON(shapes);
    const dots = dotsGeoJSON(marks, Date.now());

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

      // Yours and everyone else's live in ONE source, coloured per
      // feature. The ground is partitioned server-side so no two zones
      // overlap, which means there's no stacking order to get right — and
      // one layer is what lets an arbitrary number of neighbours be drawn
      // without adding a layer each time somebody new walks past.
      if (!setOr(AREA_SOURCE, areas)) {
        map.addLayer(
          {
            id: AREA_FILL,
            type: 'fill',
            source: AREA_SOURCE,
            paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.3 },
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
        for (const id of [AREA_FILL, LINK_LAYER, DOTS_LAYER]) {
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
