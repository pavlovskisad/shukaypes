// Wikipedia's public REST summary endpoint, for the "read more" under a
// landmark's story.
//
// Called straight from the browser: the endpoint is anonymous, CORS-open
// and cached by Wikimedia, so proxying it through our API would add a hop
// and a rate limit for nothing.
//
// Fetched LAZILY, on the first expand of a given landmark. Most
// landmarks the walker glances at and moves on from, so prefetching
// would spend a Wikipedia request per stop for text nobody opens.
//
// Shared by the long-press sniff bubble and the stops on a planned walk
// — both surface the same kyiv_lore rows and so both want the same
// article behind them.

export const READ_MORE_MAX_CHARS = 600;

export async function fetchWikipediaExtract(
  lang: string,
  title: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { extract?: string };
    return json.extract ?? null;
  } catch {
    return null;
  }
}

// The extract, trimmed to what fits in a bubble on a phone.
export function clampExtract(text: string): string {
  return text.length > READ_MORE_MAX_CHARS
    ? text.slice(0, READ_MORE_MAX_CHARS).trimEnd() + '…'
    : text;
}
