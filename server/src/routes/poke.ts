// POST /poke — nudge another nearby player. The poke is queued in Redis for
// the target and delivered on their next /sync/map poll (see takePokes).
// Multiplayer-gated: no-op unless the client is a multiplayer build.

import type { FastifyPluginAsync } from 'fastify';
import { sendPoke, selfMeta } from '../services/presence.js';

const MULTIPLAYER_ON = process.env.MULTIPLAYER !== 'off';

interface PokeBody {
  targetId?: string;
}

const plugin: FastifyPluginAsync = async (app) => {
  app.post<{ Body: PokeBody }>('/poke', async (req, reply) => {
    if (!MULTIPLAYER_ON) return { ok: false };
    const targetId = req.body?.targetId;
    if (!targetId || typeof targetId !== 'string' || targetId.length > 128) {
      reply.code(400);
      return { error: 'invalid targetId' };
    }
    // No self-pokes, and don't let a poke target a bot (they can't feel it).
    if (targetId === req.userId || targetId.startsWith('bot:')) {
      return { ok: true };
    }
    const meta = await selfMeta(req.userId);
    await sendPoke(req.userId, meta.name, targetId).catch(() => {});
    return { ok: true };
  });
};

export default plugin;
