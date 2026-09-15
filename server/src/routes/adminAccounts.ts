// The people behind the numbers.
//
// Its own file rather than a third handler in adminLive.ts, because this
// is the only admin endpoint that returns PERSONAL DATA and that deserves
// to be visible in the file tree rather than buried. Same dashboard key
// as the rest of the console — the addresses it carries are already
// masked by services/accounts.ts before they leave the process, so the
// key still opens nothing that could be used to reach anybody.
//
// limitExpensive rather than limitRead: it is two queries over the whole
// users table, and unlike the live strip nobody needs it every twenty
// seconds. The console fetches it on the slow clock with the panels.

import type { FastifyPluginAsync } from 'fastify';
import { checkDashboardAuth } from '../lib/adminAuth.js';
import { limitExpensive } from '../lib/rateLimit.js';
import { collectAccounts, renderAccountsText } from '../services/accounts.js';

interface AccountsQuery {
  format?: string;
}

const plugin: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: AccountsQuery }>('/admin/accounts', limitExpensive, async (req, reply) => {
    if (!checkDashboardAuth(req.headers.authorization)) {
      reply.code(401);
      return { error: 'unauthorized' };
    }
    const accounts = await collectAccounts();
    if (req.query.format === 'text') {
      reply.type('text/plain; charset=utf-8');
      return renderAccountsText(accounts);
    }
    return accounts;
  });
};

export default plugin;
