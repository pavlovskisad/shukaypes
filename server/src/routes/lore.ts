// Kyiv-lore discover endpoint — used by the map's long-press "sniff
// this place" gesture. Given a press point + a list of already-shown
// ids, returns one nearby lore entry the dog can talk about.
//
// Pick strategy: take the 10 closest entries within radius, pick one
// at random. That gives variety on re-press without ever surfacing a
// place too far from where the human actually pointed.

import type { FastifyPluginAsync } from 'fastify';
import { and, notInArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

const DEFAULT_RADIUS_M = 350;
const POOL_SIZE = 10;

const plugin: FastifyPluginAsync = async (app) => {
  app.get<{
    Querystring: {
      lat?: string;
      lng?: string;
      radius?: string;
      exclude?: string | string[];
    };
  }>('/lore/discover', async (req, reply) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      reply.code(400);
      return { error: 'lat + lng required' };
    }
    const radius = Number.isFinite(Number(req.query.radius))
      ? Math.max(50, Math.min(2000, Number(req.query.radius)))
      : DEFAULT_RADIUS_M;
    // Fastify exposes repeated `?exclude=` query params as either a
    // single string or an array. Normalize.
    const rawEx = req.query.exclude;
    const exclude: string[] = Array.isArray(rawEx)
      ? rawEx
      : typeof rawEx === 'string' && rawEx.length > 0
        ? rawEx.split(',')
        : [];

    const dist = sql<number>`(6371000 * acos(cos(radians(${lat})) * cos(radians(lat)) * cos(radians(lng) - radians(${lng})) + sin(radians(${lat})) * sin(radians(lat))))`;
    const whereClauses = exclude.length
      ? and(sql`${dist} < ${radius}`, notInArray(schema.kyivLore.id, exclude))
      : sql`${dist} < ${radius}`;
    const pool = await db
      .select({
        id: schema.kyivLore.id,
        name: schema.kyivLore.name,
        category: schema.kyivLore.category,
        story: schema.kyivLore.story,
        lat: schema.kyivLore.lat,
        lng: schema.kyivLore.lng,
        dist,
      })
      .from(schema.kyivLore)
      .where(whereClauses)
      .orderBy(dist)
      .limit(POOL_SIZE);

    if (pool.length === 0) {
      return { lore: null };
    }
    const pick = pool[Math.floor(Math.random() * pool.length)]!;
    return {
      lore: {
        id: pick.id,
        name: pick.name,
        category: pick.category,
        story: pick.story,
        position: { lat: pick.lat, lng: pick.lng },
        distM: Math.round(pick.dist),
      },
    };
  });
};

export default plugin;
