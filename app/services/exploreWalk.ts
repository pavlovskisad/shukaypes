import type { LatLng } from '@shukajpes/shared';
import { api } from './api';
import { fetchWalkingRoute } from './directions';
import {
  planWalkOptions,
  loadRecentStopIds,
  recordRecentStops,
  recordRecentDestination,
  type WalkCandidate,
  type WalkDistance,
  type WalkPlan,
  type WalkShape,
  type WalkStop,
} from '../utils/walk';

// Starting a walk, end to end.
//
// A walk used to be one line to one destination. This is the step that
// makes it an exploration: it plans SEVERAL candidate walks, asks the
// server which landmarks each of them passes, spends the walk on the
// candidate with the most to see, and re-plots the route THROUGH those
// landmarks so the walker actually arrives at each one.
//
// Every caller of the old planWalk + fetchWalkingRoute pair goes through
// here instead, so the radial menu and the companion's chat action can't
// drift apart on what a walk is.
//
// FAILING SOFT IS THE POINT. Landmarks are an enrichment, not a
// dependency: a district with none of them, a server that 500s, a
// directions call that can't reach a stop — each of those has to end in
// the plain walk the app made before this existed, never in no walk at
// all. Everything below is arranged around that.

// How many candidate destinations to cost before committing. Four is
// enough to find a lore-rich direction in most of Kyiv without turning
// one tap into a wide search — and the candidates are all inside the
// requested distance band, so trading between them costs the walker
// nothing they asked for.
const CANDIDATE_COUNT = 4;

// How far off the planned line a landmark may sit, by walk length. A
// 1 km stroll cannot afford a 250 m dog-leg; a 3 km one barely notices
// it. The server clamps these and derives the rest (spacing, detour
// budget) from the path it is given.
const CORRIDOR_CLOSE_M = 160;
const CORRIDOR_FAR_M = 260;

// Stops per walk. The ask was "at least a few", and three is the point
// where a walk reads as a route with stops rather than a detour to one
// thing. A long walk can carry a fourth.
const MAX_STOPS_CLOSE = 3;
const MAX_STOPS_FAR = 4;

export interface ExplorationWalk {
  // The drawn polyline, already routed through the stops.
  route: LatLng[];
  primary: WalkCandidate;
  shape: WalkShape;
  // Only set when the destination is a spot with its own marker, so the
  // map can keep that pin visible regardless of the spots toggle.
  spotId: string | null;
  // In visiting order. Empty is a normal, valid walk.
  stops: WalkStop[];
}

interface Costed {
  plan: WalkPlan;
  stops: WalkStop[];
  // Waypoints for the directions call, stops spliced in.
  waypoints: LatLng[];
  rank: number;
}

// Ask the server what each candidate passes. Returns the candidates
// unchanged (no stops) if the call fails — a walk without commentary
// beats an error message.
async function costCandidates(
  plans: WalkPlan[],
  distance: WalkDistance,
): Promise<Costed[]> {
  const bare: Costed[] = plans.map((plan, rank) => ({
    plan,
    stops: [],
    waypoints: plan.waypoints,
    rank,
  }));
  try {
    const { results } = await api.loreWalkStops(
      plans.map((p, i) => ({ id: String(i), path: p.path })),
      {
        maxStops: distance === 'far' ? MAX_STOPS_FAR : MAX_STOPS_CLOSE,
        corridorM: distance === 'far' ? CORRIDOR_FAR_M : CORRIDOR_CLOSE_M,
        exclude: loadRecentStopIds(),
      },
    );
    const byId = new Map(results.map((r) => [r.id, r]));
    return bare.map((c) => {
      const found = byId.get(String(c.rank));
      if (!found || found.stops.length === 0) return c;
      return {
        ...c,
        stops: found.stops,
        // Trust the server's waypoints — it spliced the stops into the
        // path at the positions its own ordering gives them, and doing
        // that arithmetic twice is how the two copies disagree.
        waypoints: found.waypoints.length ? found.waypoints : c.plan.waypoints,
      };
    });
  } catch {
    return bare;
  }
}

// Most to see wins; the planner's own ranking breaks ties. Deliberately
// NOT "first candidate with enough stops": when the top-ranked walk
// passes one landmark and the third passes four, the third is the better
// walk, and both are inside the distance the walker asked for.
function bestCandidate(costed: Costed[]): Costed | null {
  if (costed.length === 0) return null;
  return costed.reduce((best, c) =>
    c.stops.length > best.stops.length ||
    (c.stops.length === best.stops.length && c.rank < best.rank)
      ? c
      : best,
  );
}

export async function startExplorationWalk(args: {
  origin: LatLng;
  candidates: WalkCandidate[];
  shape: WalkShape;
  distance: WalkDistance;
}): Promise<ExplorationWalk | null> {
  const { origin, candidates, shape, distance } = args;
  const plans = planWalkOptions({
    candidates,
    origin,
    shape,
    distance,
    count: CANDIDATE_COUNT,
  });
  if (plans.length === 0) return null;

  const chosen = bestCandidate(await costCandidates(plans, distance));
  if (!chosen) return null;
  const { plan, stops } = chosen;
  const spotId = plan.primary.isSpot ? plan.primary.id : null;

  const settle = (route: LatLng[], withStops: WalkStop[]): ExplorationWalk => {
    // Only record what the walker actually got. A destination we
    // couldn't route to must not be penalised on the next tap, and
    // landmarks on a route that never rendered are still unseen.
    recordRecentDestination(plan.primary.id);
    if (withStops.length) recordRecentStops(withStops.map((s) => s.id));
    return { route, primary: plan.primary, shape, spotId, stops: withStops };
  };

  // First choice: the walk through the landmarks.
  const viaStops = await fetchWalkingRoute(origin, chosen.waypoints);
  if (viaStops) return settle(viaStops, stops);

  // A stop the directions API can't walk to (inside a closed courtyard,
  // on an island, behind a fence) fails the WHOLE call, taking the walk
  // with it. Drop the enrichment and keep the walk.
  const plain = await fetchWalkingRoute(origin, plan.waypoints);
  if (plain) return settle(plain, []);

  // Same fallback the roundtrip path has always had: the perpendicular
  // via-point may itself be unroutable (river, gated park), so retry
  // out-and-back before giving up.
  if (plan.hasReturnDetour && plan.waypoints.length === 3) {
    const outAndBack = await fetchWalkingRoute(origin, [
      plan.waypoints[0]!,
      plan.waypoints[2]!,
    ]);
    if (outAndBack) return settle(outAndBack, []);
  }
  return null;
}
