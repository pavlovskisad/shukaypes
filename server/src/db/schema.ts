import {
  pgTable,
  text,
  integer,
  timestamp,
  doublePrecision,
  boolean,
  index,
} from 'drizzle-orm/pg-core';

// Users — identified by device_id until Firebase auth lands.
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  deviceId: text('device_id').notNull().unique(),
  username: text('username').notNull(),
  points: integer('points').notNull().default(0),
  totalTokens: integer('total_tokens').notNull().default(0),
  totalDistanceMeters: integer('total_distance_meters').notNull().default(0),
  homeLat: doublePrecision('home_lat'),
  homeLng: doublePrecision('home_lng'),
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
    breed: text('breed').notNull(),
    emoji: text('emoji').notNull().default('🐕'),
    photoUrl: text('photo_url'),
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
