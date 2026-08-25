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
//
// TRIED AND REJECTED: THE BOARD'S TREATMENT, OUT HERE.
//
// The standings draw a claim as a pale wash inside a dashed outline in
// the owner's colour (ui/TerritoryMini.tsx), and the obvious thought is
// to paint the map the same way so the two are one idea. It was built
// and looked at on a real map, and it reads as mess. PR #535 has the
// diff and a screenshot.
//
// The reason is structural, not a tuning miss, which is why it is
// written here rather than left as a knob to turn. A partition has NO
// EMPTY SPACE between zones: every internal border belongs to two
// claims at once and is therefore drawn twice, so a screen with a dozen
// neighbours becomes a mesh. Dashed or solid changes nothing about
// that — the number of lines is set by the geometry. The board's chip
// works for the opposite reason: one claim, alone, on white, with
// nothing sharing its edge.
//
// Anyone trying again should change that fact first — draw only YOUR
// edge, or only the boundary between you and someone else, or inset
// each zone so borders stop coinciding — rather than restyling the
// stroke. And note the trap that cost the first attempt an afternoon:
// applyCrayonOverride used to hide every layer it did not recognise,
// this prefix included. That is fixed (see crayonStyle.ts), but it is
// the kind of thing that makes a correct layer look like a broken one.
//
// HOW the ground is painted changed once more: the fill is now a soft
// blurred field (territoryHeatLayer.ts) rather than a hard vector fill.
// That is a deliberate return towards the heat look this header opens by
// rejecting — but what was wrong with Model 1 was the DATA (a grid that
// couldn't make a shape), not the softness. The geometry under the blur
// is still the exact server partition: dots still explain marks, holes
// are still holes, borders still sit where the server put them. Only the
// finish changed, from boardgame diagram to paint that bleeds a little
// into the street. The flat fill below survives as the fallback for
// devices where the custom GL layer can't set up.

