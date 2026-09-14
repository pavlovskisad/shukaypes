// The happiness index board (D-75): who lives the happiest life, plus
// where the caller stands. Read from the profile tab, its own trip —
// like the territory board, not something the 15s sync should carry.

import type { FastifyPluginAsync } from 'fastify';
import { limitRead } from '../lib/rateLimit.js';
import { happinessLeaderboard, happinessStanding } from '../services/happiness.js';

const happinessRoute: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { limit?: string } }>('/happiness/leaderboard', limitRead, async (req) => {
    const limit = Math.min(Math.max(parseInt(req.query?.limit ?? '0', 10) || 0, 0), 100);
    const board = await happinessLeaderboard(limit || undefined).catch(() => []);
    const you = await happinessStanding(req.userId, board).catch(() => ({
      index: null,
      activeS: 0,
      rank: null,
    }));
    return { board, you };
  });
};

export default happinessRoute;
