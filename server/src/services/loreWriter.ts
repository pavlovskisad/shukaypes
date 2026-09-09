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

import { nameTokens } from './loreMatch.js';

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

// Where two strings first differ once letter case is set aside — for
// the log line on a refused answer, so the shape of what the model
// changed (a dash, an apostrophe, a dropped word) can be read rather
// than guessed. A short window either side, marked with ⟨ ⟩.
export function firstNonCaseDiff(before: string, after: string, window = 18): string {
  const a = before.toLocaleLowerCase('uk');
  const b = after.toLocaleLowerCase('uk');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const cut = (s: string) =>
    `${i > window ? '…' : ''}${s.slice(Math.max(0, i - window), i)}⟨${s.slice(i, i + window)}⟩`;
  return `${cut(before)}  vs  ${cut(after)}`;
}

// What the case pass says when it asks again after a refusal. The first
// answer is quoted back so the model can see what it changed.
export function caseRetryPrompt(name: string, text: string, refused: string): string {
  return `place: ${name}\n\ntext:\n${text}\n\nyour previous answer changed more than letter case (it read: ${refused}). return the text above again, changing ONLY the case of letters — every other character, space and punctuation mark identical.`;
}

// ---- titles -----------------------------------------------------------
//
// Most memorial plaques in OSM are named for the person on them, and
// as a bubble title "Лесь Курбас" reads as if the man were standing
// there. The title phase asks a small model what the object IS, with
// the relation taken from the plaque's inscription where there is one,
// and refuses any answer that lost the person's name on the way.

export const TITLE_SYSTEM = `you write map titles for landmarks in Kyiv. a landmark comes with its OSM name, what kind of object it is, and what is known about it. write the short title a map label should carry: what the object is and, for a memorial, its relation to the person — so the walker knows they are looking at a house, a plaque or a statue, not at the person.

ukrainian. three to eight words. sentence case: first letter capital, the rest as ukrainian orthography has it. no trailing full stop. the person's name must appear, in whatever case the phrase needs.

patterns:
- a plaque on a house, relation known from the inscription: "Будинок, де жив Лесь Курбас" / "Будинок, де працював …" / "Будинок, де народився …" / "Будинок, де жив і працював …"
- a plaque, relation unknown: "Меморіальна дошка Лесю Курбасу"
- a statue or bust: "Пам'ятник Тарасові Шевченку" / "Погруддя Лесі Українки"
- a memorial to an event or a group: "Пам'ятний знак жертвам Голодомору"

answer null when the OSM name already says what the object is — a church, a museum, a street, a fort, a park, a building with its own name ("Будинок з химерами") — or when you cannot tell what the object is.

answer JSON only: {"title": string | null}`;

export const TITLE_OUTPUT_FORMAT = {
  type: 'json_schema' as const,
  schema: {
    type: 'object',
    properties: { title: { type: ['string', 'null'] } },
    required: ['title'],
    additionalProperties: false,
  },
};

export const TITLE_MAX_CHARS = 72;

// A title is kept only if it still carries the landmark's name — at
// least one meaningful word of the OSM name, by the same 5-letter stem
// the matcher uses, so an inflected surname still counts — and is a
// title rather than a sentence.
export function titleKeepsName(name: string, title: string): boolean {
  const t = title.trim();
  if (!t || t.length > TITLE_MAX_CHARS || /[\n\r]/.test(t)) return false;
  if (t.toLocaleLowerCase('uk') === name.trim().toLocaleLowerCase('uk')) return false;
  if (/[.!?]$/.test(t)) return false;
  const stems = nameTokens(name);
  if (stems.size === 0) return false;
  const inTitle = nameTokens(t);
  for (const s of stems) if (inTitle.has(s)) return true;
  return false;
}

// An artwork's title needs no model: the seed knows the row is an
// artwork (category) and OSM usually says which kind (artwork_type),
// so "BB King" becomes «Мурал «BB King»» from facts alone — nothing
// to hallucinate, nothing to refuse. Without a kind the label is
// "Стріт-арт", which is what the walker is looking at nine times out
// of ten when a Kyiv wall has a name.
//
// Returns null when the name already says what it is ("Мурал
// Караваєву", "Графіті", "Вуличне мистецтво"), or when the result
// would run past the title cap.
const ARTWORK_LABELS: Record<string, string> = {
  mural: 'Мурал',
  graffiti: 'Графіті',
  sculpture: 'Скульптура',
  statue: 'Статуя',
  installation: 'Інсталяція',
  mosaic: 'Мозаїка',
  relief: 'Барельєф',
  bust: 'Погруддя',
  painting: 'Розпис',
};
const ARTWORK_DEFAULT_LABEL = 'Стріт-арт';
// Stems that mean the name is already a label. "арт" alone would match
// "Карта", hence the letter guard.
const SAYS_WHAT_IT_IS =
  /(?<!\p{L})(мурал|графіт|скульптур|статуя|статуї|інсталяц|мозаї|барельєф|погрудд|панно|розпис|живопис|мистецтв|арт-|арт(?!\p{L})|стріт|пам['’]ятник|монумент|фонтан|композиці)/iu;

export function artworkTitle(name: string, kind: string | null | undefined): string | null {
  const core = name.trim().replace(/^["'«“„]+|["'»”“]+$/g, '').trim();
  if (!core) return null;
  if (SAYS_WHAT_IT_IS.test(core)) return null;
  const type = kind?.startsWith('artwork:') ? kind.slice('artwork:'.length) : null;
  const label = (type && ARTWORK_LABELS[type]) || ARTWORK_DEFAULT_LABEL;
  const title = `${label} «${core}»`;
  return title.length > TITLE_MAX_CHARS ? null : title;
}

export function parseTitle(text: string): string | null | undefined {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as { title?: unknown };
    if (obj.title === null) return null;
    return typeof obj.title === 'string' ? obj.title : undefined;
  } catch {
    return undefined;
  }
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
