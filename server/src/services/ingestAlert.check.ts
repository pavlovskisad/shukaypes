// Fixture check for the ingest alert state machine.
// Run with: pnpm --filter @shukajpes/server check:ingest-alert
//
// The claim being checked is not "it can send a message" — it is "it
// sends exactly one, at the right moment, and says all-clear afterwards".
// That is a claim about transitions, and transitions are the part that
// looks obviously correct while being wrong. An alerting path that
// repeats hourly gets muted, and a muted alert is the same silence it
// was built to remove.
//
// Uses an in-memory store and a capturing notifier, so this touches no
// redis and messages nobody. Exits non-zero on failure.

import { evaluateIngestHealth, type AlertStore } from './ingestAlert.js';
import type { SourceRunSummary } from '../pipeline/source.js';

const HOUR = 3_600_000;

function memoryStore(): AlertStore & { fail: boolean } {
  const m = new Map<string, string>();
  const guard = <T>(fn: () => T): T => {
    if (store.fail) throw new Error('redis down');
    return fn();
  };
  const store = {
    fail: false,
    get: async (k: string) => guard(() => m.get(k) ?? ''),
    set: async (k: string, v: string) => guard(() => void m.set(k, v)),
    del: async (k: string) => guard(() => void m.delete(k)),
    incr: async (k: string) =>
      guard(() => {
        const n = Number(m.get(k) ?? 0) + 1;
        m.set(k, String(n));
        return n;
      }),
  };
  return store;
}

const silentLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

function summary(over: Partial<SourceRunSummary> = {}): SourceRunSummary {
  return {
    source: 'olx',
    discovered: 0,
    skipped: 0,
    parsed: 0,
    inserted: 0,
    updated: 0,
    duplicate: 0,
    errors: 0,
    errorMessages: [],
    ...over,
  };
}

const blocked = () =>
  summary({ discovered: 20, parsed: 0, errors: 20, errorMessages: ['403 after 3 attempts'] });
const healthy = (inserted = 2) => summary({ discovered: 20, parsed: 5, inserted });
// Discovered nothing and errored nothing: a quiet source, not a blocked
// one. TELEGRAM_CHANNELS being unset looks exactly like this, and it
// must never be reported as a failure.
const idle = () => summary({ source: 'telegram' });

// The shapes below are copied from a real production tick on 11 Aug,
// which is how the original rule's false positive was found. They are
// here so it cannot come back.

// A perfectly ordinary quiet hour: everything discovered was already in
// scrape_log, so nothing parsed. With ~4 new ads a day against 24 ticks
// this is the COMMON case, not the exceptional one.
const quietHour = () => summary({ discovered: 251, skipped: 251, parsed: 0, errors: 0 });

// The same quiet hour with one ad deleted between listing and fetch.
const quietHourWithBlip = () =>
  summary({ discovered: 251, skipped: 251, parsed: 0, errors: 1, errorMessages: ['ad -> 410'] });

// Facebook every single tick, forever, until cookies are provided.
const disabledSource = () =>
  summary({ source: 'facebook', errors: 1, errorMessages: ['FACEBOOK_COOKIES not set — source disabled'] });

