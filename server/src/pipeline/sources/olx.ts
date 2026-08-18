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
import { extractAdBody } from './adHtml.js';
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { parseDogPost } from '../parser.js';
import { capBody } from '../adBody.js';
import { upsertLostDog } from '../upsert.js';
import { emptySummary, recordError, type Source, type SourceRunSummary } from '../source.js';
import { scrapeFetch } from '../../lib/scrapeFetch.js';
import {
  looksLikeFoundReport,
  looksLikeLostPet,
  looksLikeRehoming,
} from '../keywords.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36';
const SOURCE = 'olx';

// URLs to poll each tick. Mix: the dedicated lost-and-found category,
// site-wide searches in both Ukrainian and Russian for posts that get
// mis-categorized into generic "dogs"/"cats", and the wider "тварини
// загубилися" (animals went missing) bucket. Дupes get filtered by the
// `source_external_id` upsert so the same listing surfaced via two
// queries doesn't insert twice. city_id=8 = Kyiv.
const LISTING_URLS = [
  // bureau of lost-and-found (mixed species)
  'https://www.olx.ua/uk/zhivotnye/byuro-nahodok/kiev/',
  // ukrainian — dogs lost / found
  'https://www.olx.ua/uk/list/q-пропав-собака/?search%5Bcity_id%5D=8',
  'https://www.olx.ua/uk/list/q-знайшли-собаку/?search%5Bcity_id%5D=8',
  'https://www.olx.ua/uk/list/q-загубився-пес/?search%5Bcity_id%5D=8',
  // ukrainian — cats lost / found
  'https://www.olx.ua/uk/list/q-пропав-кіт/?search%5Bcity_id%5D=8',
  'https://www.olx.ua/uk/list/q-знайшли-кота/?search%5Bcity_id%5D=8',
  'https://www.olx.ua/uk/list/q-загубилася-кішка/?search%5Bcity_id%5D=8',
  // russian — many Kyiv posters still write russian
  'https://www.olx.ua/uk/list/q-потерялась-собака/?search%5Bcity_id%5D=8',
  'https://www.olx.ua/uk/list/q-нашли-собаку/?search%5Bcity_id%5D=8',
  'https://www.olx.ua/uk/list/q-потерялся-кот/?search%5Bcity_id%5D=8',
  'https://www.olx.ua/uk/list/q-нашли-кошку/?search%5Bcity_id%5D=8',
  // generic "lost / found" lands posts that didn't pick a species term
  'https://www.olx.ua/uk/list/q-загубився/?search%5Bcity_id%5D=8',
  'https://www.olx.ua/uk/list/q-загубилася/?search%5Bcity_id%5D=8',
];

// SORT BY NEWEST, OR THE POLLER READS THE SAME PAGE FOREVER.
//
// This is the fix for a pipeline that had quietly stopped producing
// anything. Measured on production, 18 Aug — a full tick, no errors:
//
//     [olx] discovered 506, skipped 506, parsed 0, inserted 0
//
// Every discovered URL was already in scrape_log, so every one stopped at
// the seenUrls gate. Nothing reached the ad fetch, nothing was parsed,
// no pet and no ad body had been written for days. It looked healthy in
// every log line: no errors, coverage up from 251 to 508 after the retry
// fix. Discovery had doubled and yield stayed at zero.
//
// The cause is at the top of this file, in its own non-goals: each
// listing URL serves the FIRST PAGE ONLY. OLX orders that page by
// relevance and promotion by default, not by date, so page one is a
// nearly-fixed set. A new ad joins the middle of the relevance order and
// this scraper never sees it. Polling hourly changes nothing when the
// page does not change.
//
// `search[order]=created_at:desc` puts the newest first, which is what an
// hourly poller needs: anything posted since the last tick is at the top.
// An unknown query parameter is ignored by OLX, so if this key is ever
// wrong the behaviour is exactly what it is today — the tick log says
// which, because `skipped` drops below `discovered` the moment genuinely
// new URLs arrive.
const NEWEST_FIRST = { 'search[order]': 'created_at:desc' };

function sortedByNewest(listUrl: string): string {
  const u = new URL(listUrl);
  for (const [k, v] of Object.entries(NEWEST_FIRST)) u.searchParams.set(k, v);
  return u.toString();
}

// Title-level filter + rehoming guard live in pipeline/keywords so
// every source (Telegram next) runs the same rules. Rehoming wins over
// lost even when urgency words are present — e.g. "ТЕРМІНОВО шукає дім"
// is rehoming, not lost. Misses here get caught by the parser's own
// urgency:'rehoming' classification after the full body goes through.

interface Card {
  url: string;
  title: string;
}

async function fetchText(url: string): Promise<string> {
  // Goes through SCRAPE_PROXY_URL when one is set, direct otherwise. The
  // 403s that stopped ingestion are CloudFront refusing the datacentre
  // address, so this is the one knob that can actually change the answer
  // — no header tweak reaches it.
  const res = await scrapeFetch(url, {
    headers: { 'user-agent': UA, 'accept-language': 'uk-UA,uk;q=0.9,en;q=0.6' },
    retryOnBlock: true,
  });
  if (!res.ok) {
    // Carry the attempt count into the error: "-> 403 after 3 attempts"
    // says the proxy rotated and every exit was refused, which is a
    // different problem from a single direct refusal.
    const tries = res.attempts > 1 ? ` after ${res.attempts} attempts` : '';
    throw new Error(`${url} -> ${res.status || 'network'}${tries}`);
  }
  return res.body;
}

