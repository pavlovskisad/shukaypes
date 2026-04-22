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
