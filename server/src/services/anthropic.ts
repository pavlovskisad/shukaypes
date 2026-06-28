// Single shared Anthropic client + shared model constants.
// Two-tier routing:
//   active  — claude-opus-4-8, user-initiated. Opus carries the dog's
//             wit + comic timing noticeably better than Sonnet; active
//             turns are the ones the human actually reads and talks
//             back to, so the personality ceiling is worth the higher
//             per-message cost here. (Was claude-sonnet-4-6.)
//   ambient — claude-haiku-4-5, server-scheduled, ~60% of calls,
//             latency-sensitive 6-word bubbles, stays cheap.

import Anthropic from '@anthropic-ai/sdk';

export const ACTIVE_MODEL = 'claude-opus-4-8';
export const AMBIENT_MODEL = 'claude-haiku-4-5';

let client: Anthropic | null = null;
export function anthropic(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
    client = new Anthropic({ apiKey });
  }
  return client;
}
