import type { LatLng } from '@shukajpes/shared';
import { distanceMeters } from './geo';

// Simple greedy proximity clustering. Each input item seeds a new cluster
// unless it lands within `radiusM` of an existing cluster's first member,
// in which case it joins that cluster. Good enough for pilot volume; at
// ~100 pins the O(n²) cost is invisible, and the groups stay stable as
// long as the input order is stable.
//
// For high-density zoom-aware clustering we'd swap in
// @googlemaps/markerclusterer — but our pins are custom OverlayView
// divs, not google.maps.Marker instances, so the standard lib doesn't
// drop in cleanly.

export interface ClusterItem {
  id: string;
  position: LatLng;
}

export interface Cluster<T extends ClusterItem> {
  center: LatLng;
  items: T[];
}

export function clusterByDistance<T extends ClusterItem>(
  items: T[],
  radiusM: number,
): Cluster<T>[] {
  const clusters: Cluster<T>[] = [];
  for (const item of items) {
    const match = clusters.find((c) => distanceMeters(c.center, item.position) < radiusM);
    if (match) {
      match.items.push(item);
      // Center drifts toward the centroid so new items join around the real
      // middle of the group, not the first pin's exact spot.
      const n = match.items.length;
      match.center = {
        lat: (match.center.lat * (n - 1) + item.position.lat) / n,
        lng: (match.center.lng * (n - 1) + item.position.lng) / n,
      };
    } else {
      clusters.push({ center: { ...item.position }, items: [item] });
    }
  }
  return clusters;
}

// Expansion into a ring is CSS-pixel-based inside LostDogCluster's
// OverlayView container — see that component. Keeping cluster.ts focused
// on "which pets belong together".

// Small-group dispersal: when a cluster has a few members (2-5 typically),
// we don't want to hide them behind a badge — each pet just floats
// somewhere inside its own search-zone radius so the map reads as "pet
// is somewhere around here" at a glance. Geographic precision is
// intentionally sacrificed — the display position is display-only, not
// the pet's real last-seen coord.

function hashSeed(seed: string): number {
  // djb2 — good enough for positional jitter, fast, stable across platforms.
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) | 0;
  return h >>> 0;
}

// Hand-traced polygon of the Dnipro through the Kyiv pilot area —
// closed loop following the WEST bank top→bottom, then EAST bank
// bottom→top. The polygon includes the in-river islands
// (Trukhaniv, Hidropark) as "snappable" zone because the LLM-based
// listing parser frequently lands river-adjacent listings in the
// channel itself, and the islands are mostly parks / rare for lost
// pets. Lat-banded rects (the previous approach) couldn't follow
// the river's bend without leaving wedge-shaped gaps where the
// bands stepped — pets at the seams kept rendering in water.
//
// Tuple is [lat, lng]. Vertices are deliberately rough (~100m
// accuracy); the snap pushes ~80m off the edge to absorb error.
const RIVER_POLYGON: ReadonlyArray<readonly [number, number]> = [
  // West bank, north → south
  [50.620, 30.510],
  [50.580, 30.500],
  [50.555, 30.500],
  [50.530, 30.515],
  [50.510, 30.515],
  [50.495, 30.520],
  [50.480, 30.535],
  [50.470, 30.540],
  [50.460, 30.545],
  [50.450, 30.555],
  [50.440, 30.565],
  [50.430, 30.580],
  [50.420, 30.585],
  [50.405, 30.595],
  [50.385, 30.610],
  [50.360, 30.625],
  [50.290, 30.645],
  // East bank, south → north
  [50.290, 30.700],
  [50.360, 30.690],
  [50.385, 30.665],
  [50.405, 30.660],
  [50.420, 30.640],
  [50.435, 30.630],
  [50.450, 30.625],
  [50.465, 30.620],
  [50.480, 30.605],
  [50.495, 30.590],
  [50.510, 30.585],
  [50.530, 30.585],
  [50.555, 30.575],
  [50.580, 30.555],
  [50.620, 30.540],
];

// Push the snapped point this many degrees off the bank into land,
// to absorb polygon-tracing imprecision. ~80m at Kyiv latitudes.
const SNAP_OFFSET_DEG = 0.0008;

