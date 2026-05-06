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

// Approximate Dnipro main channel through Kyiv as a stack of lat-banded
// lng rects. The river both bends and changes width as it flows from
// Vyshhorod down to Osokorky bay, so a single rect missed coords in
// the bands above and below central Kyiv. Hand-traced from satellite —
// rough but covers the whole pilot envelope; a real polygon is
// out-of-scope for now.
//
// Each band: [latMin, latMax, lngWestEdge, lngEastEdge].
const RIVER_BANDS: ReadonlyArray<readonly [number, number, number, number]> = [
  // Vyshhorod / Kyiv Sea exit
  [50.55, 51.0, 30.4, 30.55],
  // Obolon waterfront — narrower channel, slightly westward
  [50.5, 50.55, 30.5, 30.57],
  // Central Kyiv (Podil → Hidropark → Trukhaniv) — widest, includes
  // the east channel around the island
  [50.45, 50.5, 30.545, 30.62],
  // Pechersk → Vydubychi
  [50.4, 50.45, 30.575, 30.645],
  // Osokorky / Bortnychi bay
  [49.9, 50.4, 30.6, 30.7],
];

function bandsFor(lat: number): readonly [number, number] | null {
  for (const [latMin, latMax, west, east] of RIVER_BANDS) {
    if (lat >= latMin && lat < latMax) return [west, east];
  }
  return null;
}

// Snap a coord to the closer river bank if it falls inside the
// Dnipro main channel. Used on the pet's CENTER (raw lastSeen.position)
// before jittering, because the LLM-based listing parser sometimes
// emits coords directly in the river — listings mentioning "Dnipro
// embankment" or "near the river" land the LLM in the channel itself.
// Snap-then-jitter keeps the whole zone on land; the jitter result
// still gets a final `avoidWater` check as a belt-and-braces.
function snapToLandIfInRiver(pos: LatLng): LatLng {
  const band = bandsFor(pos.lat);
  if (!band) return pos;
  const [west, east] = band;
  if (pos.lng <= west || pos.lng >= east) return pos;
  const mid = (west + east) / 2;
  return { ...pos, lng: pos.lng < mid ? west : east };
}

function avoidWater(_center: LatLng, jittered: LatLng): LatLng {
  const band = bandsFor(jittered.lat);
  if (!band) return jittered;
  const [west, east] = band;
  if (jittered.lng <= west || jittered.lng >= east) return jittered;
  // Jittered into the main channel for this latitude band. Snap to the
  // closer bank — using jittered.lng (not center.lng) so river-coord
  // pets get sensible bilateral spread instead of all collapsing to
  // one bank.
  const mid = (west + east) / 2;
  return { ...jittered, lng: jittered.lng < mid ? west : east };
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
