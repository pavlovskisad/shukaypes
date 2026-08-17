// How much of an ad we are willing to keep.
//
// Ad bodies are unbounded text written by strangers. Almost all are a
// few hundred characters; the tail is people pasting a whole veterinary
// history, or a page of hashtags, or the same paragraph in three
// languages. Storing that whole tail costs database and, more to the
// point, costs the walker who eventually reads it on a phone.
//
// 8KB is roughly four A4 pages of Cyrillic — far past any real lost-pet
// post, and small enough that a single ad can never be a payload
// problem. Truncation is logged rather than silent: if it starts firing
// often, the assumption above is wrong and somebody should know.
//
// Kept in its own module because three sources (OLX, Telegram, Facebook)
// need the same rule, and a cap that differs per source would make the
// stored corpus inconsistent for parse-accuracy scoring later.

export const MAX_BODY_CHARS = 8_000;

const TRUNCATION_MARKER = '\n…[truncated]';

export function capBody(text: string | null | undefined): string | null {
  if (!text) return null;
  if (text.length <= MAX_BODY_CHARS) return text;
  // eslint-disable-next-line no-console
  console.warn(`[ad-body] truncated ${text.length} chars to ${MAX_BODY_CHARS}`);
  return text.slice(0, MAX_BODY_CHARS - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
}
