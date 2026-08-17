import {
  pgTable,
  text,
  integer,
  bigint,
  timestamp,
  doublePrecision,
  boolean,
  jsonb,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';

// Users. Identity comes from one of:
//   - x-device-id header (web/PWA path, anonymous, browser-scoped)
//   - x-telegram-init-data header (Mini App path, signed by Telegram)
// A user row is created on first contact via either path. Mini App
// users get a synthetic device_id ('tg:<telegram_id>') so the column
// stays NOT NULL + UNIQUE without a schema break. telegram_id +
// profile fields are nullable for legacy web-only rows.
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  deviceId: text('device_id').notNull().unique(),
  username: text('username').notNull(),
  points: integer('points').notNull().default(0),
  totalTokens: integer('total_tokens').notNull().default(0),
  totalDistanceMeters: integer('total_distance_meters').notNull().default(0),
  homeLat: doublePrecision('home_lat'),
  homeLng: doublePrecision('home_lng'),
  // Telegram identity — populated when the session arrives with a
  // valid Mini App initData payload. Partial unique index in the
  // migration enforces one app user per Telegram id.
  telegramId: bigint('telegram_id', { mode: 'number' }),
  telegramUsername: text('telegram_username'),
  telegramFirstName: text('telegram_first_name'),
  telegramPhotoUrl: text('telegram_photo_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
});

// Companion state — 1:1 with users.
export const companionState = pgTable('companion_state', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull().default('шукайпес'),
  level: integer('level').notNull().default(1),
  xp: integer('xp').notNull().default(0),
  skinId: text('skin_id').notNull().default('default'),
  hunger: integer('hunger').notNull().default(80),
  happiness: integer('happiness').notNull().default(60),
  lastFedAt: timestamp('last_fed_at', { withTimezone: true }),
  lastDecayAt: timestamp('last_decay_at', { withTimezone: true }).notNull().defaultNow(),
  memoryNotes: text('memory_notes'),
  // Territory marking state. The dog decides when to mark on its own, so
  // the cooldown + "not too close to the last one" spacing rule need the
  // previous mark's time and place. Lives here rather than in its own
  // table because it's companion behaviour, not a game object.
  lastMarkAt: timestamp('last_mark_at', { withTimezone: true }),
  lastMarkLat: doublePrecision('last_mark_lat'),
  lastMarkLng: doublePrecision('last_mark_lng'),
  // Is the dog standing on ground we hold? Written on each map sync,
  // where the territory shapes are already in hand. Denormalised onto
  // the companion because the DECAY CRON needs it: that's one bulk
  // UPDATE across every row, and it can branch on a column but can't go
  // and compute a hull per user.
  onHomeGround: boolean('on_home_ground').notNull().default(false),
});

// Tokens — scattered around user home zones. PostGIS point added via raw SQL migration.
export const tokens = pgTable(
  'tokens',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull().default('regular'), // regular | bonus | gold
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    value: integer('value').notNull().default(1),
    zoneId: text('zone_id'),
    spawnedAt: timestamp('spawned_at', { withTimezone: true }).notNull().defaultNow(),
    collectedAt: timestamp('collected_at', { withTimezone: true }),
  },
  (t) => ({
    ownerIdx: index('tokens_owner_idx').on(t.ownerId),
    collectedIdx: index('tokens_collected_idx').on(t.collectedAt),
  }),
);

// Food items (bones).
export const foodItems = pgTable(
  'food_items',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    value: integer('value').notNull().default(1),
    spawnedAt: timestamp('spawned_at', { withTimezone: true }).notNull().defaultNow(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (t) => ({
    ownerIdx: index('food_owner_idx').on(t.ownerId),
  }),
);

// Lost dogs — the core IP search layer (Phase 5 scrapers feed this).
export const lostDogs = pgTable(
  'lost_dogs',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    species: text('species').notNull().default('dog'), // dog | cat
    breed: text('breed').notNull(),
    emoji: text('emoji').notNull().default('🐕'),
    photoUrl: text('photo_url'),
    // Telegram file_id for bot-ingested photos. Stable forever (unlike
    // the file_path URL, which TG only guarantees for ~1h). When set,
    // the API serializer rewrites photoUrl to point at /photos/:fileId
    // — a server-side proxy that re-resolves the file_path on demand,
    // so the client URL stays valid indefinitely.
    photoFileId: text('photo_file_id'),
    lastSeenLat: doublePrecision('last_seen_lat').notNull(),
    lastSeenLng: doublePrecision('last_seen_lng').notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    lastSeenDescription: text('last_seen_description'),
    urgency: text('urgency').notNull().default('medium'), // urgent | medium | resolved
    searchZoneRadiusM: integer('search_zone_radius_m').notNull().default(500),
    rewardPoints: integer('reward_points').notNull().default(100),
    source: text('source').notNull().default('in_app'), // scrape | in_app
    status: text('status').notNull().default('active'), // active | found | expired
    reportedBy: text('reported_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index('dogs_status_idx').on(t.status),
  }),
);

