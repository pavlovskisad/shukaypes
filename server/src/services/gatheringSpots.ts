// WHERE DOGS ACTUALLY OVERLAP.
//
// The «meet» leaf of the walk menu needs somewhere to send you where you
// might run into another dog and its owner. The honest source for that is
// not a list somebody typed: it is where walkers have actually been. Every
// dog leaves a territory mark every so often as it walks, so the mark
// table is a sampled trace of every walk anyone has taken — and the places
// where DIFFERENT walkers' traces pile up are the places dog people go.
//
// THE THING THIS HAS TO GET RIGHT is telling a gathering place apart from
// somebody's own street. One dog walking the same block fifty times leaves
// fifty marks; five dogs crossing the same park once each leave five. The
// second is the answer and the first is not, so the score counts DISTINCT
// WALKERS and lets the number of marks break ties at most. A walker is
// counted once, at their freshest visit, however many marks they left.
//
// It also has to age. A park everyone used in June is not where they are
// in December, and a table that only ever accumulates would freeze the
// city's answer at whatever was busiest first. So each walker's
// contribution decays with the age of their last visit, on a half-life.
//
// Pure, and separate from the route that reads the table, so the rule can
// be checked against fixtures instead of against production.

export interface WalkerMark {
  userId: string;
  lat: number;
  lng: number;
  at: Date;
}

export interface GatheringSpot {
  // Centre of mass of the marks that formed it, not a grid corner — the
  // grid is scaffolding for finding the cluster, not where it is.
  position: { lat: number; lng: number };
  // Distinct walkers seen here inside the window.
  walkers: number;
  marks: number;
  // Freshest mark in the cluster.
  lastAt: Date;
  // Sum of per-walker recency weights. Three walkers here today ≈ 3;
  // one walker here fifty times today ≈ 1.
  score: number;
}

export interface GatheringOptions {
  now: Date;
  // Radius that counts as "the same place". A gathering is a park gate or
  // a square, not a street address, and GPS scatter alone is tens of
  // metres.
  radiusM: number;
  // How long a visit keeps half its weight.
  halfLifeH: number;
  // Below this many distinct walkers a cluster is somebody's own route,
  // not a place to meet anyone.
  minWalkers: number;
  // Cap on returned spots.
  limit: number;
}

const M_PER_DEG_LAT = 111320;

function mPerDegLng(lat: number): number {
  return Math.max(1, M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
}

export function distanceM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = (a.lat - b.lat) * M_PER_DEG_LAT;
  const dLng = (a.lng - b.lng) * mPerDegLng((a.lat + b.lat) / 2);
  return Math.hypot(dLat, dLng);
}

// 1 at this instant, ½ after one half-life, and never negative however
// old the mark is.
function recency(at: Date, now: Date, halfLifeH: number): number {
  const ageH = (now.getTime() - at.getTime()) / 3_600_000;
  if (!(ageH > 0)) return 1;
  return Math.pow(0.5, ageH / Math.max(0.0001, halfLifeH));
}

// Score a set of marks as one place: one recency weight per distinct
// walker, taken at their freshest mark.
function scoreCluster(
  marks: WalkerMark[],
  now: Date,
  halfLifeH: number,
): { walkers: number; score: number; lastAt: Date } {
  const freshest = new Map<string, Date>();
  for (const m of marks) {
    const prev = freshest.get(m.userId);
    if (!prev || m.at.getTime() > prev.getTime()) freshest.set(m.userId, m.at);
  }
  let score = 0;
  let lastAt = new Date(0);
  for (const at of freshest.values()) {
    score += recency(at, now, halfLifeH);
    if (at.getTime() > lastAt.getTime()) lastAt = at;
  }
  return { walkers: freshest.size, score, lastAt };
}

function centroid(marks: WalkerMark[]): { lat: number; lng: number } {
  let lat = 0;
  let lng = 0;
  for (const m of marks) {
    lat += m.lat;
    lng += m.lng;
  }
  return { lat: lat / marks.length, lng: lng / marks.length };
}

/**
 * Cluster raw walker marks into the places worth being sent to.
 *
 * Two passes, because a single grid is the wrong tool on its own: a
 * gathering that happens to straddle a cell boundary gets cut in half, and
 * halving its walker count is exactly what drops it under minWalkers. So
 * the grid only NOMINATES centres, and every nomination is then re-counted
 * against a circle centred on its own centre of mass — which is where the
 * cluster actually is, wherever the lines happened to fall.
 *
 * Nominations are then taken best-first, skipping any that sit inside one
 * already taken, so two cells looking at the same park return it once.
 */
export function clusterGatherings(
  marks: WalkerMark[],
  opts: GatheringOptions,
): GatheringSpot[] {
  const { now, radiusM, halfLifeH, minWalkers, limit } = opts;
  if (marks.length === 0) return [];

  // Pass 1 — bucket onto a grid one cluster wide, to nominate centres
  // without comparing every mark with every other one.
  const cellDegLat = radiusM / M_PER_DEG_LAT;
  const buckets = new Map<string, WalkerMark[]>();
  for (const m of marks) {
    const gy = Math.floor(m.lat / cellDegLat);
    const gx = Math.floor(m.lng / (radiusM / mPerDegLng(m.lat)));
    const key = `${gy}:${gx}`;
    const list = buckets.get(key);
    if (list) list.push(m);
    else buckets.set(key, [m]);
  }

  // Pass 2 — re-count each nomination against a circle on its own centre
  // of mass, so the answer does not depend on where the grid lines fell.
  const scored: GatheringSpot[] = [];
  const seen = new Set<string>();
  for (const bucket of buckets.values()) {
    const c = centroid(bucket);
    // Cheap de-dup: two adjacent cells looking at the same cluster settle
    // on nearly the same centre of mass, so round it before comparing.
    const ckey = `${c.lat.toFixed(4)}:${c.lng.toFixed(4)}`;
    if (seen.has(ckey)) continue;
    seen.add(ckey);
    const near = marks.filter((m) => distanceM(m, c) <= radiusM);
    if (near.length === 0) continue;
    const at = centroid(near);
    const { walkers, score, lastAt } = scoreCluster(near, now, halfLifeH);
    if (walkers < minWalkers) continue;
    scored.push({ position: at, walkers, marks: near.length, lastAt, score });
  }

  // Best first, then non-maximum suppression: a weaker cluster whose
  // centre lies inside one already accepted is the same place seen again.
  scored.sort((a, b) => b.score - a.score || b.walkers - a.walkers);
  const out: GatheringSpot[] = [];
  for (const s of scored) {
    if (out.some((k) => distanceM(k.position, s.position) <= radiusM)) continue;
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}
