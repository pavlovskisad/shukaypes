// Worker entry for the claim geometry. Deliberately tiny: take a plan
// request, run the pure planner, post the answer back.
//
// It imports groundGeometry and nothing else, which is the property that
// matters — no database pool, no config singleton, no Redis client. A
// worker that pulled those in would open a connection per spawn, and this
// one gets terminated and respawned whenever a claim runs away.

import { parentPort } from 'node:worker_threads';
import { planClaim, type ClaimPlanInput } from '../services/groundGeometry.js';

if (!parentPort) throw new Error('groundGeometry.worker must be run as a worker thread');

parentPort.on('message', (msg: { id: number; input: ClaimPlanInput }) => {
  // No try/catch around planClaim: it already returns a 'noop' plan for
  // every clipper throw it expects. Anything that escapes is a bug we want
  // surfaced as a worker 'error' event, not swallowed into a silent
  // do-nothing claim that nobody ever investigates.
  parentPort!.postMessage({ id: msg.id, plan: planClaim(msg.input) });
});