// Standard ray-cast point-in-polygon. Counts how many polygon edges
// a horizontal ray from the point crosses going east; odd = inside.
function pointInPolygon(lat: number, lng: number): boolean {
  let inside = false;
  const n = RIVER_POLYGON.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [yi, xi] = RIVER_POLYGON[i] as readonly [number, number];
    const [yj, xj] = RIVER_POLYGON[j] as readonly [number, number];
    const intersects =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

// Project p onto segment a→b in planar (lat, lng) space, clamped to
// the segment endpoints. Adequate for the urban scale we operate at —
// degree-of-longitude distortion across a single segment is tiny.
function projectOntoSegment(
  pLat: number,
  pLng: number,
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): readonly [number, number] {
  const dLat = bLat - aLat;
  const dLng = bLng - aLng;
  const lenSq = dLat * dLat + dLng * dLng;
  if (lenSq === 0) return [aLat, aLng];
  let t = ((pLat - aLat) * dLat + (pLng - aLng) * dLng) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return [aLat + t * dLat, aLng + t * dLng];
}

// Find the nearest point on any polygon edge.
function nearestEdgeProjection(lat: number, lng: number): readonly [number, number] {
  const first = RIVER_POLYGON[0] as readonly [number, number];
  let bestLat = first[0];
  let bestLng = first[1];
  let bestDistSq = Infinity;
  const n = RIVER_POLYGON.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [yi, xi] = RIVER_POLYGON[i] as readonly [number, number];
    const [yj, xj] = RIVER_POLYGON[j] as readonly [number, number];
    const [pLat, pLng] = projectOntoSegment(lat, lng, yj, xj, yi, xi);
    const dLat = pLat - lat;
    const dLng = pLng - lng;
    const d = dLat * dLat + dLng * dLng;
    if (d < bestDistSq) {
      bestDistSq = d;
      bestLat = pLat;
      bestLng = pLng;
    }
  }
  return [bestLat, bestLng];
}

// If pos is inside the river polygon, project it to the nearest bank
// and push slightly farther into land. Pets whose true coord is in
// the channel (LLM hallucinations like "near the embankment" mapped
// to mid-river) end up reliably on a real bank instead of swimming.
function snapToLandIfInRiver(pos: LatLng): LatLng {
  if (!pointInPolygon(pos.lat, pos.lng)) return pos;
  const [edgeLat, edgeLng] = nearestEdgeProjection(pos.lat, pos.lng);
  const dLat = edgeLat - pos.lat;
  const dLng = edgeLng - pos.lng;
  const len = Math.hypot(dLat, dLng);
  const snapped: LatLng =
    len === 0
      ? { lat: edgeLat, lng: edgeLng }
      : {
          lat: edgeLat + (dLat / len) * SNAP_OFFSET_DEG,
          lng: edgeLng + (dLng / len) * SNAP_OFFSET_DEG,
        };
  // TEMP debug: confirm the polygon snap path runs for the user's
  // "still swimming" pets. Remove once verified — printing on every
  // render is noisy in steady-state.
  if (typeof console !== 'undefined') {
    // eslint-disable-next-line no-console
    console.log(
      '[river-snap]',
      pos.lat.toFixed(4),
      pos.lng.toFixed(4),
      '→',
      snapped.lat.toFixed(4),
      snapped.lng.toFixed(4),
    );
  }
  return snapped;
}

function avoidWater(_center: LatLng, jittered: LatLng): LatLng {
  return snapToLandIfInRiver(jittered);
}

// Deterministic pseudo-random offset inside a circle of `radiusM` meters
// around `center`. Same seed always maps to the same point — so a pet
// displayed at a given offset stays at that offset across renders.
// Distance spans 5% to 90% of the radius so pets can sit anywhere inside
// the zone — earlier 60-95% version pushed them to the rim and made the
// formation look like "pets orbiting the border" instead of "scattered
// inside the area". When `angleOverrideRad` is supplied (set for pets in
// a shared cluster), we skip the hash-derived angle and use the provided
// one — this guarantees fanned separation for pets that happen to land
// on the same landmark, instead of relying on hash coincidence.
// Jittered positions that fall in the Dnieper main channel are reflected
// back to whichever bank the pet's true coord is on.
export function jitterInRadius(
  center: LatLng,
  radiusM: number,
  seed: string,
  angleOverrideRad?: number,
): LatLng {
  // Snap the center to land BEFORE jittering. The LLM-based listing
  // parser sometimes emits raw river coords; without the pre-snap,
  // the whole zone (and every jitter result inside it) was anchored
  // mid-river and `avoidWater` could only catch the small subset of
  // jittered points that ended up in my approximate channel rect.
  const safeCenter = snapToLandIfInRiver(center);
  const h = hashSeed(seed);
  const angle =
    angleOverrideRad ?? ((h % 10_000) / 10_000) * 2 * Math.PI;
  const distFrac = 0.05 + (((h >>> 14) % 10_000) / 10_000) * 0.85;
  const dist = radiusM * distFrac;
  const LAT_M = 1 / 111_320;
  const LNG_M = 1 / (111_320 * Math.cos((safeCenter.lat * Math.PI) / 180));
  const raw: LatLng = {
    lat: safeCenter.lat + dist * LAT_M * Math.sin(angle),
    lng: safeCenter.lng + dist * LNG_M * Math.cos(angle),
  };
  return avoidWater(safeCenter, raw);
}
