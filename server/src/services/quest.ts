import type { LatLng } from '../utils/geo.js';
import {
  distanceMeters,
  scatterInRadius,
  snapToLandIfInRiver,
} from '../utils/geo.js';
import type { StoredWaypoint } from '../db/schema.js';

// Spacing between consecutive stops on the trail (metres) and how much the
// heading is allowed to wander per step (radians) so it bends like a real
// scent trail instead of running dead straight.
const QUEST_STEP_M = 150;
const QUEST_HEADING_JITTER = 0.6;

// Detective-quest waypoint generation.
//
// A search is a SHORT local scent-trail dropped into a RANDOM sub-region of
// the pet's search zone. Two ideas:
//   • The stops stay close together (a ~few-hundred-metre trail), so once you
//     reach the area you sweep one patch — you never bounce between districts.
//     Getting to the first stop can still be a long walk if you chose a pet
//     that's far away; that's just you heading to the scene, and it's fine.
//   • The patch is placed randomly inside the zone every time, so repeat
//     searches — and different walkers — cover different corners, and the
//     whole (possibly large) zone gets swept collectively rather than one
//     person being asked to cover all of it.
export function generateDetectiveWaypoints(
  userPos: LatLng,
  dogPos: LatLng,
  zoneRadiusM: number,
  count = 3,
): StoredWaypoint[] {
  const n = Math.max(1, count);
  // 1. Pick a random patch centre inside the zone. Leave room for the trail
  //    so the whole thing stays inside the zone. Uniform-in-area sampling
  //    (the scatter default) even biases the patch toward the outer zone,
  //    which helps cover the ground the zone gains as it grows over days.
  const trailSpan = QUEST_STEP_M * (n - 1);
  const centerReach = Math.max(0, zoneRadiusM - trailSpan);
  const patch = scatterInRadius(dogPos, 1, centerReach)[0] ?? dogPos;

  // 2. Lay a short chained trail through the patch: each stop ~QUEST_STEP_M
  //    from the last along a gently wandering heading. We march along the
  //    ideal line and only snap the STORED point out of the river, so a snap
  //    never drags the rest of the trail with it.
  const mPerLat = 111_000;
  const mPerLng = 111_000 * Math.cos((patch.lat * Math.PI) / 180) || 111_000;
  let heading = Math.random() * 2 * Math.PI;
  let cur: LatLng = patch;
  const trail: LatLng[] = [snapToLandIfInRiver(cur)];
  for (let i = 1; i < n; i++) {
    heading += (Math.random() - 0.5) * 2 * QUEST_HEADING_JITTER;
    cur = {
      lat: cur.lat + (Math.sin(heading) * QUEST_STEP_M) / mPerLat,
      lng: cur.lng + (Math.cos(heading) * QUEST_STEP_M) / mPerLng,
    };
    trail.push(snapToLandIfInRiver(cur));
  }

  // 3. Enter the patch from whichever end is nearer the user, so the approach
  //    reads naturally instead of doubling back past the near stop.
  const first = trail[0]!;
  const last = trail[trail.length - 1]!;
  if (distanceMeters(userPos, last) < distanceMeters(userPos, first)) {
    trail.reverse();
  }

  return trail.map((p) => ({
    position: { lat: p.lat, lng: p.lng },
    clue: null,
    reached: false,
  }));
}

// Distance the user has to be from the active waypoint for /quests/advance
// to accept. Slightly more generous than the map's auto-collect radius so
// GPS drift + companion offset don't gate the progression.
export const WAYPOINT_REACH_RADIUS_M = 60;
