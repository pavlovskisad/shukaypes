// CAN THE MODEL FIND A PLACE WHERE A REGEX CANNOT? A bounded probe.
//
// THE QUESTION THIS SETTLES. 80 of 176 active pets sit on the
// fall-through coordinate and are filtered off the map. A substring
// matcher run over their stored ad text found a gazetteer place in 13 of
// them and nothing in the other 67 — and that 13 barely moved when the
// matcher learned inflection (6 → 12) or abbreviations (12 → 13).
//
// But a matcher scanning prose for literal names is not the design being
// argued about. The proposal is: the MODEL reads the ad and says where
// the animal was lost, and that phrase is resolved against the
// gazetteer. A model can read «третій під'їзд біля школи №14 на
// Троєщині» and answer «Троєщина»; a regex looking for gazetteer entries
// cannot. So the 67 is evidence about my matcher, not about the ads, and
// the two must not be confused.
//
// This asks the model directly, on exactly those ads.
//
// BOUNDED, because it spends the owner's Anthropic credit. --sample
// defaults to 20 and is capped; there is no loop that grows. Haiku, the
// same model the parser already uses, and one short question per ad.
//
// IT ANSWERS THE WHOLE LOOP, not half of it: the model's phrase is then
// run through resolvePlace() against the real gazetteer, because "the
// model found a place name" and "we can put a pin on it" are different
// claims and only the second one helps a walker.
//
// WHAT IT PRINTS. The extracted place phrase and whether it resolved. A
// place name is not a contact, and no ad body is printed.
//
// Usage:
//   fly ssh console -a shukajpes-api -C "node dist/db/probe-location-text.js"
//   fly ssh console -a shukajpes-api -C "node dist/db/probe-location-text.js --sample=30"

import 'dotenv/config';
import { eq, isNotNull } from 'drizzle-orm';
import { pathToFileURL } from 'url';
import { db, schema, pg } from './index.js';
import { anthropic } from '../services/anthropic.js';
import { resolvePlace, type GazetteerPlace } from '../pipeline/resolvePlace.js';
import { detectOtherCity } from '../pipeline/outOfArea.js';

const MODEL = 'claude-haiku-4-5';
const MAX_SAMPLE = 40;
const DEFAULT_SAMPLE = 20;

const FALLBACK = { lat: 50.4501, lng: 30.5234 };

// One question, no room to elaborate. The parser's own prompt asks for a
// coordinate, which is a geography exam; this asks for a transcription,
// which is the thing models are reliable at.
// THE FIRST VERSION SAID «копіюй як написано» AND THE MODEL TRANSLATED
// ANYWAY. Of 20 ads it found a place in 12 and resolved 0, because the
// answers came back «Sofiivska square», «Petrovsky district»,
// «Подольском районе» — English and Russian, against a gazetteer that
// holds Ukrainian. «Подольском районе» IS in the table, as «Подільський
// район». The instruction was there; it was not emphatic enough, and a
// polite constraint is not a constraint.
//
// So: say it three ways, show the failure as an example, and forbid the
// alphabet rather than the behaviour.
//
// The second field is the finding that came with it. Several of those
// ads were «районе центрального рынка» (Kharkiv), «районі Левади в
// Красилові» (Khmelnytskyi oblast), «Хотянівці» (a village) — pets that
// are not in Kyiv at all, sitting on the fall-through because the parser
// could not place a Kharkiv address on a Kyiv map. Asking for the city
// separately turns that from something I eyeballed into something
// counted, and it is transcription again rather than judgement.
const SYSTEM = `Ти читаєш оголошення про загублену тварину.

Два питання:
1. Чи сказано в оголошенні, ДЕ тварина загубилася?
2. Чи назване місто або село?

Поверни рівно один рядок JSON:
{"place": "<місце як написано>", "city": "<місто як написано, або null>"}

МОВА ВІДПОВІДІ — МОВА ОГОЛОШЕННЯ. Це найважливіше правило:
- Копіюй символ у символ, тією самою абеткою.
- НІКОЛИ не перекладай на англійську. НІКОЛИ не транслітеруй латиницею.
- Якщо в оголошенні «Подольском районе» — пиши «Подольском районе».
  НЕ «Podolsky district». НЕ «Подільський район».
- Якщо в оголошенні «Софіївська площа» — пиши «Софіївська площа».
  НЕ «Sofiivska square».

Інші правила:
- Місце — це район, вулиця, масив, село, станція метро, орієнтир.
- Якщо місця немає — place: null. Не вгадуй.
- Не пиши "Київ" у place просто тому, що це Київ.
- Нічого, крім цього рядка JSON.`;

