// Running the claim geometry somewhere it can be killed.
//
// The whole point of this file is the `terminate()` call. `planClaim` is
// synchronous CPU work in a third-party clipper, and on 2026-08-05 one
// call into it never returned — the event loop stopped, health checks went
// unanswered, and the server sat spinning against its CPU throttle for
// eleven hours without logging a single line. Nothing crashed. There was
// nothing to crash: the process was perfectly healthy apart from being
// permanently busy.
//
// A timeout cannot help you on the main thread, because the code that
// would notice the timeout is queued behind the loop that is not ending.
// A worker thread can be terminated mid-instruction from outside. That is
// the only reliable lever against this class of bug, so the geometry runs
// in a worker and the main thread holds the stopwatch.
//
// One worker, not a pool: claims are already serialised by the per-cell
// advisory lock, so a second worker would spend its life idle. If claim
// throughput ever becomes the bottleneck this is where a pool goes.

import { Worker } from 'node:worker_threads';
import type { ClaimPlan, ClaimPlanInput } from './groundGeometry.js';

// How long a claim may spend in the clipper before we call it lost.
//
// Real claims land in single-digit milliseconds; the slowest cron tick
// ever logged was 1.4s for THIRTY bots including their database work. Two
// seconds is far outside anything healthy and far inside a player noticing
// — and the failure mode is one mark doing nothing, not an outage.
const CLAIM_TIMEOUT_MS = 2_000;

// A worker that dies on startup is worth saying out loud once rather than
// on every claim forever.
let warnedNoWorker = false;

const entryUrl = new URL(
  // tsx runs the TypeScript directly in dev; the Docker image runs the
  // compiled dist. Follow whichever this module itself was loaded as.
  import.meta.url.endsWith('.ts')
    ? '../workers/groundGeometry.worker.ts'
    : '../workers/groundGeometry.worker.js',
  import.meta.url,
);

type Waiter = { resolve: (plan: ClaimPlan | null) => void; timer: NodeJS.Timeout };

// A worker and the requests that belong to IT.
//
// The pending map is per-worker rather than global, and that is not
// tidiness. Terminate is asynchronous: the dying worker's 'exit' arrives
// after its replacement has already been spawned and given work. With one
// shared map, that late 'exit' cancelled the new worker's request too, so
// the claim after a runaway always failed. Caught by a test that killed a
// worker and then asked the pool to do something useful.
interface Slot {
  w: Worker;
  pending: Map<number, Waiter>;
}

let slot: Slot | null = null;
let nextId = 1;

function settleAll(s: Slot): void {
  for (const [, p] of s.pending) {
    clearTimeout(p.timer);
    p.resolve(null);
  }
  s.pending.clear();
}

function spawn(): Slot | null {
  try {
    const s: Slot = { w: new Worker(entryUrl), pending: new Map() };
    s.w.unref(); // never hold the process open on the worker's account
    s.w.on('message', (msg: { id: number; plan: ClaimPlan }) => {
      const p = s.pending.get(msg.id);
      if (!p) return; // already timed out
      s.pending.delete(msg.id);
      clearTimeout(p.timer);
      p.resolve(msg.plan);
    });
    s.w.on('error', (err) => {
      console.error('[ground] geometry worker error', err);
      if (slot === s) slot = null;
      settleAll(s);
    });
    s.w.on('exit', () => {
      // Covers the terminate() below as well as any unexpected death: the
      // next claim spawns a fresh one. Only this worker's own requests are
      // settled — see the note on Slot.
      if (slot === s) slot = null;
      settleAll(s);
    });
    return s;
  } catch (err) {
    if (!warnedNoWorker) {
      warnedNoWorker = true;
      console.error('[ground] could not start the geometry worker', err);
    }
    return null;
  }
}

/**
 * Plan a claim in a worker thread.
 *
 * Returns null when the geometry could not be completed — a timeout, a
 * crashed worker, or a worker that would not start. Every one of those
 * means the same thing to the caller: this mark changes nothing. A dog
 * marked and no ground moved, which is a disappointment. The alternative
 * is the server stopping, which is not.
 */
export async function planClaimInWorker(input: ClaimPlanInput): Promise<ClaimPlan | null> {
  slot ??= spawn();
  const s = slot;
  if (!s) return null;

  const id = nextId++;
  return new Promise<ClaimPlan | null>((resolve) => {
    const timer = setTimeout(() => {
      s.pending.delete(id);
      // The worker is wedged, not slow. It cannot be reasoned with and it
      // will not finish; kill the thread and let the next claim start a
      // clean one. This is the line that would have turned an eleven-hour
      // outage into one lost mark.
      console.error(
        `[ground] geometry timed out after ${CLAIM_TIMEOUT_MS}ms — terminating the worker`,
      );
      if (slot === s) slot = null;
      void s.w.terminate();
      resolve(null);
    }, CLAIM_TIMEOUT_MS);
    // Unref'd so a claim in flight can never hold the process open during
    // shutdown; the promise still settles because terminate/exit settles it.
    timer.unref?.();
    s.pending.set(id, { resolve, timer });
    try {
      s.w.postMessage({ id, input });
    } catch (err) {
      s.pending.delete(id);
      clearTimeout(timer);
      console.error('[ground] could not post to the geometry worker', err);
      resolve(null);
    }
  });
}

/**
 * Start the worker before anyone needs it.
 *
 * Spawning costs a few hundred milliseconds, and the first claim would
 * otherwise pay that INSIDE its transaction, holding the per-cell advisory
 * locks the whole time. Cheap to do at boot; awkward to do under a lock.
 */
export function warmGroundWorker(): void {
  slot ??= spawn();
}
