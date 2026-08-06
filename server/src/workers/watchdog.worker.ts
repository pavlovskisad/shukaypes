// The watching half of the dead man's switch. See services/watchdog.ts.
//
// This thread's only job is to still be running when the main one isn't.
// It touches nothing: no database, no config, no imports beyond the two
// below — every dependency is another way for the watcher to be the thing
// that breaks.

import { writeSync } from 'node:fs';
import { workerData } from 'node:worker_threads';

const beat = new Float64Array(workerData as SharedArrayBuffer);
const CHECK_MS = 1_000;

setInterval(() => {
  const last = beat[0]!;
  const stallMs = beat[1]!;
  const age = Date.now() - last;
  if (age < stallMs) return;

  // writeSync, NOT console.error.
  //
  // console.error to a pipe — which is what stderr is under Fly — queues
  // the write and returns. SIGKILL then lands before the queue drains and
  // the line is simply lost. The first version of this file did exactly
  // that: the watchdog fired correctly in testing and printed nothing,
  // which would have left the next incident as an unexplained restart.
  //
  // This line is the only evidence anyone will ever get about why the
  // process died, so it is written straight to fd 2 and is on its way out
  // before the next statement runs.
  writeSync(
    2,
    `[watchdog] event loop blocked for ${Math.round(age / 1000)}s ` +
      `(last beat ${new Date(last).toISOString()}) — killing the process so it restarts\n`,
  );

  // SIGKILL, not exit(): process.exit() from a worker ends the worker
  // alone, and any softer signal is handled by the main thread's event
  // loop, which is the thing that is not running. Nothing in this process
  // can refuse SIGKILL, which is the only guarantee that matters here.
  process.kill(process.pid, 'SIGKILL');
}, CHECK_MS);
