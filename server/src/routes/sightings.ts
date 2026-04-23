// Sightings: users report "I've seen this dog near here". Each sighting
// persists in the `sightings` table and, when the reported location is
// inside the dog's declared search zone, also refreshes the dog's
// last-seen coord + timestamp — closing the user → system feedback loop.
//
// Anti-abuse:
// - Device-id auth required (the global plugin already enforces this).
// - Reported coord must be within 2x the dog's searchZoneRadiusM of the
//   current last-seen point. Further away and we log but don't move
//   the pin — probably a different pet or a misclick.

import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, schema } from '../db/index.js';

const MAX_NOTE_CHARS = 200;
const TRUST_MULTIPLIER = 2; // 2x search radius = "close enough" to move the pin

interface ReportBody {
  dogId?: string;
  lat?: number;
  lng?: number;
  note?: string;
}

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const plugin: FastifyPluginAsync = async (app) => {
  app.post<{ Body: ReportBody }>(
    '/sightings',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { dogId, lat, lng } = req.body ?? {};
      const note =
        typeof req.body?.note === 'string' ? req.body.note.slice(0, MAX_NOTE_CHARS) : null;

      if (!dogId || typeof lat !== 'number' || typeof lng !== 'number') {
        reply.code(400);
        return { error: 'dogId + lat + lng required' };
      }

      const [dog] = await db
        .select({
          id: schema.lostDogs.id,
          lat: schema.lostDogs.lastSeenLat,
          lng: schema.lostDogs.lastSeenLng,
          radiusM: schema.lostDogs.searchZoneRadiusM,
          status: schema.lostDogs.status,
        })
        .from(schema.lostDogs)
        .where(eq(schema.lostDogs.id, dogId))
        .limit(1);

      if (!dog) {
        reply.code(404);
        return { error: 'dog not found' };
      }

      const dist = haversineM(dog.lat, dog.lng, lat, lng);
      const trusted = dist <= dog.radiusM * TRUST_MULTIPLIER;

      const id = nanoid();
      await db.insert(schema.sightings).values({
        id,
        dogId,
        reporterId: req.userId || null,
        lat,
        lng,
        note,
      });

      // Only refresh the dog's last-seen if the user was close enough AND
      // the dog is still active (don't un-resolve a found dog).
      if (trusted && dog.status === 'active') {
        await db
          .update(schema.lostDogs)
          .set({
            lastSeenLat: lat,
            lastSeenLng: lng,
            lastSeenAt: new Date(),
          })
          .where(eq(schema.lostDogs.id, dogId));
      }

      req.log.info(
        { kind: 'sighting_report', dogId, distM: Math.round(dist), trusted, id },
        'sighting reported',
      );

      return { ok: true, id, trusted, distM: Math.round(dist) };
    },
  );

  // Lightweight read for a future UI ("others have seen this pet too").
  app.get<{ Querystring: { dogId?: string; limit?: string } }>(
    '/sightings',
    async (req, reply) => {
      const dogId = req.query?.dogId;
      if (!dogId) {
        reply.code(400);
        return { error: 'dogId required' };
      }
      const limit = Math.min(Math.max(parseInt(req.query?.limit ?? '20', 10) || 20, 1), 100);
      const rows = await db
        .select({
          id: schema.sightings.id,
          lat: schema.sightings.lat,
          lng: schema.sightings.lng,
          note: schema.sightings.note,
          at: schema.sightings.createdAt,
        })
        .from(schema.sightings)
        .where(and(eq(schema.sightings.dogId, dogId)))
        .orderBy(desc(schema.sightings.createdAt))
        .limit(limit);
      return {
        sightings: rows.map((r) => ({
          id: r.id,
          position: { lat: r.lat, lng: r.lng },
          note: r.note,
          at: r.at.toISOString(),
        })),
      };
    },
  );
};

export default plugin;
