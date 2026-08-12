// Checks the shared dev password so the client can decide whether to
// enable the test affordances.
//
// It mints nothing and stores nothing. The client keeps the password it
// typed and presents it on the two routes that require it; this endpoint
// exists so /dev can tell somebody they got it wrong, instead of silently
// storing a bad password and leaving them to work out why the simulator
// does nothing.
//
// RATE LIMITED HARDER THAN ANYTHING ELSE. Every other limit in this app
// protects a resource; this one protects a single shared secret against
// being guessed, and it is the only endpoint where an attacker's whole
// strategy is volume. limitExpensive is 10/min per user — at that rate a
// six-character password is centuries of guessing, and a human typing one
// in never notices the ceiling.

import type { FastifyPluginAsync } from 'fastify';
import { limitExpensive } from '../lib/rateLimit.js';
import { hasDevKey } from '../lib/devAuth.js';

interface UnlockBody {
  password?: unknown;
}

const plugin: FastifyPluginAsync = async (app) => {
  app.post('/dev/unlock', limitExpensive, async (req, reply) => {
    const { password } = (req.body ?? {}) as UnlockBody;
    if (typeof password !== 'string' || password.length === 0) {
      return reply.code(400).send({ error: 'password required' });
    }

    if (!hasDevKey(password)) {
      // Deliberately says nothing about WHY. "No password is configured on
      // this deployment" and "you typed the wrong one" are the same answer
      // here, because the difference is only useful to somebody guessing.
      req.log.warn({ kind: 'dev_unlock_failed', userId: req.userId }, 'dev unlock rejected');
      return reply.code(403).send({ error: 'nope' });
    }

    req.log.info({ kind: 'dev_unlock', userId: req.userId }, 'dev tools unlocked');
    return { ok: true };
  });
};

export default plugin;