function numArg(flag: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (!raw) return fallback;
  const n = Number(raw.split('=')[1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function main() {
  const sample = Math.min(numArg('--sample', DEFAULT_SAMPLE), MAX_SAMPLE);

  const pets = await db
    .select({
      id: schema.lostDogs.id,
      name: schema.lostDogs.name,
      lat: schema.lostDogs.lastSeenLat,
      lng: schema.lostDogs.lastSeenLng,
      desc: schema.lostDogs.lastSeenDescription,
    })
    .from(schema.lostDogs)
    .where(eq(schema.lostDogs.status, 'active'));

  const places: GazetteerPlace[] = await db
    .select({
      name: schema.kyivGazetteer.nameUk,
      lat: schema.kyivGazetteer.lat,
      lng: schema.kyivGazetteer.lng,
      category: schema.kyivGazetteer.category,
      // The alternate-spelling column that has been sitting unread while
      // twelve Russian-spelled Kyiv places were reported as missing.
      aliases: schema.kyivGazetteer.aliases,
    })
    .from(schema.kyivGazetteer);

  const bodies = new Map<string, string>();
  for (const r of await db
    .select({ dogId: schema.scrapeLog.dogId, body: schema.scrapeLog.rawBody })
    .from(schema.scrapeLog)
    .where(isNotNull(schema.scrapeLog.rawBody))) {
    if (r.dogId && !bodies.has(r.dogId)) bodies.set(r.dogId, r.body!);
  }

  if (pets.length === 0 || places.length === 0) {
    console.log('!! READ NOTHING — confirm which database before reading any result.');
    await pg.end();
    return;
  }

  // Exactly the pets the matcher gave up on: invisible, and no gazetteer
  // name found in their text. Those are the ones in dispute.
  const targets = pets
    .filter(
      (p) =>
        Math.abs(p.lat - FALLBACK.lat) < 1e-9 &&
        Math.abs(p.lng - FALLBACK.lng) < 1e-9,
    )
    .filter((p) => {
      const text = `${p.desc ?? ''}\n${bodies.get(p.id) ?? ''}`.trim();
      return text.length > 0 && resolvePlace(text, places) === null;
    });

  console.log(`\ninvisible pets the matcher found no place in: ${targets.length}`);
  console.log(`asking the model about ${Math.min(sample, targets.length)} of them\n`);

  let said = 0;
  let resolved = 0;
  let silent = 0;
  let failed = 0;
  let elsewhere = 0;
  let latin = 0;

  for (const pet of targets.slice(0, sample)) {
    const text = `${pet.desc ?? ''}\n${bodies.get(pet.id) ?? ''}`.trim();
    let phrase: string | null = null;
    let city: string | null = null;
    try {
      const resp = await anthropic().messages.create({
        model: MODEL,
        max_tokens: 120,
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: text.slice(0, 3000) }],
      });
      const out = resp.content.find((b) => b.type === 'text');
      const raw = out && out.type === 'text' ? out.text.trim() : '';
      const json = raw.match(/\{[\s\S]*\}/)?.[0];
      if (json) {
        const parsed = JSON.parse(json);
        phrase = parsed.place ?? null;
        city = parsed.city ?? null;
      }
    } catch (err) {
      failed++;
      console.log(`  !  ${pet.name.padEnd(24)} ${(err as Error).message.slice(0, 50)}`);
      continue;
    }

    if (!phrase) {
      silent++;
      console.log(`  –  ${pet.name.padEnd(24)} model says no place in the ad`);
      continue;
    }

    said++;

    // OUT OF AREA FIRST, because it is not a placement failure. A pet in
    // Kharkiv sitting on the fall-through is the parser correctly
    // declining to put a Kharkiv address on a Kyiv map. Nothing about
    // the gazetteer would or should fix it — the row wants expiring.
    // Judged with detectOtherCity, the same rule the ingest gate uses,
    // so the audit and the gate can never disagree.
    const other = detectOtherCity(`${city ?? ''} ${phrase}`);
    if (other) {
      elsewhere++;
      console.log(`  ⤫  ${pet.name.padEnd(24)} «${phrase.slice(0, 30)}» → ${other.city}, not Kyiv`);
      continue;
    }

    // Did the instruction hold? Latin letters in a Ukrainian ad's place
    // name mean the model translated despite being told three times not
    // to, and that is a prompt failure rather than a gazetteer gap —
    // worth counting separately or the next round misreads it again.
    if (/[A-Za-z]{4,}/.test(phrase)) latin++;

    const hit = resolvePlace(phrase, places);
    if (hit) resolved++;
    console.log(
      `  ${hit ? '✓' : '?'}  ${pet.name.padEnd(24)} «${phrase.slice(0, 34)}»` +
        (hit ? ` → ${hit.name}${hit.marked ? ' [marked]' : ''}` : ' → not in the gazetteer'),
    );
  }

  const asked = Math.min(sample, targets.length);
  const inKyiv = said - elsewhere;
  console.log(`\n  asked:                        ${asked}`);
  console.log(`  model found a place:          ${said}`);
  console.log(`    … but the pet is elsewhere:  ${elsewhere}   ← expire, do not place`);
  console.log(`    … a Kyiv place:              ${inKyiv}`);
  console.log(`       … resolves to a pin:      ${resolved}   ← what wiring would fix`);
  console.log(`       … not in the gazetteer:   ${inKyiv - resolved}   ← a gap in the table`);
  console.log(`  model says the ad has none:   ${silent}   ← fall-through is correct`);
  if (latin > 0) {
    console.log(`\n!! ${latin} answer(s) came back in Latin letters despite the instruction.`);
    console.log('   Those are prompt failures, not gazetteer gaps — do not count them');
    console.log('   as missing places.');
  }
  if (failed > 0) console.log(`  call failed:                  ${failed}  ← not evidence either way`);

  console.log(
    `\n  Three different problems, and only one of them is the gazetteer:` +
      `\n    elsewhere      the parser was right to refuse; the row wants expiring` +
      `\n    not in table   the gazetteer is genuinely missing a place` +
      `\n    no place       the ad does not say, and nothing can fix that` +
      `\n\n✓ read-only. Nothing written.`,
  );
  await pg.end();
}

const isEntry = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isEntry) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
