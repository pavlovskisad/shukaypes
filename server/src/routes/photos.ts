// Photo proxy for Telegram-ingested lost-pet images.
//
// Why this exists: TG's getFile API returns a `file_path` that can be
// fetched at https://api.telegram.org/file/bot<TOKEN>/<file_path>, but
// the link is only guaranteed valid for ~1 hour. The previous version
// of the bot ingest stored that URL directly in lost_dogs.photo_url,
// so every photo went 404 once the link expired.
//
// Fix: store the stable `file_id` on the row, and serve photos via
// this endpoint. We re-resolve the file_path on demand (cached for
// ~45 min, safely under TG's 1h TTL), then stream the bytes back to
// the client. The bot token never leaves the server.

import type { FastifyPluginAsync } from 'fastify';
import { Readable } from 'node:stream';

const TG_API = 'https://api.telegram.org';
const PATH_TTL_MS = 45 * 60 * 1000;

interface CachedPath {
  filePath: string;
  expiresAt: number;
}
const pathCache = new Map<string, CachedPath>();

async function resolveFilePath(
  fileId: string,
  token: string,
): Promise<string | null> {
  const cached = pathCache.get(fileId);
  if (cached && cached.expiresAt > Date.now()) return cached.filePath;
  try {
    const res = await fetch(
      `${TG_API}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
    );
    const json = (await res.json()) as {
      ok: boolean;
      result?: { file_path?: string };
    };
    if (!json.ok || !json.result?.file_path) return null;
    pathCache.set(fileId, {
      filePath: json.result.file_path,
      expiresAt: Date.now() + PATH_TTL_MS,
    });
    return json.result.file_path;
  } catch {
    return null;
  }
}

const plugin: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { fileId: string } }>(
    '/photos/:fileId',
    async (req, reply) => {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (!token) {
        reply.code(503);
        return { error: 'photo proxy not configured' };
      }
      const filePath = await resolveFilePath(req.params.fileId, token);
      if (!filePath) {
        reply.code(404);
        return { error: 'photo not found' };
      }
      let upstream: Response;
      try {
        upstream = await fetch(`${TG_API}/file/bot${token}/${filePath}`);
      } catch (err) {
        app.log.warn(
          { kind: 'photo_proxy', fileId: req.params.fileId, err: (err as Error).message },
          '[photos] upstream fetch threw',
        );
        reply.code(502);
        return { error: 'upstream fetch failed' };
      }
      if (!upstream.ok || !upstream.body) {
        // 404 from TG can mean the file_path went stale between our
        // getFile call and the bytes fetch — drop the cached path so
        // the next request re-resolves.
        if (upstream.status === 404) pathCache.delete(req.params.fileId);
        reply.code(upstream.status === 404 ? 404 : 502);
        return { error: 'upstream fetch failed' };
      }
      reply
        .header(
          'content-type',
          upstream.headers.get('content-type') ?? 'image/jpeg',
        )
        // file_id → bytes is content-addressed (file_id changes if the
        // file does), so the browser can cache aggressively. A day is
        // plenty for the markers/cards path.
        .header('cache-control', 'public, max-age=86400, immutable');
      // Cast: Node's Readable.fromWeb signature is parameterised on
      // `ReadableStream<any>`, but the global fetch returns
      // `ReadableStream<Uint8Array>` — the variance mismatch is purely
      // a type-system artefact, the runtime conversion is supported.
      return reply.send(Readable.fromWeb(upstream.body as never));
    },
  );
};

export default plugin;