// IS THIS AD EVEN IN KYIV?
//
// The listing queries are all city_id=8, and that is not the guarantee it
// looks like: OLX honours the filter loosely on the q- searches, so ads
// from other oblasts come back. One of them was a Kharkiv dog — "район
// центрального ринку" — and nothing downstream could catch it.
//
// Nothing downstream CAN catch it, which is the real point. The parser is
// Kyiv-only by construction: its geo hints are Kyiv landmarks and the
// gazetteer it matches against holds Kyiv streets. Hand it a Kharkiv
// address and it does its job — it finds the closest Kyiv-shaped meaning
// and returns a Kyiv coordinate. The upsert bbox then passes it, because
// by that point the pet genuinely does have Kyiv coordinates. A pet
// hundreds of kilometres away lands on the map with a plausible pin and
// no way to tell it apart from a real one.
//
// So the question has to be asked here, while we still have the ad's own
// page, which states its city in plain text.
//
// Deliberately conservative: reject ONLY when another oblast capital is
// named and Kyiv is not. An ad that mentions neither is let through to
// the parser as before — better to keep an ambiguous local pet than to
// drop a real one over a missing word.
const KYIV_WORDS = /Київ|Києв|Киев|Kyiv|Kiev/i;
const OTHER_CITIES =
  /Харків|Харьков|Kharkiv|Львів|Львов|Lviv|Одес|Odes|Дніпро|Днепр|Dnipro|Запоріж|Запорож|Zapor|Вінниц|Винниц|Vinnyts|Полтав|Poltav|Черкас|Cherkas|Чернігів|Чернигов|Chernihiv|Житомир|Zhytomyr|Миколаїв|Николаев|Mykolaiv|Херсон|Kherson|Тернопіль|Тернополь|Ternopil|Ужгород|Uzhhorod|Івано-Франківськ|Ивано-Франковск|Луцьк|Луцк|Lutsk|Рівне|Ровно|Rivne|Суми|Сумы|Sumy|Кропивницьк|Кировоград|Хмельницьк|Хмельницк/i;

// Exported so the backfill sweep judges already-ingested pets by exactly
// the same test as the gate — two copies of this rule would drift, and
// then the map and the guard would disagree about which city a pet is in.
export function looksNotKyiv(html: string): boolean {
  if (KYIV_WORDS.test(html)) return false;
  return OTHER_CITIES.test(html);
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


export class OlxSource implements Source {
  name = SOURCE;

  async runOnce(): Promise<SourceRunSummary> {
    const summary = emptySummary(SOURCE);

    // 1. Fetch every listing page, collect card candidates.
    const allCards: Card[] = [];
    for (const rawListUrl of LISTING_URLS) {
      const listUrl = sortedByNewest(rawListUrl);
      try {
        const html = await fetchText(listUrl);
        const cards = parseCards(html, listUrl);
        allCards.push(...cards);
      } catch (err) {
        const msg = `[listing ${listUrl}] ${(err as Error).message}`;
        recordError(summary, msg);
        console.warn('[olx] listing fetch failed', msg);
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
    summary.fresh = deduped.filter((c) => !seenUrls.has(c.url)).length;

    for (const card of deduped) {
      if (seenUrls.has(card.url)) {
        summary.skipped++;
        continue;
      }

      const rehoming = looksLikeRehoming(card.title);
      const lost = looksLikeLostPet(card.title);
      if (rehoming || !lost) {
        await db
          .insert(schema.scrapeLog)
          .values({
            url: card.url,
            source: SOURCE,
            title: card.title,
            ingestAction: 'skipped',
            skipReason: rehoming ? 'rehoming' : 'title-filter',
          })
          .onConflictDoNothing({ target: schema.scrapeLog.url });
        summary.skipped++;
        continue;
      }

      try {
        const adHtml = await fetchText(card.url);
        if (looksNotKyiv(adHtml)) {
          await db
            .insert(schema.scrapeLog)
            .values({
              url: card.url,
              source: SOURCE,
              title: card.title,
              ingestAction: 'skipped',
              skipReason: 'not-kyiv',
            })
            .onConflictDoNothing({ target: schema.scrapeLog.url });
          summary.skipped++;
          continue;
        }
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
              // Kept here in particular: a low-confidence parse is exactly
              // the row somebody will want to read to find out why.
              rawBody: capBody(text),
              parseConfidence: parsed.parseConfidence,
              ingestAction: 'skipped',
              skipReason: 'low-confidence',
            })
            .onConflictDoNothing({ target: schema.scrapeLog.url });
          summary.skipped++;
          continue;
        }

        // Decided from the listing title, not the parsed body: «песик
        // (знайдений)» says it plainly there, and the parser has no field
        // for it. Stored rather than filtered out — a found stray needs
        // its owner found, which is a real job deserving its own screen.
        const result = await upsertLostDog({
          parsed,
          source: SOURCE,
          isFoundReport: looksLikeFoundReport(card.title),
        });
        if (result.action === 'inserted') summary.inserted++;
        else if (result.action === 'updated') summary.updated++;
        else if (result.action === 'duplicate') summary.duplicate++;
        else if (result.action === 'skipped') summary.skipped++;

        await db
          .insert(schema.scrapeLog)
          .values({
            url: card.url,
            source: SOURCE,
            title: card.title,
            // The text the parser actually read, so the post can be shown
            // in-app and the parse can be scored against its own input.
            rawBody: capBody(text),
            dogId: result.id,
            parseConfidence: parsed.parseConfidence,
            ingestAction: result.action,
            skipReason: result.skipReason,
          })
          .onConflictDoNothing({ target: schema.scrapeLog.url });
      } catch (err) {
        const msg = `[ad ${card.url}] ${(err as Error).message}`;
        recordError(summary, msg);
        console.warn('[olx] ad parse failed', msg);
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
