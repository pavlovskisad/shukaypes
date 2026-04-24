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
