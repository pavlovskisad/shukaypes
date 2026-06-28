// Layer 2: per-user memory notes. ~300–500 tokens. Not cached (user-scoped).
// Phase 4 just threads saved notes through. Summarization pass lands with Phase 5.

import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

export async function loadMemoryBlock(userId: string): Promise<string> {
  const [companion] = await db
    .select({ notes: schema.companionState.memoryNotes, name: schema.companionState.name })
    .from(schema.companionState)
    .where(eq(schema.companionState.userId, userId))
    .limit(1);

  const notes = companion?.notes?.trim();
  if (!notes) {
    return `MEMORY\nYou have not met this human before. Their companion name for you is "${companion?.name ?? 'шукайпес'}". Be curious but don't over-promise — you haven't learned them yet.`;
  }
  // The note carries two sections: FACTS (recall naturally) and
  // RUNNING BITS (inside jokes you already share with this human).
  // Frame the bits so the dog weaves one back in when it fits instead
  // of reciting them — callbacks are what make it feel like it has
  // history with them, but only when timed, never as a list.
  return `MEMORY (what you remember about this human)\n${notes}\n\nThe RUNNING BITS are jokes you already share — drop one back in when the moment invites it, glancingly, like an old friend would. never list them, never explain one, never force it when nothing's calling for it.`;
}