// Sightings reported by users.
export const sightings = pgTable('sightings', {
  id: text('id').primaryKey(),
  dogId: text('dog_id')
    .notNull()
    .references(() => lostDogs.id, { onDelete: 'cascade' }),
  reporterId: text('reporter_id').references(() => users.id, { onDelete: 'set null' }),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Chat messages between a user and their companion. Keep full history for
// memory-note summarization and debugging; send only the last N to Claude.
export const messages = pgTable(
  'messages',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // user | assistant
    content: text('content').notNull(),
    mode: text('mode').notNull().default('active'), // active | ambient
    model: text('model'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cacheReadTokens: integer('cache_read_tokens'),
    cacheWriteTokens: integer('cache_write_tokens'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userCreatedIdx: index('messages_user_created_idx').on(t.userId, t.createdAt),
  }),
);

// Rate-limit / anti-cheat log — quick audit trail for collect actions.
export const collectEvents = pgTable(
  'collect_events',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // token | food
    targetId: text('target_id').notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    accepted: boolean('accepted').notNull(),
    reason: text('reason'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userAtIdx: index('collect_user_at_idx').on(t.userId, t.at),
  }),
);

// Detective quest state. One active quest per user at a time; abandoning
// or completing flips the existing one before a new one starts. Waypoints
// live in a single jsonb column — they're only ever read back whole for a
// quest, no point normalizing. Shape mirrors the shared Waypoint type
// (position + clue + reached).
export interface StoredWaypoint {
  position: { lat: number; lng: number };
  clue: string | null;
  reached: boolean;
}

export const quests = pgTable(
  'quests',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    dogId: text('dog_id').references(() => lostDogs.id, { onDelete: 'set null' }),
    type: text('type').notNull().default('detective'),
    status: text('status').notNull().default('active'), // active | completed | abandoned
    waypoints: jsonb('waypoints').$type<StoredWaypoint[]>().notNull(),
    currentIndex: integer('current_index').notNull().default(0),
    rewardPoints: integer('reward_points').notNull().default(50),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    activeIdx: index('quests_active_idx').on(t.userId, t.status),
  }),
);

// Scrape log — one row per ad url the scraper has ever seen, so an hourly
// cron doesn't re-Haiku the same post. dogId is set only when the parse
// actually produced (or matched) a row in lost_dogs.
export const scrapeLog = pgTable(
  'scrape_log',
  {
    url: text('url').primaryKey(),
    source: text('source').notNull(), // olx | telegram:<channel> | ...
    title: text('title'),
    dogId: text('dog_id').references(() => lostDogs.id, { onDelete: 'set null' }),
    // The post as the PARSER read it, verbatim, contact details included.
  //
  // Two jobs. The app can show the ad without bouncing the walker out to
  // OLX (the bounce existed only because the owner's phone number lives
  // in the ad and we never kept it). And parse accuracy can finally be
  // scored, because scoring needs the input the parser actually saw —
  // `title` is an OLX listing headline or a 200-char Telegram snippet
  // and was never enough.
  //
  // NEVER goes into a bulk response: one pet at a time, behind auth. A
  // list endpoint carrying contact details is a scrapable contact list,
  // which is a different thing from one walker reading one ad.
  rawBody: text('raw_body'),
  parseConfidence: doublePrecision('parse_confidence'),
    ingestAction: text('ingest_action'), // inserted | updated | duplicate | skipped
    skipReason: text('skip_reason'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sourceIdx: index('scrape_log_source_idx').on(t.source, t.firstSeenAt),
  }),
);

