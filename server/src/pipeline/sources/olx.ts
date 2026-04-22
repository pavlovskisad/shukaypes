// OLX scraper. Polls a small list of Kyiv listing URLs, finds dog-related
// ads, fetches each ad page, passes the body to parseDogPost, upserts via
// upsertLostDog. scrape_log ensures we don't re-Haiku the same ad.
//
// Non-goals for this slice:
//   - no paginated crawl (each listing URL serves the first page only)
//   - no image fetch / hash dedupe (titles + coords + name cover 99% of reposts)
//   - no retry on transient 5xx — hourly cron is its own retry
//
// If OLX ever changes its `data-cy="l-card"` marker we'll see the cron log
// discovered: 0 and know immediately — no silent corruption.

import { load as loadHtml } from 'cheerio';
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { parseDogPost } from '../parser.js';
import { upsertLostDog } from '../upsert.js';
import { emptySummary, type Source, type SourceRunSummary } from '../source.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36';
const SOURCE = 'olx';

// URLs to poll each tick. Start narrow; broaden as we see real volume.
// byuro-nahodok (bureau of found-and-lost) is the obvious category; the
// site-wide search catches posts mis-categorized into generic "dogs".
const LISTING_URLS = [
  'https://www.olx.ua/uk/zhivotnye/byuro-nahodok/kiev/',
  'https://www.olx.ua/uk/list/q-пропав-собака/?search%5Bcity_id%5D=8',
  'https://www.olx.ua/uk/list/q-знайшли-собаку/?search%5Bcity_id%5D=8',
];

// Pre-filter ad titles. We only want posts that describe a dog that went
// missing or a stray that was found — not adoption / rehoming listings.
// OLX's byuro-nahodok category mixes all three, so we have to gate hard.
//
// A title must have BOTH a dog word AND a lost/found word, AND must not
// contain any unambiguous rehoming phrase. The REHOMING check runs first
// and wins even when the title also mentions urgency (e.g. "ТЕРМІНОВО
// шукає дім" is still rehoming — parser few-shot backs this up).
//
// Misses from this filter are caught by Haiku's `urgency: "rehoming"`
// classification after the full body is parsed.
const DOG_KEYWORDS = /(собак|пес|пёс|щен|цуценя|dog|puppy|hound|шпіц|хаск|ретрівер|бульдог|лабрад|пудель|такса|вівчарка|джек-рассел|джек рассел|чихуахуа|корг|шарпей|шиба|боксер|шпіц)/i;
const LOST_KEYWORDS = /(пропа|лост|загуб|зник|знайд|найден|нашли|знайшли|сбеж|втеч|lost|found)/i;
const REHOMING_KEYWORDS = /(шука[єют][^.!?\n]{0,20}дім|шука[єют][^.!?\n]{0,20}домівк|шука[єют][^.!?\n]{0,20}родин|шука[єют][^.!?\n]{0,20}госпо|в\s+добрі\s+руки|в\s+добрые\s+руки|в\s+хорошие\s+руки|віддам|віддаю|віддає|віддаєм|роздам|роздаю|роздає|роздаєм|отдам|отдаю|раздам|раздаю|в\s+дар|пристр[оау]|ищет\s+дом|ищу\s+дом|безкоштовно|бесплатно)/i;

interface Card {
  url: string;
  title: string;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, 'accept-language': 'uk-UA,uk;q=0.9,en;q=0.6' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.text();
}

function parseCards(html: string, baseUrl: string): Card[] {
  const $ = loadHtml(html);
  const out: Card[] = [];
  $('[data-cy="l-card"]').each((_i, el) => {
    const $el = $(el);
    const a = $el.find('a[href]').first();
    const href = a.attr('href');
    if (!href) return;
    // OLX titles: try the heading element first, then fall back to the
    // anchor text. Both have been stable.
    const titleEl = $el.find('h4, h6').first();
    const title = (titleEl.text() || a.text()).trim().replace(/\s+/g, ' ');
    if (!title) return;
    const absUrl = href.startsWith('http') ? href : new URL(href, baseUrl).toString();
    out.push({ url: canonical(absUrl), title });
  });
  return out;
}

