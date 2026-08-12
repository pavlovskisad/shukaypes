// Sends a crash somewhere a human will see it.
//
// Until now the app had no error boundary, no window.onerror and no
// unhandledrejection handler, so a render throw blanked the screen and
// left no trace anywhere. The four white-screen incidents on record were
// all found by somebody noticing and saying so. Beta testers mostly do
// not say so — they close the tab.
//
// Posts to our own API rather than a third-party service: no dependency,
// nothing added to a ~1MB bundle sent over Kyiv cellular, no processor
// agreement for EU/UA users, and crashes land in the same Fly logs as
// everything else. If triage ever outgrows that, this file is the only
// thing that has to change.
//
// EVERY PATH HERE SWALLOWS ITS OWN ERRORS. It runs at the exact moment
// the app is already broken; a reporter that throws while reporting
// turns one bad screen into an infinite loop.

import { env } from '../constants/env';
import { getDeviceId } from './deviceId';

export type CrashKind = 'render' | 'window' | 'rejection';

// A crash that repeats every frame — inside a render loop, say — would
// otherwise post thousands of times. First few only, then silence.
const MAX_REPORTS_PER_SESSION = 5;
let sent = 0;

// The same error arriving twice in a row is one story, not two.
let lastSignature = '';

export function reportCrash(kind: CrashKind, error: unknown, extra?: string): void {
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    const message = [err.message, extra].filter(Boolean).join(' | ').slice(0, 2000);
    const signature = `${kind}:${message}`;
    if (signature === lastSignature) return;
    lastSignature = signature;
    if (sent >= MAX_REPORTS_PER_SESSION) return;
    sent++;

    // Logged locally too. If the network is the thing that is broken,
    // the console is the only record there will be.
    // eslint-disable-next-line no-console
    console.error(`[crash:${kind}]`, err);

    const body = JSON.stringify({
      kind,
      message,
      stack: typeof err.stack === 'string' ? err.stack.slice(0, 4000) : undefined,
      path: typeof window !== 'undefined' ? window.location?.pathname : undefined,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      deviceId: safeDeviceId(),
    });

    // keepalive so the report survives the user closing the tab on a
    // blank screen, which is the most likely thing for them to do next.
    void fetch(`${env.apiUrl}/client-errors`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      /* the app is already broken; there is nothing to escalate to */
    });
  } catch {
    /* see above — reporting must never be the thing that fails */
  }
}

function safeDeviceId(): string | undefined {
  try {
    return getDeviceId();
  } catch {
    // getDeviceId touches localStorage, which throws in some private
    // modes. A crash report without an id is still worth having.
    return undefined;
  }
}

/**
 * Catches the errors a React boundary cannot: throws outside render, and
 * promise rejections nobody handled. Idempotent.
 */
let installed = false;
export function installGlobalCrashHandlers(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (event) => {
    reportCrash('window', event.error ?? event.message, event.filename);
  });

  window.addEventListener('unhandledrejection', (event) => {
    reportCrash('rejection', event.reason);
  });
}