// The exact 11 Aug OLX tick: 7 of 13 listings refused, 6 served, 251
// ads seen, and 17 pets inserted over the preceding week. Degraded
// coverage while still delivering. Must not alert.
const degradedButWorking = () =>
  summary({
    discovered: 251,
    skipped: 251,
    parsed: 0,
    errors: 7,
    errorMessages: ['[listing …byuro-nahodok/kiev/] -> 403'],
  });

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    failures++;
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  // 1. A blocked source alerts on the third consecutive tick, not before.
  {
    const store = memoryStore();
    const sent: string[] = [];
    const notify = async (t: string) => {
      sent.push(t);
      return true;
    };
    const deps = { store, notify, nowMs: Date.now() };
    await evaluateIngestHealth([blocked()], silentLog, deps);
    check('1a no alert on first blocked tick', sent.length === 0, `sent ${sent.length}`);
    await evaluateIngestHealth([blocked()], silentLog, deps);
    check('1b no alert on second blocked tick', sent.length === 0, `sent ${sent.length}`);
    await evaluateIngestHealth([blocked()], silentLog, deps);
    check('1c alerts on third', sent.length === 1, `sent ${sent.length}`);
    check('1d names the source', sent[0]?.includes('olx') ?? false);

    // 2. And then stays quiet, however long it stays broken.
    for (let i = 0; i < 5; i++) await evaluateIngestHealth([blocked()], silentLog, deps);
    check('2 does not repeat while still blocked', sent.length === 1, `sent ${sent.length}`);

    // 3. Recovery is announced once.
    await evaluateIngestHealth([healthy()], silentLog, deps);
    check('3a announces recovery', sent.length === 2, `sent ${sent.length}`);
    check('3b recovery says working again', sent[1]?.includes('working again') ?? false);
    await evaluateIngestHealth([healthy()], silentLog, deps);
    check('3c no repeat all-clear', sent.length === 2, `sent ${sent.length}`);
  }

  // 4. An idle source is not a blocked source. TELEGRAM_CHANNELS unset
  //    produces this shape forever and must never alert.
  {
    const store = memoryStore();
    const sent: string[] = [];
    const deps = { store, notify: async (t: string) => (sent.push(t), true), nowMs: Date.now() };
    for (let i = 0; i < 10; i++) await evaluateIngestHealth([idle()], silentLog, deps);
    check('4 idle source never alerts', sent.length === 0, `sent ${sent.length}`);
  }

  // 4b. Regression cases from the real 11 Aug tick. A quiet hour is not
  //     a blocked source, with or without a single stray error, and a
  //     source that is merely switched off must never page anybody.
  {
    const store = memoryStore();
    const sent: string[] = [];
    const deps = { store, notify: async (t: string) => (sent.push(t), true), nowMs: Date.now() };
    for (let i = 0; i < 10; i++) await evaluateIngestHealth([quietHour()], silentLog, deps);
    check('4b quiet hour never alerts', sent.length === 0, `sent ${sent.length}`);
    for (let i = 0; i < 10; i++) await evaluateIngestHealth([quietHourWithBlip()], silentLog, deps);
    check('4c quiet hour + one 410 never alerts', sent.length === 0, `sent ${sent.length}`);
    for (let i = 0; i < 10; i++) await evaluateIngestHealth([disabledSource()], silentLog, deps);
    check('4d disabled source never alerts', sent.length === 0, `sent ${sent.length}`);
    // Degraded-but-delivering is the state OLX has actually been in
    // while inserting 17 pets a week. If this ever alerts, the channel
    // gets muted and the real outage goes unread.
    for (let i = 0; i < 10; i++) await evaluateIngestHealth([degradedButWorking()], silentLog, deps);
    check('4e degraded-but-working never alerts', sent.length === 0, `sent ${sent.length}`);
  }

  // 5. Pipeline stall: silent until the threshold, then exactly once.
  {
    const store = memoryStore();
    const sent: string[] = [];
    const notify = async (t: string) => (sent.push(t), true);
    const t0 = 1_000_000_000_000;
    // Seed: a tick that inserted something.
    await evaluateIngestHealth([healthy()], silentLog, { store, notify, nowMs: t0 });
    check('5a insert does not alert', sent.length === 0, `sent ${sent.length}`);
    // 12h later, nothing inserted — too early to complain.
    await evaluateIngestHealth([summary({ discovered: 5, parsed: 5 })], silentLog, {
      store, notify, nowMs: t0 + 12 * HOUR,
    });
    check('5b quiet before threshold', sent.length === 0, `sent ${sent.length}`);
    // 40h later — past the 36h default.
    await evaluateIngestHealth([summary({ discovered: 5, parsed: 5 })], silentLog, {
      store, notify, nowMs: t0 + 40 * HOUR,
    });
    check('5c alerts past threshold', sent.length === 1, `sent ${sent.length}`);
    await evaluateIngestHealth([summary({ discovered: 5, parsed: 5 })], silentLog, {
      store, notify, nowMs: t0 + 50 * HOUR,
    });
    check('5d does not repeat', sent.length === 1, `sent ${sent.length}`);
    // A pet arrives.
    await evaluateIngestHealth([healthy(1)], silentLog, { store, notify, nowMs: t0 + 60 * HOUR });
    check('5e announces recovery', sent.length === 2, `sent ${sent.length}`);
    check('5f recovery mentions arriving', sent[1]?.includes('arriving again') ?? false);
  }

  // 6. First boot against an empty store seeds the clock instead of
  //    reporting "no pets since 1970".
  {
    const store = memoryStore();
    const sent: string[] = [];
    await evaluateIngestHealth([summary({ discovered: 3, parsed: 3 })], silentLog, {
      store, notify: async (t: string) => (sent.push(t), true), nowMs: Date.now(),
    });
    check('6 fresh store does not alert on first run', sent.length === 0, `sent ${sent.length}`);
  }

  // 7. A dead store must not alert and must not throw. Losing memory is
  //    not evidence of a stall.
  {
    const store = memoryStore();
    store.fail = true;
    const sent: string[] = [];
    let threw = false;
    try {
      for (let i = 0; i < 4; i++) {
        await evaluateIngestHealth([blocked()], silentLog, {
          store, notify: async (t: string) => (sent.push(t), true), nowMs: Date.now(),
        });
      }
    } catch {
      threw = true;
    }
    check('7a store failure does not throw', !threw);
    check('7b store failure does not alert', sent.length === 0, `sent ${sent.length}`);
  }

  if (failures === 0) {
    console.log('✓ ingest alert state machine: all cases pass');
  } else {
    console.error(`\n✗ ${failures} case(s) failed`);
    process.exit(1);
  }
}

main();
