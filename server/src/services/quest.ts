import type { LatLng } from '../utils/geo.js';
import { distanceMeters, scatterInRadius } from '../utils/geo.js';
import type { StoredWaypoint } from '../db/schema.js';

// Detective-quest waypoint generation. Picks `count` points inside the
// pet's search zone, then orders them as a greedy nearest-neighbor tour
// starting from the user's current position — so waypoint 1 is the
// closest, waypoint 2 is the closest of the rest from waypoint 1, etc.
// Not an optimal TSP, but for n=3-5 the tour stays natural-looking and
// doesn't zigzag across the zone.
export function generateDetectiveWaypoints(
  userPos: LatLng,
  dogPos: LatLng,
  zoneRadiusM: number,
  count = 3,
): StoredWaypoint[] {
  const scattered = scatterInRadius(dogPos, count, zoneRadiusM);
  const ordered: LatLng[] = [];
  let cursor = userPos;
  const remaining = [...scattered];
  while (remaining.length > 0) {
    remaining.sort(
      (a, b) => distanceMeters(cursor, a) - distanceMeters(cursor, b),
    );
    const next = remaining.shift()!;
    ordered.push(next);
    cursor = next;
  }
  return ordered.map((p) => ({
    position: { lat: p.lat, lng: p.lng },
    clue: null,
    reached: false,
  }));
}

// Distance the user has to be from the active waypoint for /quests/advance
// to accept. Slightly more generous than the map's auto-collect radius so
// GPS drift + companion offset don't gate the progression.
export const WAYPOINT_REACH_RADIUS_M = 60;
