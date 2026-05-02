// Shared query bodies for the map's "what's near me" data —
// extracted so both the per-resource endpoints (/tokens/nearby,
// /food/nearby, /dogs/nearby, /state) and the bulk /sync/map endpoint
// can hit the same code path without copy-pasta.
//
// Each function returns the same shape the existing route returned in
// its response body, so existing client decoders keep working.

import { and, eq, isNull, not, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { LatLng } from '../utils/geo.js';
import { xpProgress, MAX_LEVEL } from '../lib/xp.js';

// Mirrors /tokens/nearby's TOKEN_VIEW_RADIUS_M — keep in sync.
const TOKEN_VIEW_RADIUS_M = 2000;
// Fallback Kyiv-center coords used by the parser when a post has no
// geographic signal — those pets shouldn't render on the map.
const FALLBACK_LAT = 50.4501;
const FALLBACK_LNG = 30.5234;

type TokenRow = typeof schema.tokens.$inferSelect;

export interface MapToken {
  id: string;
  type: TokenRow['type'];
  value: number;
  position: LatLng;
  spawnedAt: string;
}

export async function fetchNearbyTokens(
  userId: string,
  pos: LatLng,
): Promise<MapToken[]> {
  const rows = await db
    .select({
      id: schema.tokens.id,
      type: schema.tokens.type,
      lat: schema.tokens.lat,
      lng: schema.tokens.lng,
      value: schema.tokens.value,
      spawnedAt: schema.tokens.spawnedAt,
    })
    .from(schema.tokens)
    .where(
      and(
        eq(schema.tokens.ownerId, userId),
        isNull(schema.tokens.collectedAt),
        sql`(
          2 * 6371000 * ASIN(SQRT(
            POWER(SIN(RADIANS(${pos.lat} - ${schema.tokens.lat}) / 2), 2)
            + COS(RADIANS(${pos.lat})) * COS(RADIANS(${schema.tokens.lat}))
            * POWER(SIN(RADIANS(${pos.lng} - ${schema.tokens.lng}) / 2), 2)
          ))
        ) <= ${TOKEN_VIEW_RADIUS_M}`,
      ),
    );
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    value: r.value,
    position: { lat: r.lat, lng: r.lng } satisfies LatLng,
    spawnedAt: r.spawnedAt.toISOString(),
  }));
}

export interface MapFood {
  id: string;
  value: number;
  position: LatLng;
  spawnedAt: string;
}

export async function fetchNearbyFood(userId: string): Promise<MapFood[]> {
  const rows = await db
    .select({
      id: schema.foodItems.id,
      lat: schema.foodItems.lat,
      lng: schema.foodItems.lng,
      value: schema.foodItems.value,
      spawnedAt: schema.foodItems.spawnedAt,
    })
    .from(schema.foodItems)
    .where(
      and(
        eq(schema.foodItems.ownerId, userId),
        isNull(schema.foodItems.consumedAt),
      ),
    );
  return rows.map((r) => ({
    id: r.id,
    value: r.value,
    position: { lat: r.lat, lng: r.lng } satisfies LatLng,
    spawnedAt: r.spawnedAt.toISOString(),
  }));
}

type LostDogRow = typeof schema.lostDogs.$inferSelect;

export interface MapLostDog {
  id: string;
  name: string;
  species: string;
  breed: string | null;
  emoji: string;
  photoUrl: string | null;
  urgency: LostDogRow['urgency'];
  rewardPoints: number;
  searchZoneRadiusM: number;
  lastSeen: { position: LatLng; at: string };
}

export async function fetchNearbyLostDogs(
  pos: LatLng,
  radiusM: number,
): Promise<MapLostDog[]> {
  const rows = await db
    .select({
      id: schema.lostDogs.id,
      name: schema.lostDogs.name,
      species: schema.lostDogs.species,
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
        not(
          and(
            eq(schema.lostDogs.lastSeenLat, FALLBACK_LAT),
            eq(schema.lostDogs.lastSeenLng, FALLBACK_LNG),
          )!,
        ),
        sql`
          2 * 6371000 * ASIN(SQRT(
            POWER(SIN(RADIANS(${pos.lat} - ${schema.lostDogs.lastSeenLat}) / 2), 2)
            + COS(RADIANS(${pos.lat})) * COS(RADIANS(${schema.lostDogs.lastSeenLat}))
            * POWER(SIN(RADIANS(${pos.lng} - ${schema.lostDogs.lastSeenLng}) / 2), 2)
          )) <= ${radiusM}
        `,
      ),
    );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    species: r.species,
    breed: r.breed,
    emoji: r.emoji,
    photoUrl: r.photoUrl,
    urgency: r.urgency,
    rewardPoints: r.rewardPoints,
    searchZoneRadiusM: r.zoneRadiusM,
    lastSeen: { position: { lat: r.lat, lng: r.lng }, at: r.at.toISOString() },
  }));
}

export interface UserStateResponse {
  user: {
    id: string;
    username: string | null;
    points: number;
    totalTokens: number;
    totalDistanceMeters: number;
  };
  companion: {
    name: string;
    level: number;
    xp: number;
    xpInLevel: number;
    xpForNextLevel: number;
    maxLevel: number;
    skinId: string;
    hunger: number;
    happiness: number;
    lastFedAt: string | null;
  };
}

export async function fetchUserState(userId: string): Promise<UserStateResponse | null> {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  const [companion] = await db
    .select()
    .from(schema.companionState)
    .where(eq(schema.companionState.userId, userId))
    .limit(1);
  if (!user || !companion) return null;
  const { level, xpInLevel, xpForNextLevel } = xpProgress(companion.xp);
  return {
    user: {
      id: user.id,
      username: user.username,
      points: user.points,
      totalTokens: user.totalTokens,
      totalDistanceMeters: user.totalDistanceMeters,
    },
    companion: {
      name: companion.name,
      level,
      xp: companion.xp,
      xpInLevel,
      xpForNextLevel,
      maxLevel: MAX_LEVEL,
      skinId: companion.skinId,
      hunger: companion.hunger,
      happiness: companion.happiness,
      lastFedAt: companion.lastFedAt?.toISOString() ?? null,
    },
  };
}
