// Fixture check for the writer-output parser in enrich-lore.ts —
// `pnpm --filter @shukajpes/server check:enrich-parse`.
//
// The writer is asked for {"story": …, "detail": …}. On the first
// production run 20 of 1155 answers failed JSON.parse and the same rows
// failed again on retry, which means the shape is a property of those
// inputs, not luck: the dog quoting a plaque puts a bare `"` inside the
// prose. Each case below is a shape the lenient cut has to survive, and
// the last ones are shapes it has to refuse rather than half-parse.

import {
  firstNonCaseDiff,
  onlyCaseDiffers,
  parseCased,
  parseTitle,
  titleKeepsName,
  artworkTitle,
  parseWriter,
  WRITER_OUTPUT_FORMAT,
} from '../services/loreWriter.js';

let failures = 0;
let checks = 0;

function ok(cond: boolean, label: string, detail = ''): void {
  checks++;
  if (cond) return;
  failures++;
  console.error(`✗ ${label}${detail ? `\n    ${detail}` : ''}`);
}

// Clean JSON, as most answers come.
{
  const r = parseWriter('{"story": "*нюхаю* стара брама.", "detail": "лядські ворота стояли тут."}');
  ok(r?.story === '*нюхаю* стара брама.' && r?.detail === 'лядські ворота стояли тут.', 'plain JSON parses');
}

// Prose around the JSON.
{
  const r = parseWriter('ось:\n{"story": "s.", "detail": "d."}\nготово');
  ok(r?.story === 's.' && r?.detail === 'd.', 'JSON inside prose parses');
}

// A bare quote inside the detail — the production failure shape.
{
  const r = parseWriter(
    '{"story": "табличка каже своє.", "detail": "на дошці написано: "тут жив поет" — і більше нічого. *нюхаю стіну* камінь."}',
  );
  ok(
    r?.detail === 'на дошці написано: "тут жив поет" — і більше нічого. *нюхаю стіну* камінь.',
    'a bare quote inside the detail is kept, not fatal',
    r?.detail,
  );
  ok(r?.story === 'табличка каже своє.', 'and the story beside it survives');
}

// Same, with the keys the other way round and an escaped quote too.
{
  const r = parseWriter(
    '{"detail": "він казав \\"ні\\" — і "так" теж.", "story": "*вуха вгору* цитата на камені."}',
  );
  ok(r?.detail === 'він казав "ні" — і "так" теж.', 'escaped and bare quotes both come out as quotes', r?.detail);
  ok(r?.story === '*вуха вгору* цитата на камені.', 'key order does not matter');
}

// Escaped newlines inside a field.
{
  const r = parseWriter('{"story": "s.", "detail": "перший рядок.\\nдругий рядок."}');
  ok(r?.detail === 'перший рядок.\nдругий рядок.', 'escaped newlines are unescaped');
}

// Stray outer quotes the model sometimes adds are stripped.
{
  const r = parseWriter('{"story": "«s.»", "detail": "“d.”"}');
  ok(r?.story === 's.' && r?.detail === 'd.', 'decorative outer quotes are stripped');
}

// A field that OPENS with a quoted word keeps its quote. Production
// wrote «овод" — це самохідний…» for 9П110 before this case existed.
{
  const r = parseWriter('{"story": "s.", "detail": "\\"Овод\\" — це самохідний комплекс."}');
  ok(r?.detail === '"Овод" — це самохідний комплекс.', 'an opening quoted word is not a decorative quote', r?.detail);
}

// The schema the API is asked to constrain the answer to names exactly
// the two fields the parser reads, both required, nothing else allowed.
{
  const s = WRITER_OUTPUT_FORMAT.schema;
  ok(WRITER_OUTPUT_FORMAT.type === 'json_schema', 'output format is a json schema');
  ok(
    Object.keys(s.properties).sort().join() === 'detail,story' &&
      [...s.required].sort().join() === 'detail,story' &&
      s.additionalProperties === false,
    'the schema and the parser agree on the fields',
  );
}

// Refusals: missing field, empty field, no JSON at all.
{
  ok(parseWriter('{"story": "s."}') === null, 'a missing detail is a miss, not a half-row');
  ok(parseWriter('{"story": "", "detail": "d."}') === null, 'an empty story is a miss');
  ok(parseWriter('не можу нічого сказати про це місце.') === null, 'prose with no fields is a miss');
}

