// GET /players/:id — the card that opens when a dog on the map is
// tapped (D-73): who it is, the portrait, the level, the ground it
// holds. GET /bot-avatars/:n.png — the portraits drawn for the bot
// roster (services/botAvatars.ts), shipped in the image.
//
// The card is fetched on tap, not carried on every presence entry: the
// map polls presence every few seconds for two dozen dogs, and a level
// and a polygon per dog on every poll is weight nobody looks at until
// they tap.

import fs from 'node:fs';
import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { limitPolling, limitMedia } from '../lib/rateLimit.js';
import { xpProgress } from '../lib/xp.js';
import { buildPhotoUrl } from '../services/photoUrl.js';
import { territoryCard } from '../services/territory.js';
import { botAvatarFile, botAvatarUrl, botEntry, botIndex, botLevel } from '../services/botAvatars.js';

// Local shape (matches @shukajpes/shared PlayerCard); the server does
// not import the shared package, same as presence.ts.
interface PlayerCard {
  id: string;
  name: string;
  bot: boolean;
  avatarUrl: string | null;
  level: number | null;
  areaM2: number;
  piece: { lat: number; lng: number }[] | null;
}

const MULTIPLAYER_ON = process.env.MULTIPLAYER !== 'off';

const plugin: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>('/players/:id', limitPolling, async (req, reply) => {
    if (!MULTIPLAYER_ON) {
      reply.code(404);
      return { error: 'not_found' };
    }
    const id = req.params.id;
    if (!id || id.length > 128) {
      reply.code(400);
      return { error: 'invalid id' };
    }
    const ground = await territoryCard(id).catch(() => ({ areaM2: 0, piece: null }));

    const bi = botIndex(id);
    if (bi !== null) {
      const card: PlayerCard = {
        id,
        name: botEntry(bi).name,
        bot: true,
        avatarUrl: botAvatarUrl(bi),
        level: botLevel(bi),
        areaM2: ground.areaM2,
        piece: ground.piece,
      };
      return card;
    }

    const [row] = await db
      .select({
        first: schema.users.telegramFirstName,
        username: schema.users.username,
        avatarFileId: schema.users.avatarFileId,
        xp: schema.companionState.xp,
      })
      .from(schema.users)
      .leftJoin(schema.companionState, eq(schema.companionState.userId, schema.users.id))
      .where(eq(schema.users.id, id))
      .limit(1);
    if (!row) {
      reply.code(404);
      return { error: 'not_found' };
    }
    const card: PlayerCard = {
      id,
      name: row.first || row.username || 'walker',
      bot: false,
      avatarUrl: buildPhotoUrl(row.avatarFileId, null),
      level: row.xp === null || row.xp === undefined ? null : xpProgress(row.xp).level,
      areaM2: ground.areaM2,
      piece: ground.piece,
    };
    return card;
  });

  app.get<{ Params: { n: string } }>('/bot-avatars/:n.png', limitMedia, async (req, reply) => {
    const n = Number(req.params.n);
    if (!Number.isInteger(n) || n < 0 || n > 999) {
      reply.code(404);
      return { error: 'not_found' };
    }
    let bytes: Buffer;
    try {
      bytes = await fs.promises.readFile(botAvatarFile(n));
    } catch {
      reply.code(404);
      return { error: 'not_found' };
    }
    reply.header('content-type', 'image/png');
    reply.header('cache-control', 'public, max-age=86400');
    return reply.send(bytes);
  });
};

export default plugin;
