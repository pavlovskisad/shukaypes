// Reading the writer's answer in enrich-lore.ts.
//
// The model is asked for {"story": …, "detail": …}. Strict JSON first;
// when that fails — 20 of 1155 rows on the first production run, and
// the same rows again on retry, so a property of those inputs rather
// than luck — fall back to cutting the two fields out by their keys. The
// usual culprit is the dog quoting a plaque: a bare `"` inside the prose
// breaks JSON.parse and nothing else.
//
// Pure, and kept out of enrich-lore.ts so enrichLore.check.ts can pin it
// without a DATABASE_URL: importing the script would open the db.

export interface Written {
  story: string;
  detail: string;
}

const clean = (s: string) => s.trim().replace(/^["“'«]+|["”'»]+$/g, '').trim();

// One string field out of the near-JSON WITHOUT parsing it as JSON: from
// the quote after `"key":` to the last quote before the next key (or the
// closing brace).
function extractField(text: string, key: string, otherKeys: string[]): string | null {
  const open = new RegExp(`"${key}"\\s*:\\s*"`).exec(text);
  if (!open) return null;
  const start = open.index + open[0].length;
  let limit = text.lastIndexOf('}');
  if (limit < start) limit = text.length;
  for (const k of otherKeys) {
    const next = new RegExp(`,\\s*"${k}"\\s*:`).exec(text.slice(start));
    if (next) limit = Math.min(limit, start + next.index);
  }
  const segment = text.slice(start, limit);
  const close = segment.lastIndexOf('"');
  if (close <= 0) return null;
  return segment
    .slice(0, close)
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\\\/g, '\\');
}

export function parseWriter(text: string): Written | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const obj = JSON.parse(text.slice(start, end + 1)) as { story?: unknown; detail?: unknown };
      if (typeof obj.story === 'string' && typeof obj.detail === 'string') {
        const story = clean(obj.story);
        const detail = clean(obj.detail);
        if (story && detail) return { story, detail };
      }
    } catch {
      // fall through to the lenient cut
    }
  }
  const story = extractField(text, 'story', ['detail']);
  const detail = extractField(text, 'detail', ['story']);
  if (!story || !detail) return null;
  const s = clean(story);
  const d = clean(detail);
  return s && d ? { story: s, detail: d } : null;
}
