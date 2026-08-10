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
import { and, desc, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, schema } from '../db/index.js';

const MAX_NOTE_CHARS = 200;
const TRUST_MULTIPLIER = 2; // 2x search radius = "close enough" to move the pin
// What one paw is worth in points, matching a token picked up off the map.
const PAW_POINTS = 3;

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

  // CLOSING A SEARCH.
  //
  // The dog asks one question at the end of a supersniff — did you see
  // them? — and both answers are worth something. "No" is a real result:
  // somebody walked that zone and the pet was not there, which is exactly
  // the information a search needs and nobody ever bothers to record.
  // Paying only for a find would train people to lie.
  //
  // "Yes" additionally writes a sighting (same rules as /sightings: the
  // pin only moves if the report is close enough and the pet is still
  // listed) and hands back where the original post lives.
  //
  // ON THE SOURCE LINK, AND WHY IT IS A LINK.
  //
  // We hold no owner contacts. The ingest parser strips phone numbers,
  // names and handles on purpose, so there is nothing here to hand over
  // and nothing to leak. What we do keep is the permalink of the post the
  // pet came from, and the owner's own contact is already in it, publicly,
  // written by them.
  //
  // Sending the finder to that post beats extracting the number for them:
  // no personal data passes through us, the contact arrives in its own
  // context (photo, date, the owner's wording), and it works the same for
  // every source. Scraping it on demand would also be less reliable, not
  // more — t.me/s only renders the last ~20 messages of a channel, so an
  // older post cannot be re-read even though its permalink still opens
  // perfectly well in a browser.
  app.post<{ Body: { dogId?: string; seen?: boolean; lat?: number; lng?: number } }>(
    '/sightings/search-result',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { dogId, seen, lat, lng } = req.body ?? {};
      if (!dogId || typeof seen !== 'boolean') {
        reply.code(400);
        return { error: 'dogId and seen required' };
      }
      const [dog] = await db
        .select({
          id: schema.lostDogs.id,
          lat: schema.lostDogs.lastSeenLat,
          lng: schema.lostDogs.lastSeenLng,
          radiusM: schema.lostDogs.searchZoneRadiusM,
          reward: schema.lostDogs.rewardPoints,
          status: schema.lostDogs.status,
        })
        .from(schema.lostDogs)
        .where(eq(schema.lostDogs.id, dogId))
        .limit(1);
      if (!dog) {
        reply.code(404);
        return { error: 'dog not found' };
      }

      // PAID IN PAWS, NOT IN POINTS.
      //
      // "+200 points" is a number with no place in the world — nothing
      // else in the game is denominated in it and nobody can picture it.
      // Paws are the thing you spend all day picking up off the pavement,
      // so a handful of them at the end of a search is a reward you
      // already know the size of.
      //
      // 20 for a find, 10 for a zone walked and found empty. Flat rather
      // than scaled off the pet's rewardPoints, because a reward you can
      // count in your head is worth more than one that is technically
      // proportional — and the pet's own number was never shown anywhere.
      const paws = seen ? 20 : 10;

      let sightingId: string | null = null;
      if (seen && typeof lat === 'number' && typeof lng === 'number') {
        sightingId = nanoid();
        await db.insert(schema.sightings).values({
          id: sightingId,
          dogId,
          reporterId: req.userId || null,
          lat,
          lng,
          note: null,
        });
        const dist = haversineM(dog.lat, dog.lng, lat, lng);
        if (dist <= dog.radiusM * TRUST_MULTIPLIER && dog.status === 'active') {
          await db
            .update(schema.lostDogs)
            .set({ lastSeenLat: lat, lastSeenLng: lng, lastSeenAt: new Date() })
            .where(eq(schema.lostDogs.id, dogId));
        }
      }

      if (req.userId) {
        // Same two columns a real pickup moves, so the HUD counter and
        // the score stay one story. PAW_POINTS mirrors what a token on
        // the ground is worth.
        await db
          .update(schema.users)
          .set({
            totalTokens: sql`${schema.users.totalTokens} + ${paws}`,
            points: sql`${schema.users.points} + ${paws * PAW_POINTS}`,
          })
          .where(eq(schema.users.id, req.userId));
      }

      // Where the pet was posted, if it came from a scrape. In-app reports
      // have no permalink and get null — the client offers nothing rather
      // than a dead button.
      const [src] = await db
        .select({ url: schema.scrapeLog.url })
        .from(schema.scrapeLog)
        .where(eq(schema.scrapeLog.dogId, dogId))
        .limit(1);

      req.log.info(
        { kind: 'search_result', dogId, seen, paws, sightingId },
        'search closed',
      );
      return { ok: true, seen, paws, sightingId, sourceUrl: src?.url ?? null };
    },
  );
};

export default plugin;
