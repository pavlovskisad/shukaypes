// Fixture check for the pocket-walk catch-up (services/catchUp.ts): the
// speed gate lets a walk through and refuses a car, the foreground case
// is untouched, and every plan it draws clears BOTH gates the live
// mechanic enforces — so a catch-up can never claim faster or denser
// than a walk with the screen on. Run with `pnpm check:catch-up`.
// No network, no database, no clock.

import { balance } from '../config/balance.js';
import { distanceMeters, type LatLng } from '../utils/geo.js';
import { judgeSegment, planCatchUpMarks } from './catchUp.js';

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

// The absolute backstop still bites, however long the walker was gone.
const far = judgeSegment(MAX_SEGMENT_M + 1, 12 * 60 * 60_000, MAX_SEGMENT_M);
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

console.log(
  `✓ catch-up: gate holds (walk in, bike and car out), ${planned} plans clear both spacing rules, ${capped} at the cap`,
);
