import type { LatLng } from '../utils/geo.js';
import {
  distanceMeters,
  isInRiver,
  scatterInRadius,
  snapToLandIfInRiver,
} from '../utils/geo.js';
import type { StoredWaypoint } from '../db/schema.js';

// Spacing between consecutive stops on the trail (metres) and how much the
// heading is allowed to wander per step (radians) so it bends like a real
// scent trail instead of running dead straight.
const QUEST_STEP_M = 150;
const QUEST_HEADING_JITTER = 0.6;
// Trail length scales with the search zone: a fresh, tight case is a quick
// 3-stop sniff; an old case whose zone has expanded reads as a bigger hunt
// (up to MAX). This is the "difficulty" — it rides the case, no UI needed.
const QUEST_MIN_STOPS = 3;
const QUEST_MAX_STOPS = 5;

// Advance one step from `from` along roughly `heading`, staying on land. We
// wander the heading a little, then — if that lands in the Dnipro — rotate
// and retry so the trail walks ALONG the bank rather than being snapped
// across the river (which flings stops km away and bunches them up).
function stepOnLand(
  from: LatLng,
  heading: number,
  mPerLat: number,
  mPerLng: number,
): { pos: LatLng; heading: number } {
  let h = heading + (Math.random() - 0.5) * 2 * QUEST_HEADING_JITTER;
  for (let k = 0; k < 8; k++) {
    const pos: LatLng = {
      lat: from.lat + (Math.sin(h) * QUEST_STEP_M) / mPerLat,
      lng: from.lng + (Math.cos(h) * QUEST_STEP_M) / mPerLng,
    };
    if (!isInRiver(pos)) return { pos, heading: h };
    h += Math.PI / 4; // turn 45° and try again — follow the bank
  }
  // Whole neighbourhood is water (rare) — fall back to the plain snap.
  const straight: LatLng = {
    lat: from.lat + (Math.sin(heading) * QUEST_STEP_M) / mPerLat,
    lng: from.lng + (Math.cos(heading) * QUEST_STEP_M) / mPerLng,
  };
  return { pos: snapToLandIfInRiver(straight), heading };
}

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
//
// `count` defaults to a zone-scaled length (see QUEST_MIN/MAX_STOPS).
export function generateDetectiveWaypoints(
  userPos: LatLng,
  dogPos: LatLng,
  zoneRadiusM: number,
  count?: number,
): StoredWaypoint[] {
  const stops = Math.max(
    1,
    count ??
      Math.min(
        QUEST_MAX_STOPS,
        QUEST_MIN_STOPS + Math.floor(Math.max(0, zoneRadiusM) / 1200),
      ),
  );

  // 1. Pick a random patch centre inside the zone. Leave room for the trail
  //    so the whole thing stays inside the zone. Uniform-in-area sampling
  //    (the scatter default) even biases the patch toward the outer zone,
  //    which helps cover the ground the zone gains as it grows over days.
  const trailSpan = QUEST_STEP_M * (stops - 1);
  const centerReach = Math.max(0, zoneRadiusM - trailSpan);
  const patch = scatterInRadius(dogPos, 1, centerReach)[0] ?? dogPos;

  // 2. Lay a short chained trail through the patch — each stop ~QUEST_STEP_M
  //    from the last, staying on land (stepOnLand follows the bank if a step
  //    would land in the river instead of snapping across it).
  const mPerLat = 111_000;
  const mPerLng = 111_000 * Math.cos((patch.lat * Math.PI) / 180) || 111_000;
  let heading = Math.random() * 2 * Math.PI;
  let cur: LatLng = snapToLandIfInRiver(patch);
  const trail: LatLng[] = [cur];
  for (let i = 1; i < stops; i++) {
    const next = stepOnLand(cur, heading, mPerLat, mPerLng);
    cur = next.pos;
    heading = next.heading;
    trail.push(cur);
  }

  // 3. Enter the patch from whichever end is nearer the user, so the approach
  //    reads naturally instead of doubling back past the near stop.
  const firstP = trail[0]!;
  const lastP = trail[trail.length - 1]!;
  if (distanceMeters(userPos, lastP) < distanceMeters(userPos, firstP)) {
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
