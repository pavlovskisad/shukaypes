// Memory summarisation pass. Triggered fire-and-forget after each
// active chat turn lands; only actually calls Haiku every Nth turn so
// we don't burn tokens on every reply. Reads the latest exchanges +
// the existing memory note, asks Haiku to fold the new info in, and
// writes the result back to companionState.memoryNotes (already
// existing column, previously unused). Hard-caps the output length
// so a runaway reply can't blow up the next chat's input.

import { and, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { anthropic, AMBIENT_MODEL } from './anthropic.js';

// Re-summarise once every N user-or-assistant messages. Lower = fresher
// memory, higher = cheaper. 6 ≈ ~3 round-trips between updates.
const MESSAGES_PER_UPDATE = 6;
// How many recent messages to include in the summarisation context.
const HISTORY_WINDOW = 16;
// Hard cap on the stored note. Beyond this it starts to push out
// other system blocks; trimming Haiku's reply is the safety net.
const MAX_NOTE_CHARS = 600;

const SYSTEM = `You maintain a running memory note for шукайпес — a small dog companion in Kyiv — about ONE specific human walker. The note is what the dog remembers across sessions: language preference, the human's own dog (if any), favourite walks, habits, neighbourhoods, pets they searched for. Future chats inject this note so шукайпес can reference these details naturally.

OUTPUT
- Plain text, ≤ 500 characters.
- Short bullet-style sentences. No headers, no markdown.
- Keep the dog voice optional — these are notes-to-self, not dialogue.
- If a fact in the OLD memory is contradicted by RECENT messages, replace it. Otherwise carry it forward.
- If RECENT messages don't add anything new, you may return the OLD memory verbatim.
- Never invent facts. Only write what the human actually said or what's clearly implied.
- Output ONLY the new memory text, nothing else.`;

interface RecentMessage {
  role: 'user' | 'assistant';
  content: string;
}

async function recentExchanges(userId: string): Promise<RecentMessage[]> {
  const rows = await db
    .select({ role: schema.messages.role, content: schema.messages.content })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.userId, userId),
        eq(schema.messages.mode, 'active'),
      ),
    )
    .orderBy(desc(schema.messages.createdAt))
    .limit(HISTORY_WINDOW);
  return rows
    .reverse()
    .map((r) => ({
      role: (r.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: r.content,
    }));
}

async function activeMessageCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.userId, userId),
        eq(schema.messages.mode, 'active'),
      ),
    );
  return row?.n ?? 0;
}

export async function maybeUpdateMemory(userId: string): Promise<void> {
  // Cheap gate: only re-summarise every Nth message. Avoids one Haiku
  // call per turn while still keeping the note fresh on a normal
  // session pace.
  const total = await activeMessageCount(userId);
  if (total === 0 || total % MESSAGES_PER_UPDATE !== 0) return;

  const [companion] = await db
    .select({ notes: schema.companionState.memoryNotes })
    .from(schema.companionState)
    .where(eq(schema.companionState.userId, userId))
    .limit(1);
  const existing = companion?.notes?.trim() ?? '';

  const exchanges = await recentExchanges(userId);
  if (exchanges.length === 0) return;

  const transcript = exchanges
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  const userPrompt = `OLD MEMORY:
${existing || '(empty)'}

RECENT MESSAGES (oldest first):
${transcript}

Write the updated memory now.`;

  try {
    const resp = await anthropic().messages.create({
      model: AMBIENT_MODEL,
      max_tokens: 350,
      temperature: 0.4,
      system: SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const block = resp.content.find((c) => c.type === 'text');
    if (!block || block.type !== 'text') return;
    const next = block.text.trim().slice(0, MAX_NOTE_CHARS);
    if (!next) return;
    await db
      .update(schema.companionState)
      .set({ memoryNotes: next })
      .where(eq(schema.companionState.userId, userId));
  } catch {
    // Memory update is best-effort; don't surface failures.
  }
}

// Used by the chat route after assistant message lands. Wrapped to
// keep the route signature clean — the call is fire-and-forget so
// it never blocks the response.
export function scheduleMemoryUpdate(userId: string): void {
  void maybeUpdateMemory(userId).catch(() => {});
}