// Daily-task progress per user per local date (YYYY-MM-DD). Promoted
// from localStorage so progress survives a cache wipe and syncs across
// devices on the same userId. Date is the user's local calendar day —
// the client computes it and sends it on every tick + fetch so we
// don't have to track timezones server-side. (If the user crosses
// midnight while tabbed away, the next interaction lands on the new
// date row; "yesterday" is implicitly closed-out.)
export const dailyTasks = pgTable(
  'daily_tasks',
  {
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    tokens: integer('tokens').notNull().default(0),
    bones: integer('bones').notNull().default(0),
    lostPetChecks: integer('lost_pet_checks').notNull().default(0),
    spotVisits: integer('spot_visits').notNull().default(0),
    sightings: integer('sightings').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.date] }),
  }),
);

// Kyiv lore — a curated geo-indexed corpus of stories the companion
// can mention when the walker passes by. Built one-off by seed-lore.ts
// from OSM (historic / tourism / memorial / artwork tags) joined with
// Wikidata + Wikipedia, each entry rewritten through Sonnet into a
// single in-voice sentence. Read at chat time by buildContextBlock via
// a small haversine proximity query.
export const kyivLore = pgTable(
  'kyiv_lore',
  {
    id: text('id').primaryKey(), // osm:<type>:<id>
    name: text('name').notNull(),
    nameEn: text('name_en'),
    category: text('category').notNull(), // historic | memorial | tourism | artwork | religious | park | other
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    story: text('story').notNull(),
    osmType: text('osm_type').notNull(), // node | way | relation
    osmId: text('osm_id').notNull(),
    wikidataId: text('wikidata_id'),
    wikipediaTitle: text('wikipedia_title'),
    sourceLang: text('source_lang'), // uk | en
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastRewroteAt: timestamp('last_rewrote_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    bboxIdx: index('lore_lat_lng_idx').on(t.lat, t.lng),
  }),
);

// Kyiv place-name index. Built from OSM (Overpass API) — streets,
// squares, metro stations, parks, neighbourhoods, districts. Powers
// the lost-pet parser: when Haiku extracts a location mention like
// "Львівська площа" or "вул. Артема", we fuzzy-match it against this
// table to resolve real coordinates instead of falling back to a
// hard-coded ~30-landmark hints table.
//
// kyivLore is a parallel table — narrower (cultural landmarks only,
// with stories) and lookup-by-radius only. Kept separate because the
// lore use-case wants curated POIs with prose, not exhaustive street
// geometry. Same source (OSM), different shape.
//
// search_key is the canonical name lowercased + diacritics stripped,
// for fast trigram fuzzy match (pg_trgm index added in a follow-up
// migration). aliases is a hand-curated + extracted-from-OSM list of
// alternate spellings/inflections (e.g. "Khreshchatyk" for "Хрещатик").
export const kyivGazetteer = pgTable(
  'kyiv_gazetteer',
  {
    id: text('id').primaryKey(), // osm:<type>:<id>
    nameUk: text('name_uk').notNull(),
    nameEn: text('name_en'),
    aliases: text('aliases').array().notNull().default([]),
    // Pre-joined + normalised concatenation of every alias for the
    // GIN trigram index. We can't index `lower(array_to_string(aliases,
    // ' '))` directly because array_to_string isn't IMMUTABLE in
    // Postgres, and index expressions require IMMUTABLE functions.
    // Materialising the blob at seed time costs one .join() per row.
    aliasesText: text('aliases_text').notNull().default(''),
    searchKey: text('search_key').notNull(), // normalised: lowercase, no diacritics
    category: text('category').notNull(), // street | square | metro | park | neighbourhood | district | building
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    osmType: text('osm_type').notNull(), // node | way | relation
    osmId: text('osm_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    searchIdx: index('kyiv_gazetteer_search_idx').on(t.searchKey),
    categoryIdx: index('kyiv_gazetteer_category_idx').on(t.category),
  }),
);

