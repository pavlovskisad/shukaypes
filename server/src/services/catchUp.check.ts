// Fixture check for the pocket-walk catch-up (services/catchUp.ts): the
// speed gate lets a walk through and refuses a car, the foreground case
// is untouched, and every plan it draws clears BOTH gates the live
// mechanic enforces — so a catch-up can never claim faster or denser
// than a walk with the screen on. Run with `pnpm check:catch-up`.
// No network, no database, no clock.

import { balance } from '../config/balance.js';
import { distanceMeters, type LatLng } from '../utils/geo.js';
import {
  judgeSegment,
  planCatchUpMarks,
  walkedMeters,
  WALK_CREDIT_FLOOR_M,
} from './catchUp.js';

const T = balance.territory;
const W = balance.walk;
const MAX_SEGMENT_M = 5000;

function fail(msg: string): never {
  console.error(`✗ catch-up: ${msg}`);
  process.exit(1);
}

// A point `m` metres due east of another, near enough for this latitude.
const KYIV: LatLng = { lat: 50.4501, lng: 30.5234 };
const mPerLng = 111_320 * Math.cos((KYIV.lat * Math.PI) / 180);
const east = (m: number): LatLng => ({ lat: KYIV.lat, lng: KYIV.lng + m / mPerLng });

// ---------------------------------------------------------------- gate

// The foreground case, untouched. A 15s sync at a brisk walk, and the
// same sync with a jumpy fix that would read as a sprint: both short,
// both allowed, neither judged on speed.
for (const [len, ms] of [
  [20, 15_000],
  [W.jitterFloorM - 1, 1_000],
  [W.jitterFloorM, 0],
] as const) {
  const v = judgeSegment(len, ms, MAX_SEGMENT_M);
  if (!v.ok || v.kind !== 'short') fail(`${len}m over ${ms}ms should be short, got ${JSON.stringify(v)}`);
}

// A real pocket walk: 700m in ten minutes is 1.17 m/s.
const walk = judgeSegment(700, 10 * 60_000, MAX_SEGMENT_M);
if (!walk.ok || walk.kind !== 'walked') fail(`700m/10min should be a walk, got ${JSON.stringify(walk)}`);

// THE COMMUTE. The case a speed test alone cannot see, because a commute
// is SLOW: 3km over nine hours is 0.09 m/s, far under the ceiling. On
// the stack before this bound it laid five marks in a line across the
// city. Nobody walked it.
const commute = judgeSegment(3000, 9 * 60 * 60_000, MAX_SEGMENT_M);
if (commute.ok) fail(`a nine-hour commute should be refused, got ${JSON.stringify(commute)}`);
if (commute.reason !== 'stale') fail(`the commute should be stale, got ${commute.reason}`);
if (planCatchUpMarks(KYIV, east(3000), Date.now(), 9 * 60 * 60_000).length !== 0) {
  fail('a nine-hour commute should plan no marks even if the gate is skipped');
}

// The clock bound binds short segments too — a stale anchor is stale
// whatever the displacement. Somebody reopening the app nine hours later
// fifty metres away did not walk fifty metres.
const staleShort = judgeSegment(50, 9 * 60 * 60_000, MAX_SEGMENT_M);
if (staleShort.ok) fail(`a short segment on a nine-hour-old anchor should be refused, got ${JSON.stringify(staleShort)}`);

// The window's own edge: inside it walks, a minute past it does not.
if (!judgeSegment(700, W.maxGapMs - 1000, MAX_SEGMENT_M).ok) fail('just inside maxGapMs should pass');
if (judgeSegment(700, W.maxGapMs + 1000, MAX_SEGMENT_M).ok) fail('just past maxGapMs should fail');

// A car, and a bike. Both cover ground; neither is a walk.
for (const [len, ms, what] of [
  [4000, 5 * 60_000, 'car at 13 m/s'],
  [700, 2 * 60_000, 'bike at 5.8 m/s'],
] as const) {
  const v = judgeSegment(len, ms, MAX_SEGMENT_M);
  if (v.ok) fail(`${what} should be refused, got ${JSON.stringify(v)}`);
  if (v.reason !== 'too-fast') fail(`${what} should be too-fast, got ${v.reason}`);
}

