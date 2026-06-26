import type { FastifyPluginAsync } from 'fastify';
import { and, eq, not, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { buildPhotoUrl } from '../services/photoUrl.js';

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
  app.get<{ Querystring: NearbyQuery }>('/dogs/nearby', async (req, reply) => {
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
  app.get<{ Params: { id: string } }>('/dogs/:id', async (req, reply) => {
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