// Places API cache. The client used to call Google Places directly
// from every device per pan, which burned ~$100 in days because each
// fetch is 5 Places calls. Server now proxies + caches by a coarse
// (cell, category) key — first user to ping a cell pays one Google
// call per category, subsequent calls (other users, repeat pans)
// served from this table for `placesCacheTtlMs`.
//
// Cell size is 0.01° (~1.1 km × 0.7 km at Kyiv latitude); a typical
// user fetch covers 2–6 cells. The cached `spots` payload is the raw
// Google response per cell, distance-sorted client-side after
// merging. Composite PK on (cell_lat, cell_lng, category) so an
// upsert just overwrites the row when a refresh is due.
export interface CachedPlace {
  id: string;
  name: string;
  category: string;
  position: { lat: number; lng: number };
  rating?: number;
  address?: string;
  icon?: string;
}

export const placesCache = pgTable(
  'places_cache',
  {
    cellLat: doublePrecision('cell_lat').notNull(),
    cellLng: doublePrecision('cell_lng').notNull(),
    category: text('category').notNull(),
    spots: jsonb('spots').$type<CachedPlace[]>().notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.cellLat, t.cellLng, t.category] }),
    fetchedIdx: index('places_cache_fetched_idx').on(t.fetchedAt),
  }),
);

// Territory marks — the individual spots a dog has marked.
//
// Marks used to BE the ownership record: a territory was the hull of a
// cluster of live marks, rebuilt from scratch on every read. That model
// could not express the one thing territory has to be able to do — lose a
// piece and keep the rest. A shape recomputed from dots has nowhere to
// remember a bite out of it, so a dot that got overrun could only survive
// (and hand the ground back later), die (and collapse the whole shape,
// down to nothing at three dots), or move (and change the shape into
// something that was never the cut).
//
// So ground lives in territory_ground now, and marks do what a dog's mark
// actually does: they GROW the ground, and they show where the dog has
// been. What they no longer do is define it, which is why losing one can
// no longer delete it.
//
// Decay is a read-time filter on created_at rather than a sweep, so an
// untouched mark costs nothing until someone looks at it. It only limits
// the hull the NEXT mark draws — expiring marks never take back ground
// already held.
export const territoryMarks = pgTable(
  'territory_marks',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    // Set when this mark closed a loop, so the client can draw the ring
    // it completed and we don't re-claim the same enclosure twice.
    closedLoop: boolean('closed_loop').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userCreatedIdx: index('territory_marks_user_created_idx').on(t.userId, t.createdAt),
    // Rivals' marks are looked up by area, not by owner: "whose marks are
    // near this point" for both contesting and for drawing their ground.
    bboxIdx: index('territory_marks_bbox_idx').on(t.lat, t.lng),
  }),
);

// Territory ground — the ground itself, one row per piece.
//
// THE source of truth for who holds what. Two owners can never overlap:
// where they would, the cut has already been applied at mark time, so a
// read is a read. That is also what makes it affordable — the old model
// clustered marks, built hulls and ran polygon subtraction for everyone
// in view on EVERY sync, which was the whole CPU problem. The same work
// now happens once, when a dog marks.
//
// A piece is a ring plus its holes, in [lng, lat] order — the winding
// polygon-clipping and GeoJSON both use, so it goes in and out of the
// clipper without conversion.
//
// bbox columns rather than PostGIS: the question is only ever "which
// pieces are in this view", a plain range scan answers it, and the
// deployment does not have to grow an extension. area_m2 is stored
// because the leaderboard wants a SUM, not a geometry library.
export const territoryGround = pgTable(
  'territory_ground',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ring: jsonb('ring').$type<[number, number][]>().notNull(),
    holes: jsonb('holes').$type<[number, number][][]>(),
    minLat: doublePrecision('min_lat').notNull(),
    maxLat: doublePrecision('max_lat').notNull(),
    minLng: doublePrecision('min_lng').notNull(),
    maxLng: doublePrecision('max_lng').notNull(),
    areaM2: doublePrecision('area_m2').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('territory_ground_user_idx').on(t.userId),
    // "What is in this box" — the only spatial question asked.
    bboxIdx: index('territory_ground_bbox_idx').on(t.minLat, t.maxLat, t.minLng, t.maxLng),
  }),
);