// No clock, or a clock that ran backwards: untimeable, so untrusted.
for (const ms of [0, -5000]) {
  const v = judgeSegment(700, ms, MAX_SEGMENT_M);
  if (v.ok) fail(`700m over ${ms}ms should be refused`);
}

// The absolute backstop still bites inside the window — checked before
// the pace, so an enormous segment is refused as too-long rather than
// as too-fast. (Outside the window `stale` gets there first, which is
// the same answer by a shorter road.)
const far = judgeSegment(MAX_SEGMENT_M + 1, W.maxGapMs - 1000, MAX_SEGMENT_M);
if (far.ok || far.reason !== 'too-long') fail(`past the backstop should be too-long, got ${JSON.stringify(far)}`);

// The boundary is walkable at exactly the limit, and not a hair above.
if (!judgeSegment(1000, (1000 / W.maxSpeedMps) * 1000, MAX_SEGMENT_M).ok) {
  fail('exactly maxSpeedMps should pass');
}
if (judgeSegment(1000, (1000 / (W.maxSpeedMps + 0.1)) * 1000, MAX_SEGMENT_M).ok) {
  fail('above maxSpeedMps should fail');
}

// ---------------------------------------------------------------- plan

// Nothing to catch up on a foreground segment, or a loop that came back
// to where it started — the endpoints are what we can prove, and a loop
// proves almost no displacement. Under-claiming is the safe error.
if (planCatchUpMarks(KYIV, east(30), Date.now(), 10 * 60_000).length !== 0) {
  fail('a short segment should plan no catch-up marks');
}
if (planCatchUpMarks(KYIV, KYIV, Date.now(), 30 * 60_000).length !== 0) {
  fail('a closed loop should plan no catch-up marks');
}

// THE INVARIANT. Over a wide spread of gaps, every plan must clear both
// gates markIfDue enforces — spacing in metres and spacing in seconds —
// or the catch-up would claim ground faster than a live walk can.
let planned = 0;
let capped = 0;
for (let lenM = W.jitterFloorM + 1; lenM <= MAX_SEGMENT_M; lenM += 37) {
  for (let gapS = 30; gapS <= 90 * 60; gapS += 53) {
    const elapsedMs = gapS * 1000;
    // Only plans for segments the gate would actually let through.
    if (!judgeSegment(lenM, elapsedMs, MAX_SEGMENT_M).ok) continue;
    const t0 = 1_600_000_000_000;
    const marks = planCatchUpMarks(KYIV, east(lenM), t0, elapsedMs);
    if (marks.length === 0) continue;
    planned++;
    if (marks.length === W.maxCatchUpMarks) capped++;

    if (marks.length > W.maxCatchUpMarks) {
      fail(`${lenM}m/${gapS}s planned ${marks.length} marks, over the cap`);
    }

    // Oldest first, and inside the window the walker was actually gone.
    if (marks[0]!.at <= t0) fail(`${lenM}m/${gapS}s: first mark not after the anchor`);
    if (marks[marks.length - 1]!.at >= t0 + elapsedMs) {
      fail(`${lenM}m/${gapS}s: last mark not before the new fix`);
    }

    // Ground spacing — including the two end gaps, since the live mark
    // at the segment end is measured against the last of these.
    const points = [KYIV, ...marks.map((m) => m.pos), east(lenM)];
    for (let i = 1; i < points.length; i++) {
      const d = distanceMeters(points[i - 1]!, points[i]!);
      if (d < T.minDistanceM - 0.5) {
        fail(`${lenM}m/${gapS}s: marks ${d.toFixed(1)}m apart, under the ${T.minDistanceM}m spacing`);
      }
    }

    // Clock spacing, same reasoning against the cooldown.
    const times = [t0, ...marks.map((m) => m.at), t0 + elapsedMs];
    for (let i = 1; i < times.length; i++) {
      const dt = times[i]! - times[i - 1]!;
      if (dt < T.cooldownMs - 1) {
        fail(`${lenM}m/${gapS}s: marks ${dt}ms apart, under the ${T.cooldownMs}ms cooldown`);
      }
    }
  }
}

