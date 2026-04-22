// Lost-dog parser. Takes raw free-form text from a Telegram/OLX/FB post and
// returns a structured ParsedDog. Uses Haiku 4.5 — fast, cheap (~$0.001/call),
// plenty capable at extraction. We ask the model to also *infer* lat/lng from
// Kyiv landmarks in the post so we don't need to wire a paid geocoding API
// just to ship Slice 2. This is "good enough" for a 500–1000m search zone.
//
// The prompt includes a district/landmark coordinate table so coordinates
// don't drift outside Kyiv. Any text the model can't geolocate → the city-
// center fallback, with parseConfidence dropped accordingly.

import { anthropic } from '../services/anthropic.js';
import type { ParsedDog, Urgency } from './types.js';

const PARSER_MODEL = 'claude-haiku-4-5';

// Kyiv reference grid. Not exhaustive — the model extrapolates from nearby
// landmarks when the exact street isn't here. Coordinates are the same ones
// used by seed-dogs.ts so behavior stays consistent between seeds and real
// parsed reports.
const KYIV_GEO_HINTS = `KYIV GEO HINTS (lat, lng — use the closest match, or interpolate between two nearby ones)
right bank / центр:
  Maidan / Хрещатик: 50.4503, 30.5234
  Palats Sportu / Бессарабка: 50.4360, 30.5212
  Podil / Kontraktova / Поділ: 50.4612, 30.5172
  Pechersk / Печерськ: 50.4363, 30.5421
  Arsenalna / Арсенальна: 50.4442, 30.5459
  Lva Tolstoho / Толстого: 50.4407, 30.5176
  Olimpiiska / Олімпійська: 50.4320, 30.5217
right bank / north:
  Obolon / Оболонь / набережна: 50.5094, 30.4981
  Heroiv Dnipra / Героїв Дніпра: 50.5225, 30.4988
  Minska / Мінська: 50.5126, 30.4831
  Pochaina / Почайна: 50.4869, 30.4975
  Nyvky / Нивки: 50.4603, 30.4022
  Vynohradar / Виноградар: 50.4829, 30.4102
  Pushcha-Vodytsia / Пуща-Водиця: 50.5342, 30.3634
right bank / west / south:
  Sviatoshyn / Святошин: 50.4576, 30.3739
  Solomianka / Солом'янка: 50.4365, 30.4608
  KPI / Політехнічний: 50.4480, 30.4577
  Shuliavska / Шулявська: 50.4549, 30.4437
  Lukianivska / Лук'янівська: 50.4641, 30.4702
  Demiivka / Деміївка: 50.4045, 30.5197
  Holosiivskyi park / Голосіївський парк: 50.3806, 30.4894
  VDNH / ВДНГ: 50.3845, 30.4758
  Teremky / Теремки: 50.3678, 30.4601
  Vasylkivska / Васильківська: 50.3938, 30.4825
left bank:
  Livoberezhna / Лівобережна: 50.4520, 30.5985
  Darnytsia / Дарниця: 50.4361, 30.6377
  Troieshchyna / Троєщина: 50.5167, 30.6083
  Lisova / Лісова: 50.4649, 30.6495
  Chernihivska / Чернігівська: 50.4484, 30.6191
  Pozniaky / Позняки: 50.4026, 30.6366
  Kharkivskyi / Харківський: 50.4083, 30.6605
  Osokorky / Осокорки: 50.4009, 30.6143
  Vyrlytsia / Вирлиця: 50.4220, 30.6513
  Boryspilska / Бориспільська: 50.3992, 30.6489
  Hydropark / Гідропарк: 50.4461, 30.5736
city-center fallback (use only if nothing else matches): 50.4501, 30.5234`;

