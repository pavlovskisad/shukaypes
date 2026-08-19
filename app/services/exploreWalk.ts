import type { LatLng } from '@shukajpes/shared';
import { api } from './api';
import { fetchWalkingRoute } from './directions';
import type { Park } from './places';
import {
  mergeCandidates,
  parkCandidates,
  planWalkOptions,
  loadRecentStopIds,
  recordRecentStops,
  recordRecentDestination,
  WALK_FAR_M,
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

// How far off the planned line a landmark may sit.
//
// MEASURED, not guessed. Swept 160→320 m against all 2671 production
// kyiv_lore rows, from the 36 neighbourhood centroids in
// pipeline/landmarks.ts, 8 bearings each, scoring the rate at which a
// walk reaches two stops when the client picks the best of its four
// candidates:
//
//   corridor   close 1-way / roundtrip     far 1-way / roundtrip    worst +m
//      160 m        53% / 69%                   91% / 93%            125–387
//      240 m        58% / 72%                   92% / 95%            176–460
//      320 m        65% / 75%                   94% / 96%            282–687
//
// 240 for both, and the two lengths land on it for opposite reasons:
// short walks are where the yield curve flattens (past 240 the gain is a
// few points for a third more detour), long walks are where the
// worst-case detour starts climbing (460 → 687 m for +1%). The floor on
// short walks in the outer districts is the density of the corpus, not
// this number — no corridor rescues a kilometre of Troieshchyna.
//
// The server clamps this and derives the rest (spacing, detour budget)
// from the path it is given.
const CORRIDOR_M = 240;

// Stops per walk. The ask was "at least a few", and three is the point
// where a walk reads as a route with stops rather than a detour to one
// thing. A long walk can carry a fourth.
const MAX_STOPS_CLOSE = 3;
const MAX_STOPS_FAR = 4;

// How far out to ask our own tables for destinations. The far walk is
// the longest the planner proposes, and a one-way version of it puts the
// destination a full WALK_FAR_M away — so anything past that plus a
// margin can never be picked.
const DESTINATION_RADIUS_M = WALK_FAR_M + 500;

export interface ExplorationWalk {
  // The drawn polyline, routed through the stops.
  route: LatLng[];
  primary: WalkCandidate;
  shape: WalkShape;
  // In visiting order. Empty is a normal, valid walk.
  stops: WalkStop[];
  // True when the line is straight segments between the points rather
  // than street geometry — Google routing was unavailable. The walk is
  // real either way; only the drawing of it is approximate.
  approximate: boolean;
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
        corridorM: CORRIDOR_M,
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

// The tour's pool: parks and squares, museums and landmarks, out of our
// own tables, plus whatever parks Places happens to know about. A
// failure fetching ours is not fatal — Places parks alone can still
// carry a walk; if there are none either, the caller gets no plans and
// says so.
async function poolFor(
  origin: LatLng,
  parks: Park[],
): Promise<WalkCandidate[]> {
  const base = parkCandidates(parks);
  try {
    const { destinations } = await api.walkDestinations(
      origin,
      DESTINATION_RADIUS_M,
    );
    return mergeCandidates(base, destinations);
  } catch {
    return base;
  }
}

export async function startExplorationWalk(args: {
  origin: LatLng;
  // Google Places parks, which the store already holds for bone
  // seeding. Places SPOTS are deliberately not a parameter: going to a
  // named café or the vet is what visit:spot / walk_to_spot are for, and
  // a walk is a small local tour.
  parks: Park[];
  shape: WalkShape;
  distance: WalkDistance;
}): Promise<ExplorationWalk | null> {
  const { origin, parks, shape, distance } = args;
  const plans = planWalkOptions({
    candidates: await poolFor(origin, parks),
    origin,
    shape,
    distance,
    count: CANDIDATE_COUNT,
  });
  if (plans.length === 0) return null;

  const chosen = bestCandidate(await costCandidates(plans, distance));
  if (!chosen) return null;
  const { plan, stops } = chosen;

  const settle = (
    line: { path: LatLng[]; approximate: boolean },
    withStops: WalkStop[],
  ): ExplorationWalk => {
    // Only record what the walker actually got. A destination we
    // couldn't route to must not be penalised on the next tap, and
    // landmarks on a route that never rendered are still unseen.
    recordRecentDestination(plan.primary.id);
    if (withStops.length) recordRecentStops(withStops.map((s) => s.id));
    return {
      route: line.path,
      primary: plan.primary,
      shape,
      stops: withStops,
      approximate: line.approximate,
    };
  };

  // First choice: the walk through the landmarks, on real streets.
  const viaStops = await fetchWalkingRoute(origin, chosen.waypoints);
  if (viaStops) return settle({ path: viaStops, approximate: false }, stops);

  // A stop the directions API can't walk to (inside a closed courtyard,
  // on an island, behind a fence) fails the WHOLE call, taking the walk
  // with it. Retry without the stops to find out whether the stops were
  // the problem or routing is unavailable altogether.
  const plain = await fetchWalkingRoute(origin, plan.waypoints);
  if (plain) return settle({ path: plain, approximate: false }, []);

  // Same fallback the roundtrip path has always had: the perpendicular
  // via-point may itself be unroutable (river, gated park), so retry
  // out-and-back.
  if (plan.hasReturnDetour && plan.waypoints.length === 3) {
    const outAndBack = await fetchWalkingRoute(origin, [
      plan.waypoints[0]!,
      plan.waypoints[2]!,
    ]);
    if (outAndBack) return settle({ path: outAndBack, approximate: false }, []);
  }

  // Nothing routed at all, which in practice means Google is not
  // answering us — no key, no quota, no billing. Everything that makes
  // this walk a walk still exists, so draw it as straight segments and
  // KEEP THE STOPS: the point of the exploration is the places and their
  // stories, and those are ours, not Google's.
  //
  // Built here rather than through fetchWalkingRouteOrLine, which would
  // spend a fourth request re-asking a service that has already declined
  // three times.
  return settle({ path: [origin, ...chosen.waypoints], approximate: true }, stops);
}