if (planned < 100) fail(`only ${planned} plans exercised — the sweep is not covering enough`);
if (capped === 0) fail('never hit the cap — the sweep is not covering long gaps');

// The worked example from the design: ten minutes, 700m walked.
const ten = planCatchUpMarks(KYIV, east(700), 1_600_000_000_000, 10 * 60_000);
if (ten.length !== W.maxCatchUpMarks) {
  fail(`700m over 10min should plan the full ${W.maxCatchUpMarks}, got ${ten.length}`);
}


// ── walkedMeters: what the distance counter is allowed to believe ────
//
// The rule exists because judgeSegment SKIPS the speed test below the
// jitter floor, so `ok` alone would let a client walk 36 km/h. These
// cases are the ones that would have let it.

// A real walk at a real pace, credited whole.
{
  const m = walkedMeters(21, 15_000); // 1.4 m/s over one foreground tick
  if (m !== 21) fail(`a 21m walk over 15s should credit 21, got ${m}`);
}

// The phone on the table. Anything under the floor is nothing, however
// long it sat there — the drift is not a walk at any pace.
for (const [len, gap] of [
  [0, 15_000],
  [2, 15_000],
  [4.9, 15_000],
  [3, 600_000],
] as const) {
  const m = walkedMeters(len, gap);
  if (m !== 0) fail(`${len}m over ${gap}ms is jitter, should credit 0, got ${m}`);
}

// THE CASE THE CAP EXISTS FOR. 149m is under the 150m jitter floor, so
// judgeSegment waves it through as `short` — and at one sync every
// fifteen seconds, crediting it whole is 36 km/h of walking.
{
  const v = judgeSegment(149, 15_000, MAX_SEGMENT_M);
  if (!v.ok || v.kind !== 'short') fail('149m/15s should still be judged `short` — the premise changed');
  const m = walkedMeters(149, 15_000);
  const cap = Math.round(15 * W.maxSpeedMps);
  if (m !== cap) fail(`149m over 15s should cap at ${cap}, got ${m}`);
  if (m >= 149) fail('the cap did not bind on the case it exists for');
}

// The cap never binds on anybody walking. Swept across the plausible
// range of paces and tick lengths: a stroll to a brisk 1.9 m/s, one
// foreground tick to five minutes backgrounded.
let creditedWhole = 0;
for (let paceCms = 60; paceCms <= 190; paceCms += 10) {
  for (const gapS of [15, 30, 60, 120, 300]) {
    const len = (paceCms / 100) * gapS;
    if (len < WALK_CREDIT_FLOOR_M) continue;
    const m = walkedMeters(len, gapS * 1000);
    if (m !== Math.round(len)) {
      fail(`a walker at ${paceCms}cm/s over ${gapS}s was capped: ${m} of ${len.toFixed(1)}`);
    }
    creditedWhole++;
  }
}
if (creditedWhole < 50) fail(`only ${creditedWhole} walking paces exercised`);

// A segment we cannot time is a segment we cannot trust. Clock skew and
// a replayed anchor both land here, and both credit nothing.
for (const gap of [0, -1, -60_000]) {
  const m = walkedMeters(500, gap);
  if (m !== 0) fail(`a ${gap}ms gap should credit 0, got ${m}`);
}

// Nonsense in, zero out.
for (const len of [NaN, Infinity, -10]) {
  const m = walkedMeters(len, 15_000);
  if (m !== 0 && Number.isFinite(len)) fail(`${len}m should credit 0, got ${m}`);
  if (!Number.isFinite(len) && m !== 0) fail(`${len}m should credit 0, got ${m}`);
}

console.log(
  `✓ catch-up: gate holds (walk in, bike and car out), ${planned} plans clear both spacing rules, ${capped} at the cap`,
);
console.log(
  `✓ walked-metres: ${creditedWhole} walking paces credited whole, jitter and the 149m sub-floor jump both capped`,
);
