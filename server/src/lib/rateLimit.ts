// Per-route rate limits, as named tiers rather than numbers sprinkled
// across twelve files.
//
// The limiter is registered `global: false` (index.ts), so a route with
// no config has NO limit at all — the plugin default applies to nothing.
// That is why this file exists: the tiers make it obvious which routes
// have been considered, and adding a route without one is then a visible
// omission rather than an invisible default.
//
// Sizing rule: these are abuse ceilings, not fairness quotas. Every
// number is set well above what the client actually does, because a
// limit that trips during normal play is a bug that looks like a
// network fault. The client's real cadence, for reference:
//
//   /sync/map      every 15s, plus a movement-triggered sync no more
//                  often than every 4s  ->  up to ~15/min for a runner
//   /presence      every 3s             ->  ~20/min
//   /collect/path  rides the same 15s loop as /sync/map
//
// The expensive tiers are the ones that spend money per call — an LLM
// turn or a fan-out of billable Google Places lookups — and those are
// deliberately much tighter than the rest.

import type { FastifyRequest } from 'fastify';

// The caller's real IP, as Fly reports it.
//
// Fly sets `Fly-Client-IP` to the peer address seen at its edge and
// overwrites any value the caller sent, so it cannot be spoofed. `req.ip`
// cannot be trusted for this: under `trustProxy` it is derived from the
// `X-Forwarded-For` chain, which the caller can write — so an attacker
// rotates that header to get a fresh rate-limit bucket per request and
// every per-IP limit becomes a no-op. Every IP-keyed limiter keys on this
// instead, and falls back to `req.ip` only off-Fly (local/dev).
export function clientIp(req: FastifyRequest): string {
  const raw = req.headers['fly-client-ip'];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (v && v.trim()) || req.ip;
}

interface RouteConfig {
  config: {
    rateLimit: {
      max: number;
      timeWindow: string;
      keyGenerator?: (req: FastifyRequest) => string;
    };
  };
}

function perMinute(max: number): RouteConfig {
  return { config: { rateLimit: { max, timeWindow: '1 minute' } } };
}

/** Hot polling paths. Comfortably above the client's real cadence. */
export const limitPolling = perMinute(60);

/** User-initiated taps: collect, feed, advance a quest. */
export const limitInteractive = perMinute(60);

/** Reads that are cheap for us but worth bounding. */
export const limitRead = perMinute(30);

/**
 * Calls that cost real money per request — an LLM turn, or a Places
 * fan-out. A human cannot legitimately need these often.
 */
export const limitExpensive = perMinute(10);

/** Image proxying: many per screen, cheap each, but not unbounded. */
export const limitMedia = perMinute(120);

/**
 * Credential endpoints that run BEFORE anybody is identified — login,
 * password reset, token exchange. Keyed by address, not user: the
 * global key falls through to `req.ip` when there is no userId, but
 * saying so here keeps a future "identify first" change from quietly
 * turning a guess-the-password limit into a per-guesser one. Tight,
 * because a human logs in once and a script does not.
 */
export const limitAuth: RouteConfig = {
  config: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: clientIp } },
};

/**
 * Account creation. Keyed on the real IP, NOT the userId — the auth hook
 * mints a fresh userId for every new device id, so a userId-keyed limit
 * here resets on every attempt and bounds nothing. A person registers
 * once; a script does not.
 */
export const limitCreate: RouteConfig = {
  config: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: clientIp } },
};
