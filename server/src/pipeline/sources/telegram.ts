// Telegram public-channel scraper. We hit the anonymous web preview at
// https://t.me/s/<channel> which renders the last ~20 messages as HTML
// — no auth, no Bot API, no MTProto client. Each message has a stable
// permalink like https://t.me/<channel>/<id> that we use as the
// scrape_log key.
//
// Non-goals for this slice:
//   - no pagination beyond the first page (t.me/s returns ~20 msgs;
//     hourly cron catches new posts within an hour)
//   - no media download; we just pull the first background-image URL
//     off .tgme_widget_message_photo_wrap, parser handles null
//   - no chat/reply threads — we treat each standalone message as
//     independent (replies look the same structurally anyway)
//
// Channel list is env-driven: TELEGRAM_CHANNELS=kyiv_lost_pets,ch2,ch3
// (no @, no t.me/ prefix). Empty or unset = source is a no-op. Picking
// the right channels is a curation task — we can keep the code stable
// while the list evolves.

import { load as loadHtml } from 'cheerio';
import { inArray } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { parseDogPost } from '../parser.js';
import { upsertLostDog } from '../upsert.js';
import { emptySummary, type Source, type SourceRunSummary } from '../source.js';
import { looksLikeLostPet, looksLikeRehoming } from '../keywords.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36';

// Minimum characters for a message to even attempt parse. Telegram is
// lots of 1-line "Знайшли!!" posts with no location; those can't be
// geocoded and waste a Haiku call. 60 chars ≈ 10-12 words, about the
// shortest post with any chance of signal.
const MIN_MSG_CHARS = 60;

interface TgMessage {
  url: string; // https://t.me/channel/123 (canonical permalink)
  text: string;
  photoUrl: string | null;
  channel: string;
}