// Raids — someone marked over your ground.
//
// Delivered on the victim's next sync and then marked seen, rather than
// pushed through Redis like pokes: a raid that happens while you're
// asleep still has to reach you, and a 2-minute TTL would drop it.
export const territoryRaids = pgTable(
  'territory_raids',
  {
    id: text('id').primaryKey(),
    victimId: text('victim_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    raiderId: text('raider_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Denormalised: the notification says who, and we don't want a join on
    // the sync path (nor a broken message if the raider is ever removed).
    raiderName: text('raider_name').notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    // True when the raid finished the mark off rather than just weakening
    // it — the difference between "someone's sniffing around" and "we lost
    // that corner".
    killed: boolean('killed').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    seenAt: timestamp('seen_at', { withTimezone: true }),
  },
  (t) => ({
    victimIdx: index('territory_raids_victim_idx').on(t.victimId, t.seenAt),
  }),
);

// Invite codes for the closed beta.
//
// The web path creates an account for any unseen x-device-id header, so
// without this the "closed" round is a public URL. Telegram initData is
// signed and gives real identity, but the bot is still discoverable, so
// both paths redeem a code when INVITE_REQUIRED is on.
//
// Gates CREATION ONLY. Every existing account keeps resolving by its
// device id untouched — there are several hundred of them, they have no
// email and no password, and a code checked on every request rather
// than only on the insert would lock all of them out permanently with
// no recovery path.
export const inviteCodes = pgTable('invite_codes', {
  // The code itself, as typed. Short and human-shareable.
  code: text('code').primaryKey(),
  // Multi-use by design: one code per cohort or per channel is easier
  // to hand out than one per person, and revoking is still one row.
  maxUses: integer('max_uses').notNull().default(1),
  usedCount: integer('used_count').notNull().default(0),
  // Free text — who it went to, which channel it was posted in.
  note: text('note'),
  // Set to stop a code working without deleting the record of who used
  // it. Revocation should not erase the audit trail.
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Which code let an account in. Kept separate from users so the join is
// explicit and a revoked code can be traced to everyone it admitted.
export const inviteRedemptions = pgTable(
  'invite_redemptions',
  {
    id: text('id').primaryKey(),
    code: text('code')
      .notNull()
      .references(() => inviteCodes.code, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    redeemedAt: timestamp('redeemed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codeIdx: index('invite_redemptions_code_idx').on(t.code),
  }),
);

// EVERY completed search, found or not.
//
// `sightings` only ever gets a row when somebody answers "yes, I saw it".
// The other answer — zone walked, nothing there — is the MAJORITY case and
// the one that proves a walker actually searched, and until now it wrote
// nothing but an ephemeral Fly log line. So "how many searches were
// completed" could not be computed from this database at all, which makes
// it the one number the product and the fundraise both lean on and neither
// can show.
//
// Deliberately separate from `sightings` rather than a nullable-lat
// `seen: false` row in it. `sightings` means "the pet was here", it is
// read by the map and by the pin-moving logic, and widening it to mean
// "somebody looked" would put rows that assert nothing into every query
// that currently assumes otherwise.
//
// Nothing downstream reads this yet. It is written now so that when the
// admin console asks for a search funnel there is history to draw, rather
// than a chart that starts on the day somebody thought to record it.
export const searchResults = pgTable(
  'search_results',
  {
    id: text('id').primaryKey(),
    // The pet stays referenced with a cascade: if a pet is deleted its
    // searches are meaningless. Expiring one — the reversible form we
    // prefer — leaves these rows alone.
    dogId: text('dog_id')
      .notNull()
      .references(() => lostDogs.id, { onDelete: 'cascade' }),
    // Null when the searcher's account is later deleted. The search still
    // happened, and the counts should not silently drop when somebody
    // leaves.
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    seen: boolean('seen').notNull(),
    // What the search paid out, so the reward economy can be read back
    // without re-deriving it from rules that may have changed since.
    paws: integer('paws').notNull(),
    // Where the searcher was when they answered. Null on a "not found":
    // the client sends no position with that answer today, and inventing
    // one would be worse than admitting we do not have it.
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // The funnel is read by time, and per-pet to answer "how hard was this
    // one searched before it was found".
    createdAtIdx: index('search_results_created_at_idx').on(t.createdAt),
    dogIdx: index('search_results_dog_id_idx').on(t.dogId),
  }),
);
