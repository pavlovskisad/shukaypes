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
import { readHistory } from '../services/metricsHistory.js';

interface LiveQuery {
  format?: string;
}

interface HistoryQuery {
  hours?: string;
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

  // The same key opens the history: it is the same numbers, older. One
  // row every five minutes (D-84), oldest first, so the console can draw
  // a line without sorting anything.
  app.get<{ Querystring: HistoryQuery }>('/admin/history', limitRead, async (req, reply) => {
    if (!checkDashboardAuth(req.headers.authorization)) {
      reply.code(401);
      return { error: 'unauthorized' };
    }
    const hours = Number(req.query.hours ?? 24) || 24;
    return { hours, rows: await readHistory(hours) };
  });
};

export default plugin;