const OUTPUT_SCHEMA = `OUTPUT: a single JSON object with these fields, no prose, no markdown fence:
  {
    "name": string            // dog's name, or a short descriptor if unnamed ("чорний пес без нашийника")
    "breed": string           // lowercase. ukrainian OR english is fine — "двортер'єр", "mixed", "jack russell"
    "emoji": string           // one emoji that fits — default 🐕. use 🐺 for husky/malamute, 🐶 for small/cute, 🐕‍🦺 for shepherd/working dog, 🦊 for shiba, 🦮 for guide/lab
    "lastSeenLat": number     // decimal degrees, must be inside Kyiv (49.9..50.6, 30.2..30.9)
    "lastSeenLng": number
    "lastSeenDescription": string   // 1 short english sentence about where and how seen — for the companion to quote. keep under 140 chars. no phone numbers, no personal contact info.
    "lastSeenAt": string      // ISO8601. if post gives a date use that. if it says "today/сьогодні/сегодня" use NOW. if vague ("this week"), use NOW minus 2 days.
    "urgency": "urgent" | "medium" | "resolved" | "rehoming"
    "searchZoneRadiusM": number   // 500..1500. urgent=500-700, medium=600-900, older leads=900-1500
    "rewardPoints": number    // 100 default, 200 if urgent or explicit reward mentioned
    "photoUrl": string | null // if an image URL is present in the post, else null
    "parseConfidence": number // 0..1 — your honest confidence in this extraction
    "parseNotes": string      // 1 sentence, english, on what was ambiguous. "" if clean.
  }

URGENCY RULES
- "rehoming" when: the post is OFFERING a dog for adoption / giveaway / to a new home — someone wants a new family for a dog they have, not reporting one missing. Key signals: "шукає дім", "шукає родину", "в добрі руки", "віддам / віддаю / віддамо", "роздаю / роздаємо", "в дар", "безкоштовно собаку", "отдам", "раздам", "в хорошие руки", "pristroi / пристрій". These posts must be flagged as rehoming no matter how urgent the title sounds — "ТЕРМІНОВО шукає дім" is still rehoming, not lost. NEVER use "rehoming" for a post that describes a dog that went missing or a stray that was found.
- "urgent" when: nursing mother, puppy, needs meds, disabled, last seen <24h, cold/rain/dangerous area, child's dog, reward offered. Only apply AFTER ruling out rehoming.
- "resolved" when: the post is marked found / знайшли / повернули / нашли (and the original report was about a lost dog).
- "medium" otherwise.

STRICTNESS
- never invent a name if the post doesn't give one. use a descriptor.
- never invent a breed. if unclear → "mixed" or "unknown".
- never fabricate dates. if nothing fits, use NOW and say so in parseNotes.
- never place coordinates outside Kyiv. if the post is about another city, still emit JSON but set urgency to "resolved", confidence 0, and explain in parseNotes.
- strip phone numbers, full names, car plates, telegram @handles from lastSeenDescription.`;

const FEW_SHOT = `EXAMPLES

INPUT:
Пропав пес! Бусинка, маленька рудa дворняга, нашийник червоний. Вчора ввечері біля Контрактової вирвалась з рук. Дуже боїться людей, ховається у під'їздах. Нагорода 2000 грн. Телефон 067-555-1234

OUTPUT:
{"name":"Бусинка","breed":"mixed / дворняга","emoji":"🐕","lastSeenLat":50.4612,"lastSeenLng":30.5172,"lastSeenDescription":"small tan mix, red collar, slipped leash near Kontraktova yesterday evening, scared of strangers","lastSeenAt":"{{NOW_MINUS_1D}}","urgency":"urgent","searchZoneRadiusM":600,"rewardPoints":200,"photoUrl":null,"parseConfidence":0.9,"parseNotes":""}

INPUT:
Lost dog in Troieshchyna area! Lora, yellow labrador, ~4yo, no collar, answers to name. Last seen near the river embankment 3 days ago. Please call if you see her.

OUTPUT:
{"name":"Лора","breed":"labrador","emoji":"🦮","lastSeenLat":50.5167,"lastSeenLng":30.6083,"lastSeenDescription":"yellow lab, ~4yo, no collar, answers to name, near Troieshchyna river embankment 3 days ago","lastSeenAt":"{{NOW_MINUS_3D}}","urgency":"medium","searchZoneRadiusM":800,"rewardPoints":100,"photoUrl":null,"parseConfidence":0.85,"parseNotes":""}

INPUT:
ЗНАЙШЛИ! дякуємо всім, Арчі вдома 🙏

OUTPUT:
{"name":"Арчі","breed":"unknown","emoji":"🐕","lastSeenLat":50.4501,"lastSeenLng":30.5234,"lastSeenDescription":"reported as found and reunited with family","lastSeenAt":"{{NOW}}","urgency":"resolved","searchZoneRadiusM":500,"rewardPoints":0,"photoUrl":null,"parseConfidence":0.4,"parseNotes":"post is a resolution notice, no last-seen data — coordinates fallback to city center"}

INPUT:
Цуценя хлопчик ТЕРМІНОВО шукає дім! 3 місяці, здоровий, ігривий, привчений до повідця. Віддамо в добрі руки, бажано в приватний будинок.

OUTPUT:
{"name":"цуценя хлопчик","breed":"mixed","emoji":"🐶","lastSeenLat":50.4501,"lastSeenLng":30.5234,"lastSeenDescription":"healthy 3-month puppy being offered for adoption, not lost","lastSeenAt":"{{NOW}}","urgency":"rehoming","searchZoneRadiusM":500,"rewardPoints":0,"photoUrl":null,"parseConfidence":0.95,"parseNotes":"rehoming / adoption post — 'шукає дім' and 'віддамо в добрі руки' are unambiguous offer-for-adoption phrases. the word ТЕРМІНОВО does not make this a lost dog."}`;

