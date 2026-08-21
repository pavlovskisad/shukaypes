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

const MODEL = 'claude-haiku-4-5';
const MAX_SAMPLE = 40;
const DEFAULT_SAMPLE = 20;

const FALLBACK = { lat: 50.4501, lng: 30.5234 };

// One question, no room to elaborate. The parser's own prompt asks for a
// coordinate, which is a geography exam; this asks for a transcription,
// which is the thing models are reliable at.
const SYSTEM = `Ти читаєш оголошення про загублену тварину з Києва.

Питання одне: чи сказано в оголошенні, ДЕ тварина загубилася?

Поверни рівно один рядок JSON:
{"place": "<місце як написано в оголошенні>"}
або
{"place": null}

Правила:
- Копіюй місце ЯК НАПИСАНО. Не перекладай, не виправляй, не додавай.
- Місце — це район, вулиця, масив, село, станція метро, орієнтир.
- Якщо місця немає — null. Не вгадуй. Не пиши "Київ" просто тому, що це Київ.
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

  for (const pet of targets.slice(0, sample)) {
    const text = `${pet.desc ?? ''}\n${bodies.get(pet.id) ?? ''}`.trim();
    let phrase: string | null = null;
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
      phrase = json ? (JSON.parse(json).place ?? null) : null;
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
    // THE SECOND HALF. A phrase we cannot put on the map is not a pin.
    const hit = resolvePlace(phrase, places);
    if (hit) resolved++;
    console.log(
      `  ${hit ? '✓' : '?'}  ${pet.name.padEnd(24)} «${phrase.slice(0, 34)}»` +
        (hit ? ` → ${hit.name}${hit.marked ? ' [marked]' : ''}` : ' → not in the gazetteer'),
    );
  }

  const asked = Math.min(sample, targets.length);
  console.log(`\n  asked:                       ${asked}`);
  console.log(`  model found a place:         ${said}`);
  console.log(`    … and it resolves to a pin: ${resolved}   ← what would actually be fixed`);
  console.log(`    … named but unresolvable:   ${said - resolved}`);
  console.log(`  model says the ad has none:  ${silent}`);
  if (failed > 0) console.log(`  call failed:                 ${failed}  ← not evidence either way`);

  console.log(
    `\n  The number that matters is the resolving one. A place the model can` +
      `\n  read but the gazetteer cannot find is a gap in the table; a place` +
      `\n  neither can find means the ad genuinely does not say.` +
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
