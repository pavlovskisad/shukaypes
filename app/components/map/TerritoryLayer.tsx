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
import { OWN_COLOR_CSS, ownerColorCss } from './territoryColor';

const AREA_SOURCE = 'territory-area-src';
const AREA_FILL = 'territory-area-fill';
const LINK_SOURCE = 'territory-link-src';
const LINK_LAYER = 'territory-link';
const DOTS_SOURCE = 'territory-dots-src';
const DOTS_LAYER = 'territory-dots';

// Colours live in territoryColor.ts, shared with the 3D buildings layer —
// the ground under a block and the buildings standing on it have to agree
// on whose it is, or one claim reads as two.

// A dot is a moment, not a monument: it shows where the dog just marked,
// holds while you notice it, then fades out and leaves the territory
// behind. Without this the map slowly fills with a hundred old dots and
// the shape — the thing that actually matters — gets lost in them.
const DOT_HOLD_MS = 12_000;
const DOT_FADE_MS = 8_000;
const DOT_LIFE_MS = DOT_HOLD_MS + DOT_FADE_MS;

// A neighbour's last mark fades much more slowly and stops short of
// invisible. It is one dot per dog rather than a trail, so it can't pile
// up the way a full history would — and a faint dot each is what makes
// "who marked where" answerable at a glance.
const RIVAL_DOT_FADE_MS = 90_000;
const RIVAL_DOT_MIN_OPACITY = 0.3;

// GeoJSON rings must close explicitly.
function ring(pts: { lat: number; lng: number }[]): number[][] {
  return [...pts.map((p) => [p.lng, p.lat]), [pts[0]!.lng, pts[0]!.lat]];
}

// A signature that changes whenever the drawn geometry does — every
// vertex, both axes, holes included. Five decimals is about a metre,
// which is finer than any territory edge anyone can see, and coarse
// enough that float noise doesn't force a pointless re-upload.
function shapesSig(shapes: TerritoryShape[]): string {
  return shapes
    .map(
      (s) =>
        `${s.kind}:${s.points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|')}` +
        (s.holes ?? [])
          .map((h) => `#${h.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|')}`)
          .join(''),
    )
    .join(';');
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

function dotsGeoJSON(
  marks: TerritoryMark[],
  now: number,
  rivalMarks: { lat: number; lng: number; ownerId: string; at: string }[] = [],
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  // Each neighbour's LAST mark, in their colour — one dot per dog, and the
  // server sends exactly that.
  //
  // It fades by age but never all the way out. Your own marks vanish after
  // twenty seconds because they are a "that just happened" flash and the
  // shape they build is the lasting record; a neighbour's has no such
  // record on your screen, so dropping it left you unable to see where any
  // other dog had ever marked. A bot marks once every four minutes, so a
  // twenty-second window showed one about a fifth of the time. Bright for
  // the first stretch, then settling to a quiet dot that says "this is the
  // last place that dog claimed".
  for (const m of rivalMarks) {
    const age = now - new Date(m.at).getTime();
    const fade = Math.min(1, Math.max(0, (age - DOT_HOLD_MS) / RIVAL_DOT_FADE_MS));
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [m.lng, m.lat] },
      properties: {
        // Fresh ones are as big as your own so a mark landing still reads
        // as an event; once faded they shrink to a marker.
        r: 4.5 - 1.5 * fade,
        o: 1 - (1 - RIVAL_DOT_MIN_OPACITY) * fade,
        color: ownerColorCss(m.ownerId),
      },
    });
  }
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
        // Every mark is the same size because every mark is worth the
        // same. Only the one that first enclosed a shape gets to be
        // bigger, and that's about the moment, not about strength.
        r: m.closedLoop ? 6.5 : 4.5,
        o: Math.max(0, Math.min(1, o)),
        color: OWN_COLOR_CSS,
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

export function TerritoryLayer({
  shapes,
  marks,
  rivals,
  rivalMarks,
}: {
  shapes: TerritoryShape[];
  marks: TerritoryMark[];
  rivals: RivalTerritory[];
  // Neighbours' just-made marks, drawn in their owner's colour and gone
  // again in seconds. Without them a rival border moved between syncs
  // with nothing on screen to explain it.
  rivalMarks: { lat: number; lng: number; ownerId: string; at: string }[];
}) {
  const map = useMaplibreMap();
  // One group per owner, each with its own colour. Yours goes LAST so
  // that if two ever did overlap, yours is the one on top — the server
  // partitions the ground so they shouldn't, but if the geometry ever
  // disagrees, the answer the user cares about is "which bit is mine".
  const areaGroups = useMemo(
    () => [
      ...rivals.map((r) => ({ shapes: r.shapes, color: ownerColorCss(r.ownerId) })),
      { shapes, color: OWN_COLOR_CSS },
    ],
    [rivals, shapes],
  );
  // The store hands us fresh array references every 15s sync even when
  // nothing changed; re-uploading geometry each tick would stutter the 3D
  // city. Signatures keep uploads to real changes.
  //
  // They have to cover the actual GEOMETRY, both axes. Two earlier cuts
  // didn't and the map quietly stopped being live: your own signature
  // hashed latitude only, so a shape that shifted purely east-west never
  // redrew, and the rivals' hashed nothing but owner ids and vertex
  // counts — which is exactly what a neighbour's hull does when it grows
  // or gets bitten into and keeps the same number of corners.
  const rivalSig = useMemo(() => rivals.map((r) => `${r.ownerId}~${shapesSig(r.shapes)}`).join(','), [rivals]);
  const shapeSig = useMemo(() => shapesSig(shapes), [shapes]);
  const markSig = useMemo(
    () =>
      marks.map((m) => `${m.lat.toFixed(5)},${m.lng.toFixed(5)}`).join(',') +
      '~' +
      rivalMarks.map((m) => `${m.ownerId}:${m.at}`).join(','),
    [marks, rivalMarks],
  );
  // Dots fade over time, so the layer has to redraw while any of them is
  // still alive — and only then. Once the last one has gone the timer
  // stops and the map goes quiet again.
  const [tick, setTick] = useState(0);
  const anyAlive =
    marks.some((m) => Date.now() - new Date(m.at).getTime() < DOT_LIFE_MS) ||
    rivalMarks.some((m) => Date.now() - new Date(m.at).getTime() < DOT_LIFE_MS);
  useEffect(() => {
    if (!anyAlive) return;
    const id = setInterval(() => setTick((n) => n + 1), 900);
    return () => clearInterval(id);
  }, [anyAlive, markSig]);

  useEffect(() => {
    if (!map) return;
    const areas = areaGeoJSON(areaGroups);
    const links = linkGeoJSON(shapes);
    const dots = dotsGeoJSON(marks, Date.now(), rivalMarks);

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
            // Denser than it used to be. Names were written across each
            // neighbour's ground and have been taken off — with a palette
            // whose entries are actually distinguishable, the colour alone
            // says whose a patch is, and the dog's own name chip is painted
            // in the same colour to close the loop. That leaves the fill
            // carrying the identity by itself, so it has to read as a
            // colour rather than a tint of the map underneath.
            paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.42 },
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
              'line-color': OWN_COLOR_CSS,
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
            'circle-color': ['get', 'color'],
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