function buildSystemPrompt(): string {
  return [
    'You are a strict JSON extractor for lost-dog posts in Kyiv, Ukraine. You emit exactly one JSON object per input, no prose around it, no markdown fence. If the input has nothing dog-related, still emit valid JSON with parseConfidence 0 and a parseNotes explanation.',
    '',
    KYIV_GEO_HINTS,
    '',
    OUTPUT_SCHEMA,
    '',
    FEW_SHOT,
  ].join('\n');
}

function substituteNow(text: string): string {
  const now = Date.now();
  return text
    .replaceAll('{{NOW}}', new Date(now).toISOString())
    .replaceAll('{{NOW_MINUS_1D}}', new Date(now - 1 * 86400000).toISOString())
    .replaceAll('{{NOW_MINUS_3D}}', new Date(now - 3 * 86400000).toISOString());
}

function isInsideKyiv(lat: number, lng: number): boolean {
  return lat > 49.9 && lat < 50.6 && lng > 30.2 && lng < 30.9;
}

function clampRadius(r: unknown): number {
  const n = typeof r === 'number' ? r : 500;
  if (n < 300) return 300;
  if (n > 2000) return 2000;
  return Math.round(n);
}

function normalizeUrgency(u: unknown): Urgency {
  if (u === 'urgent' || u === 'resolved' || u === 'rehoming') return u;
  return 'medium';
}

function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }
  return trimmed;
}

export interface ParseDogPostInput {
  text: string;
  photoUrl?: string | null;
  nowIso?: string; // for tests; defaults to Date.now()
}

export async function parseDogPost(input: ParseDogPostInput): Promise<ParsedDog> {
  const systemText = substituteNow(buildSystemPrompt());
  const resp = await anthropic().messages.create({
    model: PARSER_MODEL,
    max_tokens: 600,
    system: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: `INPUT:\n${input.text.slice(0, 4000)}\n\nOUTPUT:`,
      },
    ],
  });

  const firstText = resp.content.find((b) => b.type === 'text');
  if (!firstText || firstText.type !== 'text') throw new Error('parser returned no text block');
  const jsonText = stripJsonFence(firstText.text);

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(jsonText) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`parser returned invalid JSON: ${(err as Error).message} — text was: ${firstText.text.slice(0, 200)}`);
  }

  const lat = typeof raw.lastSeenLat === 'number' ? raw.lastSeenLat : 50.4501;
  const lng = typeof raw.lastSeenLng === 'number' ? raw.lastSeenLng : 30.5234;
  const safeLat = isInsideKyiv(lat, lng) ? lat : 50.4501;
  const safeLng = isInsideKyiv(lat, lng) ? lng : 30.5234;
  const confidence = typeof raw.parseConfidence === 'number' ? Math.max(0, Math.min(1, raw.parseConfidence)) : 0.5;
  const degradedConfidence = isInsideKyiv(lat, lng) ? confidence : Math.min(confidence, 0.2);

  const lastSeenAtRaw = typeof raw.lastSeenAt === 'string' ? raw.lastSeenAt : new Date().toISOString();
  const lastSeenAt = isNaN(new Date(lastSeenAtRaw).getTime()) ? new Date().toISOString() : lastSeenAtRaw;

  return {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 80) : 'безіменний',
    breed: typeof raw.breed === 'string' && raw.breed.trim() ? raw.breed.trim().slice(0, 80) : 'unknown',
    emoji: typeof raw.emoji === 'string' && raw.emoji.trim() ? raw.emoji.trim().slice(0, 8) : '🐕',
    lastSeenLat: safeLat,
    lastSeenLng: safeLng,
    lastSeenDescription:
      typeof raw.lastSeenDescription === 'string' ? raw.lastSeenDescription.trim().slice(0, 280) : '',
    lastSeenAt,
    urgency: normalizeUrgency(raw.urgency),
    searchZoneRadiusM: clampRadius(raw.searchZoneRadiusM),
    rewardPoints: typeof raw.rewardPoints === 'number' ? Math.max(0, Math.round(raw.rewardPoints)) : 100,
    photoUrl: input.photoUrl ?? (typeof raw.photoUrl === 'string' ? raw.photoUrl : null),
    parseConfidence: degradedConfidence,
    parseNotes: typeof raw.parseNotes === 'string' ? raw.parseNotes.slice(0, 400) : '',
  };
}
