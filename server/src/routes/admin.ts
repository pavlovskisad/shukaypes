// Admin sideload for real lost-dog posts. Paste raw text from Telegram/OLX/FB
// etc. → Haiku parses it → dedupe + upsert into lost_dogs. The same framework
// will be driven by automated scrapers later; this endpoint is the first
// consumer and also the manual fallback.
//
// Auth: bearer token against ADMIN_TOKEN env. Auth plugin skips /admin/* so
// no device-id header is required here. If ADMIN_TOKEN is unset, the endpoint
// refuses every request — failing closed is the right default for a
// write-anything-to-the-db endpoint.

import type { FastifyPluginAsync } from 'fastify';
import { parseDogPost } from '../pipeline/parser.js';
import { upsertLostDog } from '../pipeline/upsert.js';

const MAX_TEXT_CHARS = 4000;

function checkAdminAuth(header: string | string[] | undefined): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return false;
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return false;
  const match = raw.match(/^Bearer\s+(.+)$/i);
  const presented = match && match[1] ? match[1].trim() : raw.trim();
  // Constant-time compare to keep timing leaks off the table.
  if (presented.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < presented.length; i++) {
    diff |= presented.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}

const plugin: FastifyPluginAsync = async (app) => {
  app.post<{
    Body: { text?: string; source?: string; photoUrl?: string | null; dryRun?: boolean };
  }>(
    '/admin/lost-dogs/ingest',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (!checkAdminAuth(req.headers.authorization)) {
        reply.code(401);
        return { error: 'unauthorized' };
      }

      const body = req.body ?? {};
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text) {
        reply.code(400);
        return { error: 'text required' };
      }
      if (text.length > MAX_TEXT_CHARS) {
        reply.code(400);
        return { error: `text too long (max ${MAX_TEXT_CHARS} chars)` };
      }
      const source = typeof body.source === 'string' && body.source.trim() ? body.source.trim().slice(0, 80) : 'admin-sideload';
      const photoUrl = typeof body.photoUrl === 'string' ? body.photoUrl.slice(0, 500) : null;
      const dryRun = body.dryRun === true;

      try {
        const parsed = await parseDogPost({ text, photoUrl });
        req.log.info(
          {
            kind: 'ingest_parsed',
            source,
            name: parsed.name,
            urgency: parsed.urgency,
            confidence: parsed.parseConfidence,
            lat: parsed.lastSeenLat,
            lng: parsed.lastSeenLng,
          },
          'lost-dog parsed',
        );

        if (dryRun) {
          return { action: 'dry-run', parsed };
        }

        const result = await upsertLostDog({ parsed, source });
        req.log.info(
          { kind: 'ingest_upsert', id: result.id, action: result.action, source },
          'lost-dog upserted',
        );
        return result;
      } catch (err) {
        req.log.error({ err: (err as Error).message }, 'ingest failed');
        reply.code(502);
        return { error: 'parse or upsert failed', detail: (err as Error).message };
      }
    },
  );
};

export default plugin;
