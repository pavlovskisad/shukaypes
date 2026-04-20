import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { db, schema } from './db/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
    deviceId: string;
  }
}

const DEVICE_ID_HEADER = 'x-device-id';

async function resolveUser(deviceId: string): Promise<string> {
  const [existing] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.deviceId, deviceId))
    .limit(1);
  if (existing) return existing.id;

  const id = nanoid();
  const username = `walker-${deviceId.slice(0, 6)}`;
  await db.insert(schema.users).values({ id, deviceId, username });
  await db.insert(schema.companionState).values({ userId: id });
  return id;
}

const plugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest('userId', '');
  app.decorateRequest('deviceId', '');

  app.addHook('preHandler', async (req: FastifyRequest, reply) => {
    if (req.routeOptions?.url === '/health') return;
    const header = req.headers[DEVICE_ID_HEADER];
    const deviceId = Array.isArray(header) ? header[0] : header;
    if (!deviceId || deviceId.length < 8 || deviceId.length > 128) {
      reply.code(401);
      throw new Error('missing or invalid x-device-id header');
    }
    req.deviceId = deviceId;
    req.userId = await resolveUser(deviceId);
  });
};

export default fp(plugin, { name: 'auth' });