function canonical(url: string): string {
  // Strip trackers/query so the same ad posted from different entry points
  // maps to one scrape_log row.
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

function extractAdBody(html: string): { text: string; photoUrl: string | null } {
  const $ = loadHtml(html);
  // OLX ad body is the only multi-line description on the page. data-cy
  // markers here have been stable too, with a couple of fallbacks for
  // layout experiments.
  const body =
    $('[data-cy="ad_description"]').text() ||
    $('[data-testid="ad-description"]').text() ||
    $('div[data-testid="main"]').text() ||
    '';
  const title = $('[data-cy="ad_title"] h4').first().text() || $('h4').first().text();
  const combined = `${title}\n\n${body}`.replace(/\s+\n/g, '\n').trim();

  const photo =
    $('[data-cy="ad-photo"] img').first().attr('src') ||
    $('meta[property="og:image"]').attr('content') ||
    null;

  return { text: combined, photoUrl: photo };
}

export class OlxSource implements Source {
  name = SOURCE;

  async runOnce(): Promise<SourceRunSummary> {
    const summary = emptySummary(SOURCE);

    // 1. Fetch every listing page, collect card candidates.
    const allCards: Card[] = [];
    for (const listUrl of LISTING_URLS) {
      try {
        const html = await fetchText(listUrl);
        const cards = parseCards(html, listUrl);
        allCards.push(...cards);
      } catch (err) {
        summary.errors++;
        console.warn('[olx] listing fetch failed', listUrl, (err as Error).message);
      }
    }

    // Dedupe by URL within this run (same ad can appear on multiple listings).
    const seenThisRun = new Set<string>();
    const deduped = allCards.filter((c) => (seenThisRun.has(c.url) ? false : seenThisRun.add(c.url)));
    summary.discovered = deduped.length;

    if (deduped.length === 0) return summary;

    // 2. Skip already-seen URLs from scrape_log.
    const urls = deduped.map((c) => c.url);
    const alreadySeen = await db
      .select({ url: schema.scrapeLog.url })
      .from(schema.scrapeLog)
      .where(inArray(schema.scrapeLog.url, urls));
    const seenUrls = new Set(alreadySeen.map((r) => r.url));

    // 3. For each new card: title-filter, then fetch body, parse, upsert.
    for (const card of deduped) {
      if (seenUrls.has(card.url)) {
        summary.skipped++;
        continue;
      }

      const looksLikeRehoming = REHOMING_KEYWORDS.test(card.title);
      const looksLikeLostDog =
        DOG_KEYWORDS.test(card.title) && LOST_KEYWORDS.test(card.title);
      if (looksLikeRehoming || !looksLikeLostDog) {
        await db
          .insert(schema.scrapeLog)
          .values({
            url: card.url,
            source: SOURCE,
            title: card.title,
            ingestAction: 'skipped',
            skipReason: looksLikeRehoming ? 'rehoming' : 'title-filter',
          })
          .onConflictDoNothing({ target: schema.scrapeLog.url });
        summary.skipped++;
        continue;
      }

      try {
        const adHtml = await fetchText(card.url);
        const { text, photoUrl } = extractAdBody(adHtml);
        if (text.length < 40) {
          await db
            .insert(schema.scrapeLog)
            .values({
              url: card.url,
              source: SOURCE,
              title: card.title,
              ingestAction: 'skipped',
              skipReason: 'empty-body',
            })
            .onConflictDoNothing({ target: schema.scrapeLog.url });
          summary.skipped++;
          continue;
        }

        const parsed = await parseDogPost({ text, photoUrl });
        summary.parsed++;

        if (parsed.urgency === 'rehoming') {
          await db
            .insert(schema.scrapeLog)
            .values({
              url: card.url,
              source: SOURCE,
              title: card.title,
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
              url: card.url,
              source: SOURCE,
              title: card.title,
              parseConfidence: parsed.parseConfidence,
              ingestAction: 'skipped',
              skipReason: 'low-confidence',
            })
            .onConflictDoNothing({ target: schema.scrapeLog.url });
          summary.skipped++;
          continue;
        }

        const result = await upsertLostDog({ parsed, source: SOURCE });
        if (result.action === 'inserted') summary.inserted++;
        else if (result.action === 'updated') summary.updated++;
        else if (result.action === 'duplicate') summary.duplicate++;

        await db
          .insert(schema.scrapeLog)
          .values({
            url: card.url,
            source: SOURCE,
            title: card.title,
            dogId: result.id,
            parseConfidence: parsed.parseConfidence,
            ingestAction: result.action,
          })
          .onConflictDoNothing({ target: schema.scrapeLog.url });
      } catch (err) {
        summary.errors++;
        console.warn('[olx] ad parse failed', card.url, (err as Error).message);
        // Log the failure so we don't retry on every tick. First failure gets
        // a row with skipReason=error; next tick will see it in seenUrls.
        await db
          .insert(schema.scrapeLog)
          .values({
            url: card.url,
            source: SOURCE,
            title: card.title,
            ingestAction: 'skipped',
            skipReason: `error: ${(err as Error).message.slice(0, 200)}`,
          })
          .onConflictDoNothing({ target: schema.scrapeLog.url });
      }
    }

    return summary;
  }
}

// Convenience helper for scripts/tests: forget the last-seen log for a url
// so the next run re-processes it. Not wired to any endpoint on purpose.
export async function forgetUrl(url: string): Promise<void> {
  await db.delete(schema.scrapeLog).where(eq(schema.scrapeLog.url, canonical(url)));
}
