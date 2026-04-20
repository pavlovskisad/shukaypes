// Single shared Anthropic client + shared model constants.
// Two-tier routing:
//   active  — claude-sonnet-4-6, user-initiated, full web-search, higher quality
//   ambient — claude-haiku-4-5, server-scheduled, ~60% of calls, latency-sensitive
// Locked to the plan doc — user picked these model IDs explicitly.

import Anthropic from '@anthropic-ai/sdk';

export const ACTIVE_MODEL = 'claude-sonnet-4-6';
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