// ---------------------------------------------------------------------
// The case pass may change letter case and nothing else.
// ---------------------------------------------------------------------
{
  ok(
    onlyCaseDiffers('тут жив михайло старицький.', 'тут жив Михайло Старицький.'),
    'a pure case change passes',
  );
  ok(!onlyCaseDiffers('тут жив михайло.', 'тут жив михайло.'), 'an unchanged text is not a change');
  ok(
    !onlyCaseDiffers('тут жив михайло старицький.', 'тут жив Михайло Старицький'),
    'a dropped full stop fails the guard',
  );
  ok(
    !onlyCaseDiffers('тут жив михайло.', 'тут мешкав Михайло.'),
    'a reworded answer fails the guard',
  );
  ok(
    !onlyCaseDiffers('«малютка» — ракета.', '«Малютка» – ракета.'),
    'a swapped dash fails the guard even with a good case fix',
  );
  ok(parseCased('{"text": "Київ."}') === 'Київ.', 'the case answer parses');
  ok(parseCased('nope') === null, 'no JSON is a miss');
  ok(
    firstNonCaseDiff('«малютка» — ракета.', '«Малютка» – ракета.').includes('⟨— ракета.⟩'),
    'the refusal log points at the character that changed',
    firstNonCaseDiff('«малютка» — ракета.', '«Малютка» – ракета.'),
  );
}

// ---------------------------------------------------------------------
// A title has to keep the name and be a title.
// ---------------------------------------------------------------------
{
  ok(titleKeepsName('Лесь Курбас', 'Будинок, де працював Лесь Курбас'), 'a house title keeps the name');
  ok(
    titleKeepsName('Крушельницький Мар\'ян Михайлович', 'Будинок, де жив Мар\'ян Крушельницький'),
    'an inflected, reordered name still counts',
  );
  ok(titleKeepsName("Тарас Шевченко", "Пам'ятник Тарасові Шевченку"), 'dative keeps the stem');
  ok(!titleKeepsName('Лесь Курбас', 'Будинок, де працював режисер'), 'a title that lost the name is refused');
  ok(!titleKeepsName('Лесь Курбас', 'лесь курбас'), 'the name back in another case is not a title');
  ok(!titleKeepsName('Лесь Курбас', 'Тут працював Лесь Курбас.'), 'a sentence is not a title');
  ok(parseTitle('{"title": null}') === null, 'null means keep the name');
  ok(parseTitle('{"title": "Погруддя Лесі Українки"}') === 'Погруддя Лесі Українки', 'a title parses');
  ok(parseTitle('nope') === undefined, 'no JSON is a miss, not a null');
}

// ---------------------------------------------------------------------
// An artwork's title comes from its kind, and never from a model.
// ---------------------------------------------------------------------
{
  ok(artworkTitle('BB King', 'artwork:mural') === 'Мурал «BB King»', 'a mural is labelled a mural');
  ok(artworkTitle('Тризуб з набоїв', null) === 'Стріт-арт «Тризуб з набоїв»', 'no kind is street art');
  ok(artworkTitle('Тризуб з набоїв', 'artwork:yes') === 'Стріт-арт «Тризуб з набоїв»', 'an unknown kind is street art');
  ok(artworkTitle('Корова', 'artwork:sculpture') === 'Скульптура «Корова»', 'a sculpture is labelled');
  ok(artworkTitle('"Квіти"', 'artwork:mural') === 'Мурал «Квіти»', 'the name\'s own quotes are not doubled');
  ok(artworkTitle('Мурал Караваєву', 'artwork:mural') === null, 'a name that says mural is kept');
  ok(artworkTitle('Графіті', 'artwork:graffiti') === null, 'a bare label is kept');
  ok(artworkTitle('Вуличне мистецтво', null) === null, 'a name that says art is kept');
  ok(artworkTitle('Арт-об\'єкт "Серце"', null) === null, 'арт- is a label');
  ok(artworkTitle('Карта Києва', 'artwork:mural') === 'Мурал «Карта Києва»', 'арт inside a word is not a label');
  ok(artworkTitle('Не втрачай свою юність дорослішаючи', 'artwork:mural') === 'Мурал «Не втрачай свою юність дорослішаючи»', 'a sentence-name is quoted whole');
}

if (failures > 0) {
  console.error(`\n${failures} of ${checks} checks failed`);
  process.exit(1);
}
console.log(`✓ enrich-parse: ${checks} checks passed`);
