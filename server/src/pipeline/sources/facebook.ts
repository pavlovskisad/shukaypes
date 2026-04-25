// Facebook scraper via RSSHub-style RSS bridge. Going through a bridge
// lets us avoid FB auth + the JS-rendered DOM entirely — we fetch a
// public RSS feed and parse it like the OLX listing pages. Trade-off:
// external dependency. The public rsshub.app instance has been 403-ing
// FB routes so we support a fallback list of mirrors and try them in
// order until one returns 200.
//
// Config:
//   FACEBOOK_GROUP_IDS=1059982300752044,40176110019418  (defaults below)
//   RSSHUB_BASE_URLS=url1,url2,url3                      (tried in order)
//   RSSHUB_BASE_URL=url                                  (single, alt to URLS)
//
// Each RSS <item> becomes a scrape_log row keyed on its <link> — same
// idempotency model as OLX/Telegram. <description> usually carries
// post HTML; we strip tags for the parser body and pluck the first
// <img src> as photoUrl. <title> seeds the lost/rehoming classifier.

import { load as loadHtml } from 'cheerio';
import { inArray } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { parseDogPost } from '../parser.js';
import { upsertLostDog } from '../upsert.js';
import { emptySummary, recordError, type Source, type SourceRunSummary } from '../source.js';
import { looksLikeLostPet, looksLikeRehoming } from '../keywords.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36';

// User-supplied seed groups (Kyiv lost-pet groups). Override via env if
// the curation set changes.
const DEFAULT_GROUP_IDS = ['1059982300752044', '40176110019418'];

// Default fallback chain of public RSSHub mirrors. Order matters: we
// try left-to-right and stop at the first 2xx. rsshub.app is the
// official upstream and is what new FB routes ship against, but it's
// been 403-ing for FB groups; the others are community mirrors that
// historically have different IP allowances.
const DEFAULT_RSSHUB_BASES = [
  'https://rsshub.app',
  'https://rsshub.rssforever.com',
  'https://rsshub.feeded.xyz',
  'https://rsshub.pseudoyu.com',
];

const MIN_BODY_CHARS = 60;

interface FbItem {
  link: string;
  title: string;
  body: string;
  photoUrl: string | null;
  groupId: string;
}

