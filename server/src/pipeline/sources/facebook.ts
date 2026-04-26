// Facebook scraper via mbasic.facebook.com with a saved login session.
// We tried RSSHub bridges first (#79, #84) — every public mirror 403'd,
// the closed groups need actual auth. mbasic is FB's stripped-down
// mobile site: light HTML, no JS, parseable with cheerio. Sending the
// session cookies of a logged-in throwaway account passes the gate
// without spinning up Chromium.
//
// Config:
//   FACEBOOK_GROUP_IDS=1059982300752044,40176110019418  (defaults below)
//   FACEBOOK_COOKIES="c_user=…; xs=…; datr=…; fr=…"     (Cookie header)
//
// How to get cookies (one-time, ~5min):
//   1. Log into facebook.com on a desktop browser (use a throwaway
//      account, never your main — bot detection can ban it).
//   2. DevTools → Application → Cookies → facebook.com.
//   3. Copy at least: c_user, xs, datr, fr, sb, presence.
//      Format: "name=value; name=value; …"
//   4. flyctl secrets set FACEBOOK_COOKIES="…"
//
// Sessions usually live weeks → months. When we start seeing "session-
// expired" errors in /stats.recentTicks.facebook, re-export.
//
// Each post becomes a scrape_log row keyed on its permalink — same
// idempotency model as OLX/Telegram/RSSHub.

import { load as loadHtml } from 'cheerio';
import { inArray } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { parseDogPost } from '../parser.js';
import { upsertLostDog } from '../upsert.js';
import { emptySummary, recordError, type Source, type SourceRunSummary } from '../source.js';
import { looksLikeLostPet, looksLikeRehoming } from '../keywords.js';

// Mobile Safari UA — mbasic prefers mobile clients and serves cleaner
// HTML to them. Desktop UA gets a different layout and sometimes a
// "switch to mobile" interstitial.
const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';

const DEFAULT_GROUP_IDS = ['1059982300752044', '40176110019418'];
const MIN_BODY_CHARS = 60;