function channelList(): string[] {
  const raw = process.env.TELEGRAM_CHANNELS ?? '';
  return raw
    .split(',')
    .map((s) => s.trim().replace(/^@/, '').replace(/^https?:\/\/t\.me\//, ''))
    .filter(Boolean);
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'user-agent': UA,
      'accept-language': 'uk-UA,uk;q=0.9,ru;q=0.8,en;q=0.6',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.text();
}

function parseChannelPage(html: string, channel: string): TgMessage[] {
  const $ = loadHtml(html);
  const out: TgMessage[] = [];
  $('.tgme_widget_message').each((_i, el) => {
    const $el = $(el);
    const dataPost = $el.attr('data-post'); // "<channel>/<id>"
    if (!dataPost) return;
    // Canonical URL uses whatever data-post says — avoids case drift
    // between input handle and Telegram's own rendering.
    const url = `https://t.me/${dataPost}`;
    // Message body lives in .tgme_widget_message_text. Multiple <br>
    // → newlines; stripped markup → text.
    const $text = $el.find('.tgme_widget_message_text').first();
    // .text() joins everything inline; we recover line breaks by
    // replacing <br>s ourselves before extracting.
    $text.find('br').replaceWith('\n');
    const text = $text.text().trim();
    if (!text) return;
    // Photo: the first photo wrap carries a CSS background-image URL.
    // Stickers / video previews get different classes we ignore.
    const photoStyle =
      $el.find('.tgme_widget_message_photo_wrap').first().attr('style') ?? '';
    const match = photoStyle.match(/background-image:\s*url\(['"]?([^'")]+)/i);
    const photoUrl = match?.[1] ?? null;
    out.push({ url, text, photoUrl, channel });
  });
  return out;
}

// First line of the message, capped at 100 chars — we feed this to the
// lost/rehoming filter the same way OLX feeds a card title. Most
// lost-pet Telegram posts put "Знайдено собаку в Подолі" or similar
// upfront, so the first line carries the same classification signal.
function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? text;
  return line.trim().slice(0, 120);
}

export class TelegramSource implements Source {
  name = 'telegram';

  async runOnce(): Promise<SourceRunSummary> {
    const summary = emptySummary('telegram');
    const channels = channelList();
    if (channels.length === 0) return summary;

    // 1. Fetch every channel page in sequence. Telegram doesn't seem to
    // throttle these previews hard, but sequential keeps us under any
    // per-IP rate limit we haven't noticed yet.
    const allMessages: TgMessage[] = [];
    for (const ch of channels) {
      try {
        const html = await fetchText(`https://t.me/s/${ch}`);
        const msgs = parseChannelPage(html, ch);
        allMessages.push(...msgs);
      } catch (err) {
        summary.errors++;
        console.warn(
          '[telegram] channel fetch failed',
          ch,
          (err as Error).message,
        );
      }
    }

    // De-dupe by URL within this run — a message can show up under two
    // handles if a channel was renamed mid-fetch.
    const seenThisRun = new Set<string>();
    const deduped = allMessages.filter((m) =>
      seenThisRun.has(m.url) ? false : seenThisRun.add(m.url),
    );
    summary.discovered = deduped.length;
    if (deduped.length === 0) return summary;

    // 2. Drop any already-logged URLs.
    const urls = deduped.map((m) => m.url);
    const seen = await db
      .select({ url: schema.scrapeLog.url })
      .from(schema.scrapeLog)
      .where(inArray(schema.scrapeLog.url, urls));
    const seenUrls = new Set(seen.map((r) => r.url));

    for (const msg of deduped) {
      if (seenUrls.has(msg.url)) {
        summary.skipped++;
        continue;
      }

      const tag = `telegram:${msg.channel}`;
      const title = firstLine(msg.text);

      if (msg.text.length < MIN_MSG_CHARS) {
        await db
          .insert(schema.scrapeLog)
          .values({
            url: msg.url,
            source: tag,
            title,
            ingestAction: 'skipped',
            skipReason: 'too-short',
          })
          .onConflictDoNothing({ target: schema.scrapeLog.url });
        summary.skipped++;
        continue;
      }

      const rehoming = looksLikeRehoming(title);
      const lost = looksLikeLostPet(title);
      if (rehoming || !lost) {
        await db
          .insert(schema.scrapeLog)
          .values({
            url: msg.url,
            source: tag,
            title,
            ingestAction: 'skipped',
            skipReason: rehoming ? 'rehoming' : 'title-filter',
          })
          .onConflictDoNothing({ target: schema.scrapeLog.url });
        summary.skipped++;
        continue;
      }

      try {
        const parsed = await parseDogPost({
          text: msg.text,
          photoUrl: msg.photoUrl,
        });
        summary.parsed++;

        if (parsed.urgency === 'rehoming') {
          await db
            .insert(schema.scrapeLog)
            .values({
              url: msg.url,
              source: tag,
              title,
              parseConfidence: parsed.parseConfidence,
              ingestAction: 'skipped',
              skipReason: 'rehoming',
            })
            .onConflictDoNothing({ target: schema.scrapeLog.url });
          summary.skipped++;
          continue;
        }

        if (parsed.parseConfidence < 0.25) {
          await db
            .insert(schema.scrapeLog)
            .values({
              url: msg.url,
              source: tag,
              title,
              parseConfidence: parsed.parseConfidence,
              ingestAction: 'skipped',
              skipReason: 'low-confidence',
            })
            .onConflictDoNothing({ target: schema.scrapeLog.url });
          summary.skipped++;
          continue;
        }

        const result = await upsertLostDog({ parsed, source: tag });
        if (result.action === 'inserted') summary.inserted++;
        else if (result.action === 'updated') summary.updated++;
        else if (result.action === 'duplicate') summary.duplicate++;
        else if (result.action === 'skipped') summary.skipped++;

        await db
          .insert(schema.scrapeLog)
          .values({
            url: msg.url,
            source: tag,
            title,
            dogId: result.id,
            parseConfidence: parsed.parseConfidence,
            ingestAction: result.action,
            skipReason: result.skipReason,
          })
          .onConflictDoNothing({ target: schema.scrapeLog.url });
      } catch (err) {
        summary.errors++;
        console.warn(
          '[telegram] msg parse failed',
          msg.url,
          (err as Error).message,
        );
        await db
          .insert(schema.scrapeLog)
          .values({
            url: msg.url,
            source: tag,
            title,
            ingestAction: 'skipped',
            skipReason: `error: ${(err as Error).message.slice(0, 200)}`,
          })
          .onConflictDoNothing({ target: schema.scrapeLog.url });
      }
    }

    return summary;
  }
}
