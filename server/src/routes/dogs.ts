import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq, gte, not, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { buildPhotoUrl } from '../services/photoUrl.js';
import { limitExpensive, limitPolling, limitRead } from '../lib/rateLimit.js';
import {
  looksLikeItHadContacts,
  looksLikeSourceMaskedContact,
  redactContacts,
} from '../pipeline/redactContacts.js';
import { composeOwnerReport } from '../pipeline/ownerReport.js';
import { capBody } from '../pipeline/adBody.js';
import { detectOtherCity } from '../pipeline/outOfArea.js';
import { upsertLostDog, KYIV_BBOX } from '../pipeline/upsert.js';
import type { ParsedDog } from '../pipeline/types.js';
import { publishToChannel, fanOutToGroups } from '../services/crosspost.js';
import { notifyOwner } from '../services/telegramNotify.js';

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
      // ORDER MATTERS, AND ITS ABSENCE WAS A BUG.
      //
      // One pet can own several scrape_log rows: a repost lands at a new
      // URL and the row is written with the same dogId whatever the
      // upsert did with it (olx.ts writes `dogId: result.id` for
      // inserted, updated AND duplicate alike). With a bare limit(1) the
      // database was free to hand back whichever it liked — including a
      // pre-17-Aug row whose raw_body is null, which reads to the walker
      // as "we never stored this ad" for a pet whose ad we are holding.
      //
      // Rows WITH a body first, then newest — so the answer is the most
      // recent text we actually have.
      .orderBy(sql`(${schema.scrapeLog.rawBody} is null)`, desc(schema.scrapeLog.firstSeenAt))
      .limit(1);

    // WHO GETS THE PHONE NUMBER IS DECIDED HERE, NOT IN THE CLIENT.
    //
    // The walker sees the ad twice, for different reasons. During a
    // search they need to identify the animal — collar, temperament,
    // what it answers to — and that is what the body is full of. Once
    // they report having seen it, they need to reach the owner.
    //
    // The app already worked this way (`sourceUrl: seen ? … : null` in
    // MapView), and keeping it server-side is what makes it real: a
    // client flag would be a suggestion, and this endpoint is reachable
    // with curl by anybody holding a device id.
    //
    // The proof is a sighting row by THIS user for THIS pet. Nothing
    // else counts — not having walked there, not having the quest open.
    const [seen] = await db
      .select({ id: schema.sightings.id })
      .from(schema.sightings)
      .where(
        and(
          eq(schema.sightings.dogId, req.params.id),
          eq(schema.sightings.reporterId, req.userId),
        ),
      )
      .limit(1);

    const raw = log?.body ?? null;
    const hideContacts = !seen;

    // `body: null` is the ordinary answer for every pet ingested before
    // the column existed, and stays ordinary for weeks. The client keeps
    // the old link-out for exactly this case, so null must read as "we
    // do not have it" rather than as an error.
    return {
      body: raw && hideContacts ? redactContacts(raw) : raw,
      // So the UI can say WHY the ad has holes in it, rather than
      // leaving somebody to think the owner wrote it that way.
      contactsHidden: raw ? hideContacts && looksLikeItHadContacts(raw) : false,
      // A SECOND, DIFFERENT REASON THE NUMBER IS NOT READABLE, and the
      // walker cannot tell them apart without being told.
      //
      // They reported the sighting, they earned the contact, and the
      // body still shows «05*******62» — because OLX masked it on the
      // page and we stored what the page said. Nothing is being withheld
      // here; the digits were never ours to hold. Only reported once the
      // gate is open, so it never contradicts the message above it.
      contactsMasked: raw ? !hideContacts && looksLikeSourceMaskedContact(raw) : false,
      // THE LINK IS GATED TOO, AND IT HAS TO BE.
      //
      // Masking the phone in the body while handing over the URL of the
      // page that prints it makes the mask decoration: one tap and the
      // gate is gone. Withholding it costs the walker nothing they need
      // mid-search — the description is what answers "is this the dog?",
      // and it is right there unmasked.
      //
      // This also restores exactly what the app did before this route
      // existed: `sourceUrl: seen ? sourceUrl : null` in MapView. There
      // was never a path to the original post without a sighting, and
      // there still is not.
      sourceUrl: seen ? (log?.url ?? null) : null,
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

  // First-party lost-pet report — the «я загубив друга» form.
  //
  // Everything the scraper pipeline has to reconstruct, the owner just
  // TELLS us: structured fields, their own pin on the map, their own
  // photo. So nothing here calls Haiku or the gazetteer — the ParsedDog
  // is assembled directly and placement_source is 'owner', the highest-
  // provenance label the ledger has.
  //
  // The photo path is the part worth reading twice. This app's photo
  // pipeline runs entirely on Telegram file_ids (routes/photos.ts).
  // Publishing the report to OUR channel via sendPhoto both stores the
  // image (the response carries the file_id) and is the first
  // crosspost. If the channel is unconfigured or down, the pet is still
  // created — without the photo, and the response says so. A lost-pet
  // report must never fail because Telegram hiccuped.
  //
  // Live instantly, reviewed after (owner's decision): the row is
  // active at once, and the app owner gets an alert with an inline
  // expire button (handled in routes/telegram.ts, ALERT_CHAT_ID only).
  app.post<{
    Body: {
      species?: string;
      name?: string;
      description?: string;
      lat?: number;
      lng?: number;
      contactPhone?: string;
      photoBase64?: string;
    };
  }>(
    '/dogs/report',
    // limitExpensive (10/min) is the burst ceiling; the real quota is
    // the daily cap below. bodyLimit raised for the base64 photo:
    // 5MB decoded ≈ 6.7MB encoded, plus the rest of the JSON.
    { ...limitExpensive, bodyLimit: 8 * 1024 * 1024 },
    async (req, reply) => {
      if (!req.userId) {
        reply.code(401);
        return { error: 'auth required' };
      }

      const { species, name, description, lat, lng, contactPhone, photoBase64 } = req.body ?? {};
      if (species !== 'dog' && species !== 'cat') {
        reply.code(400);
        return { error: 'species must be dog or cat' };
      }
      if (typeof description !== 'string' || description.trim().length < 10) {
        reply.code(400);
        return { error: 'description too short' };
      }
      if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        reply.code(400);
        return { error: 'pin required' };
      }
      // The same boundary upsert enforces, checked early so the person
      // gets a readable answer instead of a skipped row — and so no
      // channel post happens for a pet the map would refuse anyway.
      if (lat < KYIV_BBOX.south || lat > KYIV_BBOX.north || lng < KYIV_BBOX.west || lng > KYIV_BBOX.east) {
        reply.code(400);
        return { error: 'pin outside Kyiv area' };
      }
      const away = detectOtherCity(`${name ?? ''} ${description}`);
      if (away) {
        reply.code(400);
        return { error: `post names another city (${away.city}) — the map is Kyiv-only` };
      }

      // Three reports per person per day. The burst limiter above stops
      // scripts; this stops a human error loop (resubmitting a failing
      // form) from wallpapering the map.
      const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
      const [{ count: recent }] = (await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.lostDogs)
        .where(
          and(eq(schema.lostDogs.reportedBy, req.userId), gte(schema.lostDogs.createdAt, dayAgo)),
        )) as [{ count: number }];
      if (recent >= 3) {
        reply.code(429);
        return { error: 'daily report limit reached' };
      }

      const photo = decodePhoto(photoBase64);
      if (photoBase64 && !photo) {
        reply.code(400);
        return { error: 'photo must be jpeg, png or webp, up to 5MB' };
      }

      const report = composeOwnerReport({ species, name, description, contactPhone });

      // Channel post = photo upload + first crosspost, in one call.
      const channelPost = await publishToChannel(
        { caption: report.caption, photo },
        req.log,
      );

      const parsed: ParsedDog = {
        name: report.name,
        species,
        breed: 'unknown',
        emoji: report.emoji,
        lastSeenLat: lat,
        lastSeenLng: lng,
        lastSeenDescription: report.description,
        lastSeenAt: new Date().toISOString(),
        urgency: 'medium',
        searchZoneRadiusM: species === 'cat' ? 500 : 800,
        rewardPoints: 100,
        photoUrl: null,
        photoFileId: channelPost?.photoFileId ?? null,
        parseConfidence: 1,
        parseNotes: 'owner report via app',
        outOfArea: null,
        placementSource: 'owner',
      };

      const result = await upsertLostDog({ parsed, source: 'in_app', reportedBy: req.userId });
      if (result.action === 'skipped' || !result.id) {
        req.log.warn(
          { kind: 'owner_report', user: req.userId, reason: result.skipReason },
          '[report] upsert refused an owner report',
        );
        reply.code(400);
        return { error: result.skipReason ?? 'report refused' };
      }
      const dogId = result.id;

      // The full post, phone included, so «показати оголошення» works
      // for in-app pets exactly as for scraped ones. The owner typed
      // their number into a lost-pet form — publishing it to a walker
      // who reported a sighting is the number's intended purpose.
      await db
        .insert(schema.scrapeLog)
        .values({
          url: `in-app:${dogId}`,
          source: 'in_app',
          title: report.name,
          dogId,
          rawBody: capBody(report.postText),
          parseConfidence: 1,
          ingestAction: result.action,
        })
        .onConflictDoNothing();

      req.log.info(
        { kind: 'owner_report', dog_id: dogId, action: result.action, user: req.userId, has_photo: !!photo },
        '[report] owner report landed',
      );

      // Owner alert with the one-tap review control.
      void notifyOwner(
        `нове оголошення з застосунку\n${report.emoji} ${report.name}\n${report.description.slice(0, 120)}\nvia user ${req.userId.slice(0, 8)}…${channelPost?.postUrl ? `\n${channelPost.postUrl}` : ''}`,
        req.log,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '✂ прибрати з мапи', callback_data: `expire:${dogId}` }],
            ],
          },
        },
      ).catch(() => {});

      // District-group fan-out rides after the response — the poster
      // should not wait out N sequential Telegram calls.
      if (channelPost && result.action === 'inserted') {
        void fanOutToGroups({ channelMessageId: channelPost.messageId, dogId }, req.log).catch(
          (err) => req.log.warn({ kind: 'crosspost_group', err: (err as Error).message }),
        );
      }

      return {
        dogId,
        action: result.action,
        channelPostUrl: channelPost?.postUrl ?? null,
        photoStored: !!channelPost?.photoFileId,
      };
    },
  );
};

// Base64 photo (optionally a data: URI) → sniffed bytes, or null when
// it isn't one of the three formats phones actually produce, or is too
// large. Magic bytes, not the client's claimed MIME — the claim is one
// more thing the client can get wrong.
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
function decodePhoto(raw: string | undefined): { bytes: Buffer; mime: string } | null {
  if (!raw || typeof raw !== 'string') return null;
  const b64 = raw.startsWith('data:') ? raw.slice(raw.indexOf(',') + 1) : raw;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(b64, 'base64');
  } catch {
    return null;
  }
  if (bytes.length < 12 || bytes.length > MAX_PHOTO_BYTES) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { bytes, mime: 'image/jpeg' };
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { bytes, mime: 'image/png' };
  }
  if (
    bytes.toString('latin1', 0, 4) === 'RIFF' &&
    bytes.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return { bytes, mime: 'image/webp' };
  }
  return null;
}

export default plugin;