import { useEffect, useMemo, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { useMaplibreMap } from './MapContext';
import { THREE_BUILDINGS_LAYER_ID } from './threeBuildingsLayer';
import type { RivalTerritory, TerritoryMark, TerritoryShape } from '../../services/api';
import { OWN_COLOR_CSS, OWN_COLOR_RGB, ownerColorCss, ownerColorRgb } from './territoryColor';
import {
  createTerritoryHeatLayer,
  TERRITORY_HEAT_LAYER_ID,
  type TerritoryHeatLayer,
} from './territoryHeatLayer';

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
const DOT_HOLD_MS = 4_000;
const DOT_FADE_MS = 4_000;
const DOT_LIFE_MS = DOT_HOLD_MS + DOT_FADE_MS;

// How big a dot is. Small, and no white ring around it.
//
// The ring was there to lift a dot off whatever it landed on, back when a
// mark might sit alone on bare map. It doesn't any more: marks come every
// forty metres now, so what the ring actually did was weld neighbouring
// dots into a chain of white beads that read as a drawn path — the one
// thing the layer's own notes say not to imply. Colour alone separates a
// dot from the ground under it well enough at this size.
const DOT_R = 3;
const DOT_R_CLOSING = 4.5;

// A neighbour's last mark fades much more slowly and stops short of
// invisible. It is one dot per dog rather than a trail, so it can't pile
// up the way a full history would — and a faint dot each is what makes
// "who marked where" answerable at a glance.
const RIVAL_DOT_FADE_MS = 20_000;
// Rival dots now go all the way out. They used to settle at 0.3 and stay
// there forever, because a neighbour's mark left no other trace on your
// screen — that was true when territory was recomputed from marks and a
// rival's claim only existed as a hull. Ground is stored and drawn now,
// so their claim IS the record, and the permanent dot on top of it was
// just clutter that accumulated one dog at a time.
const RIVAL_DOT_MIN_OPACITY = 0;
const RIVAL_DOT_LIFE_MS = DOT_HOLD_MS + RIVAL_DOT_FADE_MS;

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
    if (age >= RIVAL_DOT_LIFE_MS) continue;
    const fade = Math.min(1, Math.max(0, (age - DOT_HOLD_MS) / RIVAL_DOT_FADE_MS));
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [m.lng, m.lat] },
      properties: {
        // Fresh ones are as big as your own so a mark landing still reads
        // as an event; once faded they shrink to a marker.
        r: DOT_R - 1 * fade,
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
        r: m.closedLoop ? DOT_R_CLOSING : DOT_R,
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
  // The soft GL layer object outlives any single effect run; the failed
  // flag flips exactly once, if its GL setup can't come up, and swaps the
  // whole area rendering over to the classic flat fill.
  const heatRef = useRef<TerritoryHeatLayer | null>(null);
  const [heatFailed, setHeatFailed] = useState(false);
  // One group per owner, each with its own colour — CSS string for the
  // flat-fill fallback, linear triple for the GL layer, same hue either
  // way. Yours goes LAST so that if two ever did overlap, yours is the
  // one on top — the server partitions the ground so they shouldn't, but
  // if the geometry ever disagrees, the answer the user cares about is
  // "which bit is mine".
  const areaGroups = useMemo(
    () => [
      ...rivals.map((r) => ({
        shapes: r.shapes,
        color: ownerColorCss(r.ownerId),
        rgb: ownerColorRgb(r.ownerId),
      })),
      { shapes, color: OWN_COLOR_CSS, rgb: OWN_COLOR_RGB },
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
  // Each side against its OWN lifetime. Rivals fade over a longer window
  // than your own dots, and measuring them with DOT_LIFE_MS stopped the
  // timer while they were still mid-fade — harmless when they settled at
  // 0.3 and stayed visible anyway, but they go to nothing now, so a
  // frozen one would sit there at half opacity until the next sync
  // happened to redraw it.
  const anyAlive =
    marks.some((m) => Date.now() - new Date(m.at).getTime() < DOT_LIFE_MS) ||
    rivalMarks.some((m) => Date.now() - new Date(m.at).getTime() < RIVAL_DOT_LIFE_MS);
  useEffect(() => {
    if (!anyAlive) return;
    const id = setInterval(() => setTick((n) => n + 1), 900);
    return () => clearInterval(id);
  }, [anyAlive, markSig]);

  useEffect(() => {
    if (!map) return;
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

      // Yours and everyone else's ground still all lives in ONE layer,
      // coloured per owner. The ground is partitioned server-side so no
      // two zones overlap, which means there's no stacking order to get
      // right — and one layer is what lets an arbitrary number of
      // neighbours be drawn without adding a layer each time somebody new
      // walks past.
      //
      // The layer is normally the soft GL field; the flat vector fill
      // below is the same data down the fallback path, for a device where
      // the custom layer's GL setup fails.
      if (!heatFailed) {
        if (!map.getLayer(TERRITORY_HEAT_LAYER_ID)) {
          const layer = createTerritoryHeatLayer(() => setHeatFailed(true));
          heatRef.current = layer;
          try {
            map.addLayer(layer, under);
          } catch (e) {
            // eslint-disable-next-line no-console
            console.error('[territory] soft layer addLayer failed', e);
            heatRef.current = null;
            setHeatFailed(true);
          }
        }
        heatRef.current?.setGroups(
          areaGroups.map((g) => ({ shapes: g.shapes, color: g.rgb })),
        );
      } else if (!setOr(AREA_SOURCE, areaGeoJSON(areaGroups))) {
        if (map.getLayer(TERRITORY_HEAT_LAYER_ID)) {
          try {
            map.removeLayer(TERRITORY_HEAT_LAYER_ID);
          } catch {
            /* already gone */
          }
          heatRef.current = null;
        }
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
            paint: {
              'fill-color': ['get', 'color'],
              'fill-opacity': 0.42,
              // NO BORDERS, and no white threads between zones either.
              //
              // The thread is an artefact of fill antialiasing: MapLibre
              // feathers each polygon's edge, and two neighbours sharing a
              // border each feather away from it, so a hairline of the
              // paper underneath shows through the gap between them.
              //
              // Drawing a stroke to cover it was the wrong instinct and
              // took two tries to disprove. Every zone lives in ONE fill
              // layer, so a stroke in one zone's colour extends outward
              // UNDER its neighbour's fill — red beneath purple composites
              // to crimson, and the map grows a hard coloured line along
              // every shared border. There is no stroke colour that avoids
              // this, because the problem is that two zones' paint meets,
              // not which paint it is.
              //
              // Turning the feathering off makes the two polygons meet
              // exactly, which is what they already do in the data — a cut
              // hands the victim the claimant's own edge. Borders go back
              // to being where one colour stops and the next begins, with
              // nothing drawn on them at all. The cost is a slightly
              // harder edge, which on translucent ground at city zoom is
              // not something you can see.
              'fill-antialias': false,
            },
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
          },
        });
      }
    };

    if (map.isStyleLoaded()) apply();
    else map.once('style.load', apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, shapeSig, markSig, rivalSig, tick, heatFailed]);

  // Tear everything down on unmount (tab switch / mode change) so nothing
  // lingers over another screen's map.
  useEffect(() => {
    if (!map) return;
    return () => {
      try {
        for (const id of [TERRITORY_HEAT_LAYER_ID, AREA_FILL, LINK_LAYER, DOTS_LAYER]) {
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
