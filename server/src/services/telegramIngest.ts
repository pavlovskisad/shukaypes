// Bot-side lost-pet ingest. When the Telegram webhook receives a group
// message that looks like a lost-pet post, we run the same parser +
// upsert path the scrape pipeline uses so the post lands on our map
// immediately (instead of waiting for the next periodic crawl, which
// only covers a curated channel list anyway).
//
// Flow:
//   1. Skip if we've already ingested this exact message (scrape_log
//      dedupe on the TG permalink URL).
//   2. Pull the largest photo's file_id off the message and stash it
//      on ParsedDog. The download URL itself is NOT resolved here —
//      TG's file_path URLs expire in ~1h, so we keep the stable file_id
//      on the row and serve photos through /photos/:fileId, which
//      re-resolves the file_path on demand.
//   3. Parse with Haiku; refuse confidence < BOT_CONFIDENCE_FLOOR so
//      we don't dump junk into the DB on every false positive.
//   4. Upsert via the shared dedupe path so a post reposted across
//      groups doesn't multiply.
//   5. Record everything in scrape_log for audit + cleanup.
//
// The route layer takes our return value and crafts the reply text
// (added/already-on-map/generic-fallback).

import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { db, schema } from '../db/index.js';
import { parseDogPost } from '../pipeline/parser.js';
import { upsertLostDog } from '../pipeline/upsert.js';
import type { IngestResult, ParsedDog } from '../pipeline/types.js';

// Below this we skip the upsert and reply with the generic fallback.
// Parser hands back ~0.85+ on clear posts, ~0.4 on resolution notices,
// ~0.0 on genuine noise. 0.5 keeps clear lost-pet posts in and rejects
// 'found my keys' style false positives.
const BOT_CONFIDENCE_FLOOR = 0.5;

// Largest TG photo size (last element of the photo array) — best
// quality for the LLM and for the dog's identity tile on the map.
interface TgPhotoSize {
  file_id: string;
  width: number;
  height: number;
}

interface TgMessageLike {
  message_id: number;
  chat: { id: number; title?: string };
  text?: string;
  caption?: string;
  photo?: TgPhotoSize[];
}

export type IngestOutcome =
  | { kind: 'inserted'; dogId: string; parsed: ParsedDog }
  | { kind: 'updated'; dogId: string; parsed: ParsedDog }
  | { kind: 'duplicate'; dogId: string; parsed: ParsedDog }
  | { kind: 'skipped'; reason: string; parsed?: ParsedDog }
  | { kind: 'already-ingested'; dogId: string | null }
  | { kind: 'error'; err: string };

// Build a stable, unique URL we can store in scrape_log. For private
// supergroups (chat_id starts with -100) TG's permalink format is
// t.me/c/<abs(chat_id) - 1_000_000_000_000>/<msg_id>. Public groups
// would use the @username; we don't have it on the webhook payload,
// so fall back to a sentinel URL form for those. Either way the
// string is unique per message and the primary-key collision is what
// keeps us idempotent.
function messageUrl(chatId: number, messageId: number): string {
  if (chatId < -1_000_000_000_000) {
    const internal = Math.abs(chatId) - 1_000_000_000_000;
    return `https://t.me/c/${internal}/${messageId}`;
  }
  return `tg://webhook/chat/${chatId}/msg/${messageId}`;
}

function largestPhotoFileId(photos: TgPhotoSize[] | undefined): string | null {
  const largest = photos?.[photos.length - 1];
  return largest?.file_id ?? null;
}

export async function ingestFromTelegramPost(
  msg: TgMessageLike,
  log: FastifyBaseLogger,
): Promise<IngestOutcome> {
  const url = messageUrl(msg.chat.id, msg.message_id);
  const source = `telegram:webhook:${msg.chat.id}`;
  const text = `${msg.text ?? ''} ${msg.caption ?? ''}`.trim();
  const title = text.slice(0, 200);

  const existing = await db
    .select({ dogId: schema.scrapeLog.dogId })
    .from(schema.scrapeLog)
    .where(eq(schema.scrapeLog.url, url))
    .limit(1);
  const prior = existing[0];
  if (prior) {
    return { kind: 'already-ingested', dogId: prior.dogId ?? null };
  }

  const photoFileId = largestPhotoFileId(msg.photo);

  let parsed: ParsedDog;
  try {
    parsed = await parseDogPost({ text, photoFileId });
  } catch (err) {
    log.warn(
      { kind: 'telegram_ingest', url, err: (err as Error).message },
      '[telegram] parse failed',
    );
    await db
      .insert(schema.scrapeLog)
      .values({
        url,
        source,
        title,
        ingestAction: 'skipped',
        skipReason: `parse-error: ${(err as Error).message.slice(0, 120)}`,
      })
      .onConflictDoNothing();
    return { kind: 'error', err: (err as Error).message };
  }

  // Rehoming posts (offering a pet for adoption) and resolution
  // notices ("found him!") parse cleanly but aren't lost-pet entries
  // — keep them out of the active map. We still log them so audits
  // can tell whether we're rejecting the right things.
  if (parsed.urgency === 'rehoming') {
    await db
      .insert(schema.scrapeLog)
      .values({
        url,
        source,
        title,
        parseConfidence: parsed.parseConfidence,
        ingestAction: 'skipped',
        skipReason: 'rehoming',
      })
      .onConflictDoNothing();
    return { kind: 'skipped', reason: 'rehoming', parsed };
  }

  if (parsed.parseConfidence < BOT_CONFIDENCE_FLOOR) {
    await db
      .insert(schema.scrapeLog)
      .values({
        url,
        source,
        title,
        parseConfidence: parsed.parseConfidence,
        ingestAction: 'skipped',
        skipReason: `low-confidence:${parsed.parseConfidence.toFixed(2)}`,
      })
      .onConflictDoNothing();
    return { kind: 'skipped', reason: 'low-confidence', parsed };
  }

  const result: IngestResult = await upsertLostDog({ parsed, source });

  await db
    .insert(schema.scrapeLog)
    .values({
      url,
      source,
      title,
      dogId: result.id,
      parseConfidence: parsed.parseConfidence,
      ingestAction: result.action,
      skipReason: result.skipReason ?? null,
    })
    .onConflictDoNothing();

  if (!result.id) return { kind: 'skipped', reason: result.skipReason ?? 'upsert-skipped', parsed };
  if (result.action === 'inserted') return { kind: 'inserted', dogId: result.id, parsed };
  if (result.action === 'updated') return { kind: 'updated', dogId: result.id, parsed };
  return { kind: 'duplicate', dogId: result.id, parsed };
}