function groupIds(): string[] {
  const raw = process.env.FACEBOOK_GROUP_IDS;
  if (!raw) return DEFAULT_GROUP_IDS;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function rsshubBases(): string[] {
  // Plural env wins; falls through to singular env; falls through to
  // the bundled default chain. All forms get trailing-slash trimmed.
  const raw =
    process.env.RSSHUB_BASE_URLS ??
    process.env.RSSHUB_BASE_URL ??
    DEFAULT_RSSHUB_BASES.join(',');
  return raw
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'user-agent': UA,
      'accept-language': 'uk-UA,uk;q=0.9,ru;q=0.8,en;q=0.6',
      accept: 'application/rss+xml, application/xml, text/xml, */*',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.text();
}

// RSSHub's <description> is HTML escaped inside a CDATA. cheerio in
// xmlMode pulls the unescaped string; we then re-load it as HTML to
// get text + first image.
function extractFromDescription(descHtml: string): {
  body: string;
  photoUrl: string | null;
} {
  if (!descHtml) return { body: '', photoUrl: null };
  const $ = loadHtml(descHtml);
  // Replace <br> with newlines so the body retains paragraphing.
  $('br').replaceWith('\n');
  // Drop image-only nodes from the text but pluck their src.
  const photoUrl =
    $('img').first().attr('src') ?? $('media\\:content').attr('url') ?? null;
  // strip out images so the alt text doesn't leak into the body.
  $('img').remove();
  const body = $('body').length
    ? $('body').text().trim()
    : $.root().text().trim();
  return {
    body: body.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(),
    photoUrl,
  };
}

function parseRss(xml: string, groupId: string): FbItem[] {
  const $ = loadHtml(xml, { xmlMode: true });
  const items: FbItem[] = [];
  $('item').each((_i, el) => {
    const $el = $(el);
    const link = $el.find('link').first().text().trim();
    const title = $el.find('title').first().text().trim();
    if (!link) return;
    const description = $el.find('description').first().text();
    const { body, photoUrl } = extractFromDescription(description);
    // Some bridges put media:content as a sibling instead of inside
    // description — pick that up too.
    const altPhoto =
      $el.find('media\\:content').first().attr('url') ??
      $el.find('enclosure[type^="image/"]').first().attr('url') ??
      null;
    items.push({
      link,
      title,
      body,
      photoUrl: photoUrl ?? altPhoto,
      groupId,
    });
  });
  return items;
}

export class FacebookSource implements Source {
  name = 'facebook';

  async runOnce(): Promise<SourceRunSummary> {
    const summary = emptySummary('facebook');
    const groups = groupIds();
    if (groups.length === 0) return summary;
    const bases = rsshubBases();
    if (bases.length === 0) return summary;

    const all: FbItem[] = [];
    for (const id of groups) {
      // Try each mirror in order; first 2xx wins. Collect per-attempt
      // errors so /stats can show "tried A, tried B, none worked".
      let landed = false;
      const attemptErrors: string[] = [];
      for (const base of bases) {
        const url = `${base}/facebook/group/${id}`;
        try {
          const xml = await fetchText(url);
          all.push(...parseRss(xml, id));
          landed = true;
          break;
        } catch (err) {
          attemptErrors.push(`${base} -> ${(err as Error).message}`);
        }
      }
      if (!landed) {
        const msg = `[feed ${id}] all bases failed: ${attemptErrors.join(' | ')}`;
        recordError(summary, msg);
        console.warn('[facebook] feed fetch failed', id, msg);
      }
    }

    // De-dupe by link within the run — the same post can appear in two
    // groups if cross-shared.
    const seenThisRun = new Set<string>();
    const deduped = all.filter((m) =>
      seenThisRun.has(m.link) ? false : seenThisRun.add(m.link),
    );
    summary.discovered = deduped.length;
    if (deduped.length === 0) return summary;

    const links = deduped.map((m) => m.link);
    const seen = await db
      .select({ url: schema.scrapeLog.url })
      .from(schema.scrapeLog)
      .where(inArray(schema.scrapeLog.url, links));
    const seenLinks = new Set(seen.map((r) => r.url));

    for (const item of deduped) {
      if (seenLinks.has(item.link)) {
        summary.skipped++;
        continue;
      }

      const tag = `facebook:${item.groupId}`;
      // Prefer the title for the lost/rehoming gate when present, fall
      // back to first body line. RSSHub sometimes leaves the title as
      // "Post by <name>" — the body's first line is then the actual
      // signal.
      const classifierSeed =
        item.title && !/^post by /i.test(item.title)
          ? item.title
          : (item.body.split(/\r?\n/).find((l) => l.trim()) ?? '').slice(0, 200);

      if (item.body.length < MIN_BODY_CHARS) {
        await db
          .insert(schema.scrapeLog)
          .values({
            url: item.link,
            source: tag,
            title: classifierSeed,
            ingestAction: 'skipped',
            skipReason: 'too-short',
          })
          .onConflictDoNothing({ target: schema.scrapeLog.url });
        summary.skipped++;
        continue;
      }

      const rehoming = looksLikeRehoming(classifierSeed);
      const lost = looksLikeLostPet(classifierSeed);
      if (rehoming || !lost) {
        await db
          .insert(schema.scrapeLog)
          .values({
            url: item.link,
            source: tag,
            title: classifierSeed,
            ingestAction: 'skipped',
            skipReason: rehoming ? 'rehoming' : 'title-filter',
          })
          .onConflictDoNothing({ target: schema.scrapeLog.url });
        summary.skipped++;
        continue;
      }

      try {
        const parsed = await parseDogPost({
          text: item.body,
          photoUrl: item.photoUrl,
        });
        summary.parsed++;

        if (parsed.urgency === 'rehoming') {
          await db
            .insert(schema.scrapeLog)
            .values({
              url: item.link,
              source: tag,
              title: classifierSeed,
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
              url: item.link,
              source: tag,
              title: classifierSeed,
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
            url: item.link,
            source: tag,
            title: classifierSeed,
            dogId: result.id,
            parseConfidence: parsed.parseConfidence,
            ingestAction: result.action,
            skipReason: result.skipReason,
          })
          .onConflictDoNothing({ target: schema.scrapeLog.url });
      } catch (err) {
        const msg = `[item ${item.link}] ${(err as Error).message}`;
        recordError(summary, msg);
        console.warn('[facebook] item parse failed', msg);
        await db
          .insert(schema.scrapeLog)
          .values({
            url: item.link,
            source: tag,
            title: classifierSeed,
            ingestAction: 'skipped',
            skipReason: `error: ${(err as Error).message.slice(0, 200)}`,
          })
          .onConflictDoNothing({ target: schema.scrapeLog.url });
      }
    }

    return summary;
  }
}
