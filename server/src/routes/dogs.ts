import type { FastifyPluginAsync } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

interface NearbyQuery {
  lat: string;
  lng: string;
  radius?: string;
}

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
        breed: schema.lostDogs.breed,
        emoji: schema.lostDogs.emoji,
        photoUrl: schema.lostDogs.photoUrl,
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
        breed: r.breed,
        emoji: r.emoji,
        photoUrl: r.photoUrl,
        urgency: r.urgency,
        rewardPoints: r.rewardPoints,
        searchZoneRadiusM: r.zoneRadiusM,
        lastSeen: { position: { lat: r.lat, lng: r.lng }, at: r.at.toISOString() },
      })),
    };
  });
};

export default plugin;
