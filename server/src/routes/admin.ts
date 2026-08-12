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
import { desc } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { parseDogPost } from '../pipeline/parser.js';
import { upsertLostDog } from '../pipeline/upsert.js';
import { runAllSources } from '../services/scrape.js';
import {
  buildLostDogsReport,
  formatLostDogsReport,
  loadAuditRows,
} from '../services/lostDogsReport.js';
// Token checks live in lib/adminAuth so /stats and the admin console ask
// the same question the same way. See that file for the two-key model.
import { checkAdminAuth, checkReportAuth } from '../lib/adminAuth.js';
import { limitRead } from '../lib/rateLimit.js';

const MAX_TEXT_CHARS = 4000;

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

  // Force-run every scrape source immediately. Useful for verifying an OLX
  // change landed, or for pulling a fresh batch on demand. Rate-limited more
  // aggressively because each call can burn multiple Haiku parses.
  app.post(
    '/admin/lost-dogs/scrape-now',
    { config: { rateLimit: { max: 4, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (!checkAdminAuth(req.headers.authorization)) {
        reply.code(401);
        return { error: 'unauthorized' };
      }
      try {
        const results = await runAllSources(req.log);
        return { ok: true, results };
      } catch (err) {
        req.log.error({ err: (err as Error).message }, 'scrape-now failed');
        reply.code(502);
        return { error: 'scrape failed', detail: (err as Error).message };
      }
    },
  );

  // Peek at recent scrape_log entries for debugging — what the scraper saw,
  // what it decided, why. Read-only.
  app.get<{ Querystring: { source?: string; limit?: string } }>(
    '/admin/lost-dogs/scrape-log',
    limitRead,
    async (req, reply) => {
      if (!checkAdminAuth(req.headers.authorization)) {
        reply.code(401);
        return { error: 'unauthorized' };
      }
      const limit = Math.min(Math.max(parseInt(req.query?.limit ?? '50', 10) || 50, 1), 200);
      const rows = await db
        .select({
          url: schema.scrapeLog.url,
          source: schema.scrapeLog.source,
          title: schema.scrapeLog.title,
          dogId: schema.scrapeLog.dogId,
          confidence: schema.scrapeLog.parseConfidence,
          action: schema.scrapeLog.ingestAction,
          skipReason: schema.scrapeLog.skipReason,
          firstSeenAt: schema.scrapeLog.firstSeenAt,
        })
        .from(schema.scrapeLog)
        .orderBy(desc(schema.scrapeLog.firstSeenAt))
        .limit(limit);
      return { count: rows.length, rows };
    },
  );

  // THE LOST-PET AUDIT, WITHOUT AN SSH SESSION.
  //
  // Everything here was previously only reachable by SSHing into the
  // production machine and running the sweep CLI — which meant it was
  // only reachable from a laptop, which meant in practice it was
  // reachable rarely. The numbers that matter (how many pets the map can
  // actually draw, when each source last produced one, what the
  // invisible ones are made of) are pure row-counting, so there is no
  // reason for them to live behind a shell.
  //
  // Read-only by construction: it calls the counting half of the audit,
  // which contains no writes. The network half — checking photos and ad
  // pages — stays in the CLI, because it takes minutes and hundreds of
  // outbound requests, which is not a thing to do inside a request.
  //
  // `?format=text` returns the same rendering the CLI prints, for when a
  // human is reading it rather than a program.
  app.get<{ Querystring: { format?: string } }>(
    '/admin/lost-dogs/report',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (!checkReportAuth(req.headers.authorization)) {
        reply.code(401);
        return { error: 'unauthorized' };
      }
      const rows = await loadAuditRows();
      const report = await buildLostDogsReport(rows, Date.now());
      if (req.query?.format === 'text') {
        reply.type('text/plain; charset=utf-8');
        return formatLostDogsReport(report);
      }
      return report;
    },
  );
};

export default plugin;
