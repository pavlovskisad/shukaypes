// One-shot cleanup that runs at boot to strip transcript-style
// prefixes ("user:", "assistant:", "human:", "ai:") from any
// already-stored companion_state.memoryNotes rows.
//
// Why: PR #158 added a regex filter inside maybeUpdateMemory so newly
// generated notes never include those prefixes. But existing rows
// written before that PR may carry them, and those rows poison the
// active chat's system prompt — the model picks up the transcript
// pattern and starts fabricating fake "User: ..." continuations at
// the tail of its replies (the iOS PWA bug observed 2026-05-02).
// This cleanup retrofits the same filter to historical data.
//
// Idempotent: rows that don't match the prefix pattern are unchanged.
// Safe to run on every boot — it's one SELECT + N UPDATEs (only for
// the rows that actually need rewriting), where N is typically < 5.

import type { FastifyBaseLogger } from 'fastify';
import { eq, isNotNull, ne, and } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

const PREFIX_LINE_RE = /^\s*(user|assistant|human|ai)\s*:/i;

function stripPrefixLines(notes: string): string {
  return notes
    .split('\n')
    .filter((line) => !PREFIX_LINE_RE.test(line))
    .join('\n')
    .trim();
}

export async function runMemoryCleanupOnce(log: FastifyBaseLogger): Promise<void> {
  try {
    const rows = await db
      .select({
        userId: schema.companionState.userId,
        memoryNotes: schema.companionState.memoryNotes,
      })
      .from(schema.companionState)
      .where(
        and(
          isNotNull(schema.companionState.memoryNotes),
          ne(schema.companionState.memoryNotes, ''),
        ),
      );
    let touched = 0;
    for (const row of rows) {
      if (!row.memoryNotes) continue;
      const cleaned = stripPrefixLines(row.memoryNotes);
      if (cleaned === row.memoryNotes) continue;
      await db
        .update(schema.companionState)
        .set({ memoryNotes: cleaned })
        .where(eq(schema.companionState.userId, row.userId));
      touched += 1;
    }
    if (touched > 0) {
      log.info({ kind: 'memory_cleanup', touched }, 'stripped transcript prefixes from memory notes');
    }
  } catch (err) {
    // Don't block boot on a cleanup pass — log and move on.
    log.error({ err }, 'memory cleanup pass failed');
  }
}
