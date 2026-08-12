import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { getTickHistory } from '../services/scrape-history.js';
import { limitRead } from '../lib/rateLimit.js';
import { checkReportAuth } from '../lib/adminAuth.js';

// Operator read-only pipeline status. Hit from a phone browser, curl or
// the admin console with REPORT_TOKEN or ADMIN_TOKEN. Returns aggregate
// counts + the last N
// scrape_log rows so you can see what each source is producing without
// an admin bearer or DB shell access.

const FALLBACK_LAT = 50.4501;
const FALLBACK_LNG = 30.5234;

const RECENT_SCRAPE_LIMIT = 30;

const plugin: FastifyPluginAsync = async (app) => {
  // OPERATOR ENDPOINT, NOT A PUBLIC ONE.
  //
  // This was reachable by anyone, and it republished `scrape_log.title`.
  // For a pet ingested through the Telegram bot that title is the first
  // 200 characters of the message somebody sent — including a private
  // DM to the bot — and the parser's contact-stripping applies to
  // `lastSeenDescription`, NOT to the title. So phone numbers and names
  // that a person typed to a dog were being served to the open internet,
  // alongside the chat ids of the source channels.
  //
  // Nothing in the client calls this; it has always been a human
  // debugging surface. So it takes the same key as the rest of the
  // read-only operator surface rather than losing the fields that make
  // it useful. The admin console will authenticate the same way.
  app.get('/stats', limitRead, async (req, reply) => {
    if (!checkReportAuth(req.headers.authorization)) {
      reply.code(401);
      return { error: 'unauthorized' };
    }
    const [
      activeRow,
      byUrgency,
      bySource,
      fallbackRow,
      recentScrapeLog,
      scrapeBySource,
    ] = await Promise.all([
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.lostDogs)
        .where(eq(schema.lostDogs.status, 'active')),
      db
        .select({
          urgency: schema.lostDogs.urgency,
          n: sql<number>`count(*)::int`,
        })
        .from(schema.lostDogs)
        .where(eq(schema.lostDogs.status, 'active'))
        .groupBy(schema.lostDogs.urgency),
      db
        .select({
          source: schema.lostDogs.source,
          n: sql<number>`count(*)::int`,
        })
        .from(schema.lostDogs)
        .where(eq(schema.lostDogs.status, 'active'))
        .groupBy(schema.lostDogs.source),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.lostDogs)
        .where(
          and(
            eq(schema.lostDogs.status, 'active'),
            eq(schema.lostDogs.lastSeenLat, FALLBACK_LAT),
            eq(schema.lostDogs.lastSeenLng, FALLBACK_LNG),
          ),
        ),
      db
        .select({
          source: schema.scrapeLog.source,
          title: schema.scrapeLog.title,
          confidence: schema.scrapeLog.parseConfidence,
          action: schema.scrapeLog.ingestAction,
          skipReason: schema.scrapeLog.skipReason,
          dogId: schema.scrapeLog.dogId,
          firstSeenAt: schema.scrapeLog.firstSeenAt,
        })
        .from(schema.scrapeLog)
        .orderBy(desc(schema.scrapeLog.firstSeenAt))
        .limit(RECENT_SCRAPE_LIMIT),
      // Per-source aggregate of the scrape pipeline lifetime — what each
      // source has done in total, regardless of whether the dog is
      // still active. Useful for "is FB actually returning anything?"
      db
        .select({
          source: schema.scrapeLog.source,
          action: schema.scrapeLog.ingestAction,
          n: sql<number>`count(*)::int`,
        })
        .from(schema.scrapeLog)
        .groupBy(schema.scrapeLog.source, schema.scrapeLog.ingestAction),
    ]);

    // Re-shape scrapeBySource into { source: { inserted, updated, skipped, ... } }
    const sourceTotals: Record<string, Record<string, number>> = {};
    for (const row of scrapeBySource) {
      const action = row.action ?? 'unknown';
      sourceTotals[row.source] = sourceTotals[row.source] ?? {};
      sourceTotals[row.source]![action] = row.n;
    }

    const total = activeRow[0]?.n ?? 0;
    const atFallback = fallbackRow[0]?.n ?? 0;
    return {
      ts: new Date().toISOString(),
      lostDogsActive: {
        total,
        // What /dogs/nearby actually shows — fallback-coord pets are
        // hidden from the map but kept in the DB for audit, so the
        // headline number matches what users see.
        totalOnMap: total - atFallback,
        atFallbackCoord: atFallback,
        byUrgency: Object.fromEntries(byUrgency.map((r) => [r.urgency, r.n])),
        bySource: Object.fromEntries(bySource.map((r) => [r.source, r.n])),
      },
      scrapeLifetime: sourceTotals,
      // Last N tick summaries per source — surfaces sources that ran
      // with discovered=0 (bridge empty / channels unset) and sources
      // that threw before writing any scrape_log row. Gone on restart;
      // promote to redis if we ever scale beyond one machine.
      recentTicks: getTickHistory(),
      recentScrape: recentScrapeLog.map((r) => ({
        source: r.source,
        title: r.title,
        confidence: r.confidence,
        action: r.action,
        skipReason: r.skipReason,
        dogId: r.dogId,
        at: r.firstSeenAt.toISOString(),
      })),
    };
  });
};

export default plugin;
