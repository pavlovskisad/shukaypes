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

// Spiderify — when a cluster is tapped, spread its members around the
// cluster center in a circle so each one is individually tappable. Works
// regardless of zoom, which matters because many OLX posts end up pinned
// to the exact same landmark coord — no amount of zoom separates them.
//
// Ring radius and pet count per ring are tuned for the default zoom; at
// bigger clusters (10+) we switch to a two-ring layout so things don't
// collide at the rim.
export function spiderifyPositions(center: LatLng, count: number): LatLng[] {
  if (count <= 1) return [center];

  const INNER_RING_RADIUS_DEG = 0.00045; // ~50m at Kyiv's latitude
  const OUTER_RING_RADIUS_DEG = 0.00085; // ~95m
  const INNER_RING_CAPACITY = 8;

  const positions: LatLng[] = [];
  const innerCount = Math.min(count, INNER_RING_CAPACITY);
  const outerCount = Math.max(0, count - innerCount);

  for (let i = 0; i < innerCount; i++) {
    // Start at -π/2 so the first pin sits above the center (easier to read).
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / innerCount;
    positions.push({
      lat: center.lat + INNER_RING_RADIUS_DEG * Math.sin(angle),
      lng: center.lng + INNER_RING_RADIUS_DEG * Math.cos(angle),
    });
  }

  if (outerCount > 0) {
    // Offset the outer ring by half an angle so rim pins don't line up
    // behind inner pins radially.
    for (let i = 0; i < outerCount; i++) {
      const angle = -Math.PI / 2 + Math.PI / outerCount + (2 * Math.PI * i) / outerCount;
      positions.push({
        lat: center.lat + OUTER_RING_RADIUS_DEG * Math.sin(angle),
        lng: center.lng + OUTER_RING_RADIUS_DEG * Math.cos(angle),
      });
    }
  }

  return positions;
}
