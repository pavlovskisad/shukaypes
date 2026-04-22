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

// Rough Dnieper main channel through Kyiv. Narrow: only the actual water
// between west bank (~30.555) and east bank (~30.598). East-bank
// neighborhoods start at ~30.60 (Troieshchyna, Pozniaky, Osokorky,
// Darnytsia) — previous wider box was inadvertently clamping them.
// Pilot-grade approximation; a real water polygon would be nicer.
const RIVER_WEST_EDGE = 30.555;
const RIVER_EAST_EDGE = 30.598;

function avoidWater(center: LatLng, jittered: LatLng): LatLng {
  if (jittered.lng <= RIVER_WEST_EDGE || jittered.lng >= RIVER_EAST_EDGE) {
    return jittered;
  }
  // Jittered into the main channel. Reflect back to whichever bank is
  // closer to the pet's posted coord.
  const midRiver = (RIVER_WEST_EDGE + RIVER_EAST_EDGE) / 2;
  return {
    ...jittered,
    lng: center.lng < midRiver ? RIVER_WEST_EDGE : RIVER_EAST_EDGE,
  };
}

// Deterministic pseudo-random offset inside a circle of `radiusM` meters
// around `center`. Same seed always maps to the same point — so a pet
// displayed at a given offset stays at that offset across renders.
// Distance sits between 60% and 95% of the radius so pets are pushed to
// the outer part of their zone — dense neighborhoods get better angular
// spread because pets radiate outward rather than crowding the middle.
// Jittered positions that fall in the Dnieper main channel are reflected
// back to whichever bank the pet's true coord is on.
export function jitterInRadius(center: LatLng, radiusM: number, seed: string): LatLng {
  const h = hashSeed(seed);
  const angle = ((h % 10_000) / 10_000) * 2 * Math.PI;
  const distFrac = 0.6 + (((h >>> 14) % 10_000) / 10_000) * 0.35;
  const dist = radiusM * distFrac;
  const LAT_M = 1 / 111_320;
  const LNG_M = 1 / (111_320 * Math.cos((center.lat * Math.PI) / 180));
  const raw: LatLng = {
    lat: center.lat + dist * LAT_M * Math.sin(angle),
    lng: center.lng + dist * LNG_M * Math.cos(angle),
  };
  return avoidWater(center, raw);
}
