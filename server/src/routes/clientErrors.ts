// Where the client sends a crash.
//
// The app had no crash reporting of any kind: no error boundary, no
// window.onerror, no unhandledrejection handler. Four white-screen
// incidents are on record, and every one of them was found because a
// human noticed and said so. With a beta cohort that is not a plan —
// most people who hit a blank screen close the tab and never mention it.
//
// WHY NOT SENTRY. It is the obvious answer and it stays a fine one. This
// is cheaper for where the project actually is: no third-party
// dependency, nothing added to a bundle that is already ~1MB over
// cellular, no processor agreement or privacy disclosure for a beta
// running on EU/UA users, and crashes land in the same Fly logs and the
// same admin console as everything else. If volume or triage outgrows
// that, swapping the transport in services/crashReport.ts is the whole
// migration.
//
// UNAUTHENTICATED, DELIBERATELY. It is exempt from the auth hook so a
// crash can be reported by somebody who has no account yet — including
// somebody whose crash IS the account creation failing, which is
// precisely the report worth having. Nothing here reads or writes user
// data; it only logs. The cost of the exemption is that anybody can post
// noise, which the rate limit and the size cap bound.

import type { FastifyPluginAsync } from 'fastify';
import { limitRead } from '../lib/rateLimit.js';

// Enough for a message and a useful stack, small enough that this can
// never be an ingress for anything substantial.
const MAX_FIELD = 2000;
const MAX_STACK = 4000;

interface CrashBody {
  message?: string;
  stack?: string;
  // 'render' (the error boundary), 'window' (onerror), or
  // 'rejection' (unhandledrejection).
  kind?: string;
  // Where the user was. Helps far more than the stack on a minified
  // bundle.
  path?: string;
  userAgent?: string;
  // Anonymous client id. Not resolved to an account here — it is a
  // string for correlating repeat crashes from one device, nothing more.
  deviceId?: string;
}

function clamp(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  return s ? s.slice(0, max) : null;
}

const plugin: FastifyPluginAsync = async (app) => {
  app.post<{ Body: CrashBody }>('/client-errors', limitRead, async (req, reply) => {
    const body = req.body ?? {};
    const message = clamp(body.message, MAX_FIELD);
    if (!message) {
      reply.code(400);
      return { error: 'message required' };
    }

    // error level so it stands out in `fly logs` and so anything
    // watching for trouble can key on kind=client_error.
    req.log.error(
      {
        kind: 'client_error',
        crashKind: clamp(body.kind, 40) ?? 'unknown',
        message,
        stack: clamp(body.stack, MAX_STACK),
        path: clamp(body.path, 300),
        userAgent: clamp(body.userAgent, 300),
        deviceId: clamp(body.deviceId, 80),
      },
      'client crash reported',
    );

    // 204: the client is already broken; there is nothing useful to say
    // back, and a body it might try to parse is one more thing to go
    // wrong at the worst moment.
    reply.code(204);
    return null;
  });
};

export default plugin;
