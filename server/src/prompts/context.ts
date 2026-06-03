// Layer 3: live context. ~400–800 tokens. Built fresh per call, never cached.

import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

// NearbySpot is sent from the client per chat call (the server doesn't
// persist Google Places data — keeping the API quota client-side).
// Already-distance-sorted, capped to a small handful by the client.
export interface NearbySpot {
  id: string;
  name: string;
  category: string;
  distM: number;
}

interface ContextInput {
  userId: string;
  pos?: { lat: number; lng: number } | null;
  // Where the user is currently looking on the map. When set, lore +
  // lost-pet proximity queries use this instead of `pos` so the dog
  // can chat about Podil while the human is panning Podil from
  // Pechersk. Falls back to `pos` when null. Game-mechanic state
  // (current GPS line, mechanic anchoring) still uses `pos`.
  viewport?: { lat: number; lng: number } | null;
  spots?: NearbySpot[];
}

export async function buildContextBlock({ userId, pos, viewport, spots }: ContextInput): Promise<string> {
  // browsePos = "where we look right now" — viewport when present,
  // otherwise fall back to the user's GPS so a no-viewport caller
  // behaves identically to the old code.
  const browsePos = viewport ?? pos ?? null;
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

  let nearbyPets: string[] = [];
  if (pos) {
    // Filter by distance in SQL, then order by distance ASC so the closest
    // three reports come back even if older pets are the closest.
    const distExpr = sql<number>`(6371000 * acos(cos(radians(${pos.lat})) * cos(radians(last_seen_lat)) * cos(radians(last_seen_lng) - radians(${pos.lng})) + sin(radians(${pos.lat})) * sin(radians(last_seen_lat))))`;
    const pets = await db
      .select({
        id: schema.lostDogs.id,
        name: schema.lostDogs.name,
        species: schema.lostDogs.species,
        breed: schema.lostDogs.breed,
        urgency: schema.lostDogs.urgency,
        description: schema.lostDogs.lastSeenDescription,
        dist: distExpr,
      })
      .from(schema.lostDogs)
      .where(
        and(
          eq(schema.lostDogs.status, 'active'),
          sql`NOT (${schema.lostDogs.lastSeenLat} = 50.4501 AND ${schema.lostDogs.lastSeenLng} = 30.5234)`,
          sql`${distExpr} < 5000`,
        ),
      )
      .orderBy(distExpr)
      .limit(3);
    nearbyPets = pets.map((p) => {
      const desc = p.description ? ` — ${p.description}` : '';
      return `  - ${p.name} (${p.species}, ${p.breed}, ${p.urgency}), ~${Math.round(p.dist)}m away${desc} [id:${p.id}]`;
    });
  }

  const kyivTime = new Date().toLocaleString('en-GB', { timeZone: 'Europe/Kyiv' });

  // Nearby spots the companion can route to via walk_to_spot. Cap at
  // 8 — beyond that, the prompt bloats and the model's selection
  // accuracy doesn't improve. Only included when spots were sent and
  // the companion can actually emit walk_to_spot for them.
  let nearbySpots: string[] = [];
  if (spots && spots.length > 0) {
    nearbySpots = spots.slice(0, 8).map((s) => {
      return `  - ${s.name} (${s.category}), ~${Math.round(s.distM)}m away [id:${s.id}]`;
    });
  }

  // Kyiv lore — pre-rewritten short stories the dog already "knows"
  // about places around him. Pull at most 3 within ~250 m of where
  // the human is BROWSING (viewport when set, else GPS) so they land
  // as natural recall about the area on screen, not the area you're
  // physically standing on. Each story is already a dog-voice
  // sentence; the dog can drop one verbatim or paraphrase.
  let nearbyLore: string[] = [];
  const lorePos = browsePos;
  const browsingViewport = viewport != null && !!pos;
  if (lorePos) {
    const loreDist = sql<number>`(6371000 * acos(cos(radians(${lorePos.lat})) * cos(radians(lat)) * cos(radians(lng) - radians(${lorePos.lng})) + sin(radians(${lorePos.lat})) * sin(radians(lat))))`;
    const lore = await db
      .select({
        name: schema.kyivLore.name,
        category: schema.kyivLore.category,
        story: schema.kyivLore.story,
        dist: loreDist,
      })
      .from(schema.kyivLore)
      .where(sql`${loreDist} < 250`)
      .orderBy(loreDist)
      .limit(3);
    nearbyLore = lore.map(
      (l) => `  - ${l.name} (${l.category}, ~${Math.round(l.dist)}m): "${l.story}"`,
    );
  }

  const lines = [
    'CONTEXT (live, changes every request)',
    `- local time in Kyiv: ${kyivTime}`,
    `- your hunger: ${companion.hunger}/100 (${hungerLabel}). your happiness: ${companion.happiness}/100 (${happyLabel}).`,
    `- the human has ${user.points} treats saved up and ${user.totalTokens} tokens picked up so far.`,
    `- uncollected tokens still on the map: ${uncollectedTokens[0]?.n ?? 0}`,
    pos ? `- current GPS: ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}` : '- GPS not shared this turn',
    browsingViewport
      ? `- the human is looking at a different part of the map than where they're standing — viewport centre ~${viewport!.lat.toFixed(5)}, ${viewport!.lng.toFixed(5)}. places/stories below are about THAT area; if asked "what's interesting here" or "tell me about this place", refer to those.`
      : null,
    nearbyPets.length ? `- lost pets nearby you could mention (dogs or cats — mention by name if natural):\n${nearbyPets.join('\n')}` : '- no active lost-pet reports in your radius',
    nearbySpots.length ? `- nearby spots you can route to via walk_to_spot (mention by name if the human asks):\n${nearbySpots.join('\n')}` : '- no spots loaded this turn',
    nearbyLore.length
      ? `- places you happen to know within ~250m of where the human is looking — drop one in if it lands naturally for this turn OR if they explicitly ask for something interesting / a story / what's around. otherwise ignore:\n${nearbyLore.join('\n')}`
      : null,
  ].filter(Boolean);
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
