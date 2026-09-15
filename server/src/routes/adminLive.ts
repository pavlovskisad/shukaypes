// The console's live strip.
//
// Same key as /admin/metrics (DASHBOARD_TOKEN — the one that opens
// nothing which writes) and the same two formats, but a different rate
// limit on purpose: this is meant to be polled every twenty seconds,
// which /admin/metrics must never be. See services/live.ts for what
// keeps it cheap enough to allow that.

import type { FastifyPluginAsync } from 'fastify';
import { checkDashboardAuth } from '../lib/adminAuth.js';
import { limitRead } from '../lib/rateLimit.js';
import { collectLive, renderLiveText } from '../services/live.js';

interface LiveQuery {
  format?: string;
}

const plugin: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: LiveQuery }>('/admin/live', limitRead, async (req, reply) => {
    if (!checkDashboardAuth(req.headers.authorization)) {
      reply.code(401);
      return { error: 'unauthorized' };
    }
    const live = await collectLive();
    if (req.query.format === 'text') {
      reply.type('text/plain; charset=utf-8');
      return renderLiveText(live);
    }
    return live;
  });
};

export default plugin;
