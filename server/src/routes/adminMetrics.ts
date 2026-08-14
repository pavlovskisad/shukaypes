// Metrics for the admin console.
//
// Read-only, and gated by DASHBOARD_TOKEN — the key that opens nothing
// which writes, and is therefore the only one safe to keep in a browser.
// ADMIN_TOKEN can put any pet into the database and must never be pasted
// into a dashboard; that split is enforced in lib/adminAuth.ts, not here.
//
// Two formats from one computation. `?format=text` returns the same
// numbers as a terminal report, so "check the metrics" never requires a
// browser — which also means the console and a shell can never disagree
// about what the database says.
//
// Lives under /admin/ so it inherits the auth-plugin bypass: these
// endpoints authenticate themselves by token and must not mint a user
// row for whoever opens the console.

import type { FastifyPluginAsync } from 'fastify';
import { checkDashboardAuth } from '../lib/adminAuth.js';
import { limitExpensive } from '../lib/rateLimit.js';
import { collectMetrics, renderMetricsText } from '../services/metrics.js';

interface MetricsQuery {
  format?: string;
}

const plugin: FastifyPluginAsync = async (app) => {
  // limitExpensive (10/min): this is a dozen aggregates over every table
  // that matters, on a 512MB machine that is also serving walkers. A
  // dashboard left open on a refresh loop should not be able to compete
  // with the map for the database.
  app.get<{ Querystring: MetricsQuery }>(
    '/admin/metrics',
    limitExpensive,
    async (req, reply) => {
      if (!checkDashboardAuth(req.headers.authorization)) {
        reply.code(401);
        return { error: 'unauthorized' };
      }

      const metrics = await collectMetrics();

      if (req.query.format === 'text') {
        reply.type('text/plain; charset=utf-8');
        return renderMetricsText(metrics);
      }
      return metrics;
    },
  );
};

export default plugin;
