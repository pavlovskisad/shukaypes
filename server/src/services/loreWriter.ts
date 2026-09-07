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

// The shape the API is asked to constrain the answer to (structured
// outputs, `output_config.format`). On the second production pass three
// rows answered with the research blob echoed back under a heading and
// no JSON at all — the same three on every retry — and no parser
// recovers an answer that was never given. Assistant prefill, the older
// way to force the opening brace, is rejected with a 400 on the 4.6+
// models; the schema is the supported way. parseWriter stays as the
// belt to this braces.
export const WRITER_OUTPUT_FORMAT = {
  type: 'json_schema' as const,
  schema: {
    type: 'object',
    properties: {
      story: { type: 'string' },
      detail: { type: 'string' },
    },
    required: ['story', 'detail'],
    additionalProperties: false,
  },
};

// Strip DECORATIVE outer quotes — the model wrapping its whole answer in
// «…» — and only those: a field that opens with a quoted word and ends
// in a full stop («"Овод" — це машина…») keeps its opening quote, or
// the first word loses its mark and reads as a typo. Both ends have to
// be quotes for either to go.
const OPENS_QUOTED = /^["“'«]/;
const CLOSES_QUOTED = /["”'»]$/;
const clean = (s: string): string => {
  const t = s.trim();
  if (OPENS_QUOTED.test(t) && CLOSES_QUOTED.test(t)) {
    return t.replace(/^["“'«]+|["”'»]+$/g, '').trim();
  }
  return t;
};

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

// ---- letter case ----------------------------------------------------
//
// The first production run's details came back with proper names in
// lowercase — "михайло старицький", "павло вірський" — because the
// writer prompt said "lowercase, proper nouns capitalised normally" and
// the model heard the first half. The dog's voice IS lowercase
// sentences; names are not part of the voice, and a person's name in
// lowercase reads as a typo on a plaque about them. The case pass asks
// a small model to fix only that, and the guard below refuses any
// answer that changed anything else.

export const CASE_SYSTEM = `you fix letter case in short ukrainian texts written in a lowercase "dog voice". return the SAME text with only letter case changed.

capitalise proper names as ukrainian orthography does:
- people: first names, patronymics, surnames (Михайло Петрович Старицький, Леся Українка)
- places: cities, rivers, districts, hills (Київ, Дніпро, Поділ, Володимирська гірка)
- the proper part of streets, squares, parks (вулиця Хрещатик, Майдан Незалежності, парк Шевченка)
- specific institutions, monuments, churches used as names (Києво-Печерська лавра, Софійський собор, Національний музей історії України)
- religious names (Бог, Богородиця, Микола Чудотворець)
- names inside quotes keep their own case («Малютка», «Овод»)

keep lowercase:
- the start of a sentence — that is the voice, not an error — unless the sentence starts with a proper name
- adjectives and nouns derived from names (київський, шевченківський, українець)
- nationalities, languages, months, weekdays, titles and ranks (гетьман, князь, професор)

change NOTHING else: no words added, removed, reordered or respelled; punctuation and spacing identical. the name of the place the text is about is given for reference; if a name in the text is already correct, leave it.`;

export const CASE_OUTPUT_FORMAT = {
  type: 'json_schema' as const,
  schema: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
    additionalProperties: false,
  },
};

// True when the two strings differ in letter case and in nothing else.
// The whole point of the case pass is that it cannot rewrite; anything
// that fails this is thrown away, however good it looks.
export function onlyCaseDiffers(before: string, after: string): boolean {
  if (before === after) return false;
  return before.toLocaleLowerCase('uk') === after.toLocaleLowerCase('uk');
}

export function parseCased(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as { text?: unknown };
    return typeof obj.text === 'string' ? obj.text : null;
  } catch {
    return null;
  }
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