interface FbPost {
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

function cookieHeader(): string | null {
  const raw = process.env.FACEBOOK_COOKIES?.trim();
  if (!raw) return null;
  return raw;
}

async function fetchGroupHtml(
  groupId: string,
  cookies: string,
): Promise<string> {
  const url = `https://mbasic.facebook.com/groups/${groupId}`;
  const res = await fetch(url, {
    headers: {
      'user-agent': UA,
      'accept-language': 'uk-UA,uk;q=0.9,ru;q=0.8,en;q=0.6',
      cookie: cookies,
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  // FB silently 200s the login page when cookies are stale. The final
  // URL after redirects gives it away.
  const finalUrl = res.url;
  if (/\/login(?:\.php)?(?:[/?]|$)/i.test(finalUrl) ||
      /\/checkpoint/i.test(finalUrl)) {
    throw new Error(`session-expired (redirected to ${finalUrl})`);
  }
  return res.text();
}

// mbasic group page wraps each post in `article[data-store]` or
// `div[role="article"]` depending on the layout flavor. We try a few
// selectors; whatever lands is fine. Permalink is always anchor with
// `/groups/<id>/permalink/` or `?story_fbid=`.
function parseGroupPage(html: string, groupId: string): FbPost[] {
  const $ = loadHtml(html);
  const out: FbPost[] = [];
  const seenLinks = new Set<string>();

  // Multiple selectors because mbasic's per-post wrapper varies. Order:
  // most specific to least.
  const candidates = $(
    'article[data-store], div[role="article"], div.story_body_container, #m_story_permalink_view article',
  );

  candidates.each((_i, el) => {
    const $el = $(el);

    // Find the first permalink-shaped anchor inside.
    let href: string | undefined;
    $el
      .find(`a[href*="/groups/${groupId}/permalink/"], a[href*="story_fbid="]`)
      .each((_j, a) => {
        const h = $(a).attr('href');
        if (h && !href) href = h;
      });
    if (!href) return;
    let link = href.startsWith('http') ? href : `https://www.facebook.com${href}`;
    try {
      // Canonical: drop query (besides story_fbid which we keep).
      const u = new URL(link);
      // story_fbid + id pair is the canonical permalink format on legacy
      // posts; preserve those, drop tracking params.
      const keep = new URLSearchParams();
      const sf = u.searchParams.get('story_fbid');
      const ide = u.searchParams.get('id');
      if (sf) keep.set('story_fbid', sf);
      if (ide) keep.set('id', ide);
      u.search = keep.toString() ? `?${keep.toString()}` : '';
      u.hash = '';
      link = u.toString();
    } catch {
      /* leave as-is */
    }
    if (seenLinks.has(link)) return;
    seenLinks.add(link);

    // Body text: collect all visible text under the article, drop
    // navigational / chrome bits.
    const $clone = $el.clone();
    $clone.find('script, style, nav, footer').remove();
    const body = $clone
      .text()
      .replace(/\s+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (body.length < 30) return;

    // First non-emoji image.
    const photoUrl = $el.find('img').first().attr('src') ?? null;

    out.push({
      link,
      title: body.slice(0, 120),
      body,
      photoUrl,
      groupId,
    });
  });

  return out;
}

export class FacebookSource implements Source {
  name = 'facebook';

  async runOnce(): Promise<SourceRunSummary> {
    const summary = emptySummary('facebook');
    const cookies = cookieHeader();
    if (!cookies) {
      // No-op when cookies aren't configured — same pattern as Telegram
      // when TELEGRAM_CHANNELS is unset. Surfaces a clear "needs config"
      // signal at /stats without throwing on every tick.
      recordError(summary, 'FACEBOOK_COOKIES not set — source disabled');
      return summary;
    }
    const groups = groupIds();
    if (groups.length === 0) return summary;

    const all: FbPost[] = [];
    for (const id of groups) {
      try {
        const html = await fetchGroupHtml(id, cookies);
        const posts = parseGroupPage(html, id);
        if (posts.length === 0) {
          // Page loaded but parsed nothing — usually means mbasic
          // changed its post wrapper. Surface so we can adjust selectors.
          recordError(summary, `[group ${id}] page loaded, 0 posts parsed`);
        }
        all.push(...posts);
      } catch (err) {
        recordError(summary, `[group ${id}] ${(err as Error).message}`);
        console.warn('[facebook] group fetch failed', id, (err as Error).message);
      }
    }

    // Same pipeline as RSSHub version: dedupe → filter seen → classify
    // → parse → upsert → log.
    const seenThisRun = new Set<string>();
    const deduped = all.filter((p) =>
      seenThisRun.has(p.link) ? false : seenThisRun.add(p.link),
    );
    summary.discovered = deduped.length;
    if (deduped.length === 0) return summary;

    const links = deduped.map((p) => p.link);
    const seen = await db
      .select({ url: schema.scrapeLog.url })
      .from(schema.scrapeLog)
      .where(inArray(schema.scrapeLog.url, links));
    const seenLinks = new Set(seen.map((r) => r.url));

    for (const post of deduped) {
      if (seenLinks.has(post.link)) {
        summary.skipped++;
        continue;
      }

      const tag = `facebook:${post.groupId}`;
      // Title-or-first-line classifier seed (FB has no separate title
      // field; the first line of the post usually carries the signal).
      const seed =
        (post.body.split(/\r?\n/).find((l) => l.trim()) ?? '').slice(0, 200);

      if (post.body.length < MIN_BODY_CHARS) {
        await db
          .insert(schema.scrapeLog)
          .values({
            url: post.link,
            source: tag,
            title: seed,
            ingestAction: 'skipped',
            skipReason: 'too-short',
          })
          .onConflictDoNothing({ target: schema.scrapeLog.url });
        summary.skipped++;
        continue;
      }

      const rehoming = looksLikeRehoming(seed);
      const lost = looksLikeLostPet(seed);
      if (rehoming || !lost) {
        await db
          .insert(schema.scrapeLog)
          .values({
            url: post.link,
            source: tag,
            title: seed,
            ingestAction: 'skipped',
            skipReason: rehoming ? 'rehoming' : 'title-filter',
          })
          .onConflictDoNothing({ target: schema.scrapeLog.url });
        summary.skipped++;
        continue;
      }

      try {
        const parsed = await parseDogPost({
          text: post.body,
          photoUrl: post.photoUrl,
        });
        summary.parsed++;

        if (parsed.urgency === 'rehoming') {
          await db
            .insert(schema.scrapeLog)
            .values({
              url: post.link,
              source: tag,
              title: seed,
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
              url: post.link,
              source: tag,
              title: seed,
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
            url: post.link,
            source: tag,
            title: seed,
            dogId: result.id,
            parseConfidence: parsed.parseConfidence,
            ingestAction: result.action,
            skipReason: result.skipReason,
          })
          .onConflictDoNothing({ target: schema.scrapeLog.url });
      } catch (err) {
        const errMsg = `[post ${post.link}] ${(err as Error).message}`;
        recordError(summary, errMsg);
        console.warn('[facebook] post parse failed', errMsg);
        await db
          .insert(schema.scrapeLog)
          .values({
            url: post.link,
            source: tag,
            title: seed,
            ingestAction: 'skipped',
            skipReason: `error: ${(err as Error).message.slice(0, 200)}`,
          })
          .onConflictDoNothing({ target: schema.scrapeLog.url });
      }
    }

    return summary;
  }
}
