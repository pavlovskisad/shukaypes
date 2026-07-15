// Short Claude-Haiku-authored bubbles for detective quest beats:
// start, waypoint arrival, quest complete. One-liners in the
// companion's voice — not the full CORE_SYSTEM prompt (that's tuned
// for open chat and carries the full safety block, overkill here).
// Fails soft: any API error returns null so the route can fall back
// to a hardcoded bubble.

import { anthropic, AMBIENT_MODEL } from './anthropic.js';

const QUEST_NARRATION_SYSTEM = `You are шукайпес — a small dog companion in Kyiv.
You narrate short one-line bubbles during a "detective search" walk where the human is helping you trail a lost pet.

VOICE
- 4–12 words, one line only. no emoji except 🐾 occasionally.
- lowercase, warm, playful-detective. a dog on a mission, nose to the ground.
- mix ukrainian/russian/english when it fits the moment.
- no markdown, no quotes around the line, no preamble. output just the bubble text.
- never say "quest", "objective", "XP", "points", "level". you're a dog sniffing real places.
- never break character. never say "as an AI". never invent specific addresses or names.

OUTPUT
Respond with ONLY the bubble text — one short sentence, no surrounding quotes.`;

async function narrate(prompt: string): Promise<string | null> {
  try {
    const resp = await anthropic().messages.create({
      model: AMBIENT_MODEL,
      max_tokens: 60,
      temperature: 0.7,
      system: QUEST_NARRATION_SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    });
    const block = resp.content.find((c) => c.type === 'text');
    if (!block || block.type !== 'text') return null;
    const text = block.text.trim();
    if (!text) return null;
    // Occasionally Haiku wraps the line in quotes despite the rule; strip.
    return text.replace(/^[\s"'«»“”]+|[\s"'«”»]+$/g, '').trim() || null;
  } catch {
    return null;
  }
}

interface DogContext {
  name: string;
  species: string; // dog | cat
  breed: string;
}

export async function narrateQuestStart(
  dog: DogContext,
  waypointCount: number,
): Promise<string | null> {
  return narrate(
    `We just started a search for ${dog.name} (${dog.species}, ${dog.breed}). ${waypointCount} spots to check inside the search zone. One short opening line — playful, committed, nose to the ground.`,
  );
}

export async function narrateWaypointReached(
  dog: DogContext,
  index: number,
  total: number,
): Promise<string | null> {
  return narrate(
    `We just arrived at spot ${index + 1} of ${total} searching for ${dog.name}. Found a little trace here — a paw print, a scent, a scrap, whatever feels right. One short line noticing it and pulling the walker forward to the next spot.`,
  );
}

export async function narrateQuestComplete(
  dog: DogContext,
  total: number,
): Promise<string | null> {
  return narrate(
    `We finished all ${total} spots looking for ${dog.name}. No confirmed sighting yet. One short closing line — hint that if the walker spots ${dog.name} somewhere they can tap "i've seen them", or that we keep eyes open as we walk on.`,
  );
}

// Per-waypoint clues. Generated once at quest start so we don't burn a
// Haiku call per arrival. Returns N short clues — each one describes
// what the companion notices / suspects at that specific waypoint
// ("she'd nap by the warm vent", "kids feed strays here at dusk").
//
// Two touches: the clues ESCALATE (early stops are faint/old traces, later
// ones warmer, the last is the strongest lead — we're closing in), and where
// a stop snapped to a real place (placeNames[i]) the companion names it, so
// the trail reads as real Kyiv spots rather than abstract dots.
//
// Fails soft: returns null if the API call or the JSON parse fails;
// the caller leaves clue=null and the client falls back to the
// generic narrateWaypointReached on advance.
export async function narrateWaypointClues(
  dog: DogContext,
  count: number,
  placeNames: (string | null)[] = [],
): Promise<string[] | null> {
  try {
    const stopLines = Array.from({ length: count }, (_, i) => {
      const place = placeNames[i];
      return place
        ? `stop ${i + 1}: near ${place}`
        : `stop ${i + 1}: (somewhere along the way)`;
    }).join('\n');
    const resp = await anthropic().messages.create({
      model: AMBIENT_MODEL,
      max_tokens: 240,
      temperature: 0.8,
      system: QUEST_NARRATION_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `We're about to start a detective search for ${dog.name} (${dog.species}, ${dog.breed}) — ${count} stops in order:
${stopLines}

For each stop, write ONE short clue (5-10 words) the companion notices or suspects there.
- The trail ESCALATES: the first stops are faint or old traces, the middle ones warmer, and the LAST stop is the strongest, freshest lead — like we're closing in on ${dog.name}.
- If a stop names a real place, weave that place into its clue naturally.
- Vary the sensory details and hunches. Don't number them. Don't add quotes.
Output ONLY a JSON array of ${count} strings, nothing else.

Example shape: ["a faint old scent by the tram stop", "fresher now — someone fed a stray here", "warm — fur caught on the fence", "she was just here, by the park gate"]`,
        },
      ],
    });
    const block = resp.content.find((c) => c.type === 'text');
    if (!block || block.type !== 'text') return null;
    const raw = block.text.trim();
    // Strip code fences if Haiku wraps the JSON.
    const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    const parsed: unknown = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return null;
    const clues = parsed
      .map((c) => (typeof c === 'string' ? c.trim() : ''))
      .filter((c) => c.length > 0);
    if (clues.length < count) return null;
    return clues.slice(0, count);
  } catch {
    return null;
  }
}
