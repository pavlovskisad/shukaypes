// Layer 3: live context. ~400–800 tokens. Built fresh per call, never cached.

import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

interface ContextInput {
  userId: string;
  pos?: { lat: number; lng: number } | null;
}

export async function buildContextBlock({ userId, pos }: ContextInput): Promise<string> {
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

  if (!user || !companion) return 'CONTEXT\n(no state yet)';

  const hungerLabel = labelFor(companion.hunger, 'hunger');
  const happyLabel = labelFor(companion.happiness, 'happiness');
  const uncollectedTokens = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.tokens)
    .where(and(eq(schema.tokens.ownerId, userId), isNull(schema.tokens.collectedAt)));

  let nearbyDogs: string[] = [];
  if (pos) {
    // Filter by distance in SQL, then order by distance ASC so the closest
    // three reports come back even if older dogs are the closest.
    const distExpr = sql<number>`(6371000 * acos(cos(radians(${pos.lat})) * cos(radians(last_seen_lat)) * cos(radians(last_seen_lng) - radians(${pos.lng})) + sin(radians(${pos.lat})) * sin(radians(last_seen_lat))))`;
    const dogs = await db
      .select({
        id: schema.lostDogs.id,
        name: schema.lostDogs.name,
        breed: schema.lostDogs.breed,
        urgency: schema.lostDogs.urgency,
        description: schema.lostDogs.lastSeenDescription,
        dist: distExpr,
      })
      .from(schema.lostDogs)
      .where(and(eq(schema.lostDogs.status, 'active'), sql`${distExpr} < 5000`))
      .orderBy(distExpr)
      .limit(3);
    nearbyDogs = dogs.map((d) => {
      const desc = d.description ? ` — ${d.description}` : '';
      return `  - ${d.name} (${d.breed}, ${d.urgency}), ~${Math.round(d.dist)}m away${desc} [id:${d.id}]`;
    });
  }

  const kyivTime = new Date().toLocaleString('en-GB', { timeZone: 'Europe/Kyiv' });

  const lines = [
    'CONTEXT (live, changes every request)',
    `- local time in Kyiv: ${kyivTime}`,
    `- your hunger: ${companion.hunger}/100 (${hungerLabel}). your happiness: ${companion.happiness}/100 (${happyLabel}).`,
    `- the human has ${user.points} treats saved up and ${user.totalTokens} tokens picked up so far.`,
    `- uncollected tokens still on the map: ${uncollectedTokens[0]?.n ?? 0}`,
    pos ? `- current GPS: ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}` : '- GPS not shared this turn',
    nearbyDogs.length ? `- lost dogs nearby you could mention:\n${nearbyDogs.join('\n')}` : '- no active lost-dog reports in your radius',
  ];
  return lines.join('\n');
}

function labelFor(value: number, kind: 'hunger' | 'happiness'): string {
  if (kind === 'hunger') {
    if (value < 20) return 'starving, beg for food';
    if (value < 40) return 'hungry';
    if (value < 70) return 'peckish';
    return 'full and content';
  }
  if (value < 20) return 'sad, needs attention';
  if (value < 40) return 'restless';
  if (value < 70) return 'ok';
  return 'happy, tail wagging';
}
