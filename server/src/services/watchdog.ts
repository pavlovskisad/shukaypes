// A dead man's switch for the event loop.
//
// The geometry worker fixes the wedge we know about. This fixes the class:
// ANY synchronous work that never returns takes the server with it, and it
// does so silently, because a process that cannot run its event loop also
// cannot log, cannot answer a health check, and cannot crash. On
// 2026-08-05 that cost eleven hours. Fly's health check noticed within
// thirty seconds and had no way to act on what it noticed.
//
// So: the main thread stamps the current time into shared memory once a
// second. A worker thread — which has its own event loop, unaffected by
// whatever the main one is doing — reads that stamp and kills the process
// if it goes stale. Fly's restart policy brings it straight back.
//
// Shared memory, not postMessage: a message from the watchdog would land
// in the main thread's queue, which is precisely the thing that is not
// being drained. Atomics on a SharedArrayBuffer are read and written
// without either side taking a turn.
//
// The trade is honest and worth stating: this converts a silent permanent
// outage into a visible restart loop. If something wedges on every boot
// the server will kill itself repeatedly — noisy, alarming, and far easier
// to diagnose than a process that sits there looking healthy.

import { Worker } from 'node:worker_threads';

// How long the loop may be blocked before we call it dead.
//
// Nothing legitimate comes close. The heaviest tick ever logged was 1.4s
// for thirty bots including their database round-trips, and the claim
// geometry is bounded at 2s by its own worker timeout. Thirty seconds is
// twenty times the worst honest number, so a kill here is never a slow
// server — it is a stopped one.
const STALL_MS = 30_000;
const BEAT_MS = 1_000;

export function startWatchdog(): () => void {
  let worker: Worker | null = null;
  // Two slots of float64: [0] the heartbeat timestamp, [1] the stall
  // threshold, so the worker needn't be told anything at construction.
  const sab = new SharedArrayBuffer(16);
  const beat = new Float64Array(sab);
  beat[0] = Date.now();
  beat[1] = STALL_MS;

  const timer = setInterval(() => {
    beat[0] = Date.now();
  }, BEAT_MS);
  // Never the reason the process stays alive — the HTTP server is.
  timer.unref();

  try {
    worker = new Worker(
      new URL(
        import.meta.url.endsWith('.ts')
          ? '../workers/watchdog.worker.ts'
          : '../workers/watchdog.worker.js',
        import.meta.url,
      ),
      { workerData: sab },
    );
    worker.unref();
    worker.on('error', (err) => {
      // A watchdog that died is a watchdog that is not watching. Say so
      // loudly; the server keeps running, just without the safety net.
      console.error('[watchdog] stopped watching', err);
    });
  } catch (err) {
    console.error('[watchdog] could not start', err);
  }

  return () => {
    clearInterval(timer);
    void worker?.terminate();
  };
}
