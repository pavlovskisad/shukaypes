import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

// Public read-only pipeline status. Hit from anywhere — phone browser,
// curl, dashboard. No auth, returns aggregate counts + the last N
// scrape_log rows so you can see what each source is producing without
// an admin bearer or DB shell access.

const FALLBACK_LAT = 50.4501;
const FALLBACK_LNG = 30.5234;

const RECENT_SCRAPE_LIMIT = 30;

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/stats', async () => {
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

    return {
      ts: new Date().toISOString(),
      lostDogsActive: {
        total: activeRow[0]?.n ?? 0,
        atFallbackCoord: fallbackRow[0]?.n ?? 0,
        byUrgency: Object.fromEntries(byUrgency.map((r) => [r.urgency, r.n])),
        bySource: Object.fromEntries(bySource.map((r) => [r.source, r.n])),
      },
      scrapeLifetime: sourceTotals,
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
