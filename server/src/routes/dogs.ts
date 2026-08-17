import type { FastifyPluginAsync } from 'fastify';
import { and, eq, not, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { buildPhotoUrl } from '../services/photoUrl.js';
import { limitPolling, limitRead } from '../lib/rateLimit.js';

interface NearbyQuery {
  lat: string;
  lng: string;
  radius?: string;
}

// The parser falls back to the Kyiv city-center coord when a post gives no
// geographic signal. Those pets exist in the DB (they're real lost-pet
// reports) but they shouldn't render on the map — users see a pile of
// dozens of pins at exactly one landmark and the clustering goes wild.
// Filter them here; admin endpoints still see the full set.
const FALLBACK_LAT = 50.4501;
const FALLBACK_LNG = 30.5234;

const plugin: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: NearbyQuery }>('/dogs/nearby', limitPolling, async (req, reply) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const radiusM = Number(req.query.radius ?? '5000');
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radiusM)) {
      reply.code(400);
      return { error: 'invalid query' };
    }

    // Haversine in SQL (postgres-js doesn't love PostGIS types everywhere).
    const rows = await db
      .select({
        id: schema.lostDogs.id,
        name: schema.lostDogs.name,
        species: schema.lostDogs.species,
        breed: schema.lostDogs.breed,
        emoji: schema.lostDogs.emoji,
        photoUrl: schema.lostDogs.photoUrl,
        photoFileId: schema.lostDogs.photoFileId,
        lat: schema.lostDogs.lastSeenLat,
        lng: schema.lostDogs.lastSeenLng,
        at: schema.lostDogs.lastSeenAt,
        urgency: schema.lostDogs.urgency,
        zoneRadiusM: schema.lostDogs.searchZoneRadiusM,
        rewardPoints: schema.lostDogs.rewardPoints,
      })
      .from(schema.lostDogs)
      .where(
        and(
          eq(schema.lostDogs.status, 'active'),
          not(
            and(
              eq(schema.lostDogs.lastSeenLat, FALLBACK_LAT),
              eq(schema.lostDogs.lastSeenLng, FALLBACK_LNG),
            )!,
          ),
          sql`
            2 * 6371000 * ASIN(SQRT(
              POWER(SIN(RADIANS(${lat} - ${schema.lostDogs.lastSeenLat}) / 2), 2)
              + COS(RADIANS(${lat})) * COS(RADIANS(${schema.lostDogs.lastSeenLat}))
              * POWER(SIN(RADIANS(${lng} - ${schema.lostDogs.lastSeenLng}) / 2), 2)
            )) <= ${radiusM}
          `,
        ),
      );

    return {
      dogs: rows.map((r) => ({
        id: r.id,
        name: r.name,
        species: r.species,
        breed: r.breed,
        emoji: r.emoji,
        photoUrl: buildPhotoUrl(r.photoFileId, r.photoUrl),
        urgency: r.urgency,
        rewardPoints: r.rewardPoints,
        searchZoneRadiusM: r.zoneRadiusM,
        lastSeen: { position: { lat: r.lat, lng: r.lng }, at: r.at.toISOString() },
      })),
    };
  });

  // Single-dog lookup. /dogs/nearby is GPS-bounded, so a deep-link
  // (?startapp=lost-<id>) opened from Telegram can't rely on it —
  // the user might be standing far from the pet's last-seen pin.
  // This endpoint returns the same projection shape as /dogs/nearby's
  // array items so the client can drop it straight into the same
  // store list and reuse the existing modal/marker code.
  // THE AD ITSELF, one pet at a time.
  //
  // Until now the app bounced the walker out to OLX after a sighting,
  // because the owner's phone number is in the ad and the ad was thrown
  // away at ingest. It is stored now (scrape_log.raw_body), so the post
  // can be read without leaving.
  //
  // ITS OWN ROUTE, DELIBERATELY. This never joins /sync/map or
  // /dogs/nearby, for two reasons that both matter:
  //
  //   - /sync/map goes to every walker every 15 seconds and was just cut
  //     from 54KB to 27KB. An 8KB ad per pet would undo that at a stroke.
  //   - a LIST endpoint carrying contact details is a scrapable contact
  //     list. One walker reading one ad is a different thing, and this
  //     shape is what keeps it that way.
  //
  // Expired pets return nothing: expiring is the takedown path
  // (db/expire-pet.ts), so it has to take the contact details with it.
  app.get<{ Params: { id: string } }>('/dogs/:id/post', limitRead, async (req, reply) => {
    const [dog] = await db
      .select({ status: schema.lostDogs.status })
      .from(schema.lostDogs)
      .where(eq(schema.lostDogs.id, req.params.id))
      .limit(1);
    if (!dog || dog.status !== 'active') {
      reply.code(404);
      return { error: 'not found' };
    }

    const [log] = await db
      .select({
        body: schema.scrapeLog.rawBody,
        url: schema.scrapeLog.url,
        at: schema.scrapeLog.firstSeenAt,
      })
      .from(schema.scrapeLog)
      .where(eq(schema.scrapeLog.dogId, req.params.id))
      .limit(1);

    // `body: null` is the ordinary answer for every pet ingested before
    // the column existed, and stays ordinary for weeks. The client keeps
    // the old link-out for exactly this case, so null must read as "we
    // do not have it" rather than as an error.
    return {
      body: log?.body ?? null,
      sourceUrl: log?.url ?? null,
      fetchedAt: log?.at ? log.at.toISOString() : null,
    };
  });

  app.get<{ Params: { id: string } }>('/dogs/:id', limitRead, async (req, reply) => {
    const [row] = await db
      .select({
        id: schema.lostDogs.id,
        name: schema.lostDogs.name,
        species: schema.lostDogs.species,
        breed: schema.lostDogs.breed,
        emoji: schema.lostDogs.emoji,
        photoUrl: schema.lostDogs.photoUrl,
        photoFileId: schema.lostDogs.photoFileId,
        lat: schema.lostDogs.lastSeenLat,
        lng: schema.lostDogs.lastSeenLng,
        at: schema.lostDogs.lastSeenAt,
        urgency: schema.lostDogs.urgency,
        zoneRadiusM: schema.lostDogs.searchZoneRadiusM,
        rewardPoints: schema.lostDogs.rewardPoints,
        status: schema.lostDogs.status,
      })
      .from(schema.lostDogs)
      .where(eq(schema.lostDogs.id, req.params.id))
      .limit(1);
    if (!row) {
      reply.code(404);
      return { error: 'not found' };
    }
    return {
      dog: {
        id: row.id,
        name: row.name,
        species: row.species,
        breed: row.breed,
        emoji: row.emoji,
        photoUrl: buildPhotoUrl(row.photoFileId, row.photoUrl),
        urgency: row.urgency,
        rewardPoints: row.rewardPoints,
        searchZoneRadiusM: row.zoneRadiusM,
        lastSeen: { position: { lat: row.lat, lng: row.lng }, at: row.at.toISOString() },
        status: row.status,
      },
    };
  });
};

export default plugin;
