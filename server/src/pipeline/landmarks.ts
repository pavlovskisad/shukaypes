// Landmark coords used by the OLX parser as fall-throughs for posts
// that don't mention a specific street. The parser's system prompt
// lists these so the LLM picks the closest match — that gives us
// "good enough" geocoding without a paid API, but ten posts that all
// say "near Maidan" all land on the exact same lat/lng and stack as
// one 9-pet cluster on the map.
//
// This module is the structured copy of that prompt list. Upsert
// detects an exact landmark match on the parsed coord and applies a
// deterministic ~80 m jitter so the pin lands inside a soft disc
// around the landmark instead of on the pixel itself. Seeded by the
// dog's id so re-upserts don't keep moving the same dog around.

export interface Landmark {
  name: string;
  lat: number;
  lng: number;
}

export const LANDMARKS: Landmark[] = [
  // right bank / центр
  { name: 'Maidan / Хрещатик',           lat: 50.4503, lng: 30.5234 },
  { name: 'Palats Sportu / Бессарабка',  lat: 50.4360, lng: 30.5212 },
  { name: 'Podil / Kontraktova / Поділ', lat: 50.4612, lng: 30.5172 },
  { name: 'Pechersk / Печерськ',         lat: 50.4363, lng: 30.5421 },
  { name: 'Arsenalna / Арсенальна',      lat: 50.4442, lng: 30.5459 },
  { name: 'Lva Tolstoho / Толстого',     lat: 50.4407, lng: 30.5176 },
  { name: 'Olimpiiska / Олімпійська',    lat: 50.4320, lng: 30.5217 },
  // right bank / north
  { name: 'Obolon / Оболонь',            lat: 50.5094, lng: 30.4981 },
  { name: 'Heroiv Dnipra / Героїв Дніпра', lat: 50.5225, lng: 30.4988 },
  { name: 'Minska / Мінська',            lat: 50.5126, lng: 30.4831 },
  { name: 'Pochaina / Почайна',          lat: 50.4869, lng: 30.4975 },
  { name: 'Nyvky / Нивки',               lat: 50.4603, lng: 30.4022 },
  { name: 'Vynohradar / Виноградар',     lat: 50.4829, lng: 30.4102 },
  { name: 'Pushcha-Vodytsia / Пуща-Водиця', lat: 50.5342, lng: 30.3634 },
  // right bank / west / south
  { name: 'Sviatoshyn / Святошин',       lat: 50.4576, lng: 30.3739 },
  { name: "Solomianka / Солом'янка",     lat: 50.4365, lng: 30.4608 },
  { name: 'KPI / Політехнічний',         lat: 50.4480, lng: 30.4577 },
  { name: 'Shuliavska / Шулявська',      lat: 50.4549, lng: 30.4437 },
  { name: "Lukianivska / Лук'янівська",  lat: 50.4641, lng: 30.4702 },
  { name: 'Demiivka / Деміївка',         lat: 50.4045, lng: 30.5197 },
  { name: 'Holosiivskyi park',           lat: 50.3806, lng: 30.4894 },
  { name: 'VDNH / ВДНГ',                 lat: 50.3845, lng: 30.4758 },
  { name: 'Teremky / Теремки',           lat: 50.3678, lng: 30.4601 },
  { name: 'Vasylkivska / Васильківська', lat: 50.3938, lng: 30.4825 },
  // left bank
  { name: 'Livoberezhna / Лівобережна',  lat: 50.4520, lng: 30.5985 },
  { name: 'Darnytsia / Дарниця',         lat: 50.4361, lng: 30.6377 },
  { name: 'Troieshchyna / Троєщина',     lat: 50.5167, lng: 30.6083 },
  { name: 'Lisova / Лісова',             lat: 50.4649, lng: 30.6495 },
  { name: 'Chernihivska / Чернігівська', lat: 50.4484, lng: 30.6191 },
  { name: 'Pozniaky / Позняки',          lat: 50.4026, lng: 30.6366 },
  { name: 'Kharkivskyi / Харківський',   lat: 50.4083, lng: 30.6605 },
  { name: 'Osokorky / Осокорки',         lat: 50.4009, lng: 30.6143 },
  { name: 'Vyrlytsia / Вирлиця',         lat: 50.4220, lng: 30.6513 },
  { name: 'Boryspilska / Бориспільська', lat: 50.3992, lng: 30.6489 },
  { name: 'Hydropark / Гідропарк',       lat: 50.4461, lng: 30.5736 },
];

// Match radius for "this coord is a landmark." Loose enough to catch
// small LLM precision drift (Sonnet/Haiku sometimes emit 50.4502
// instead of the listed 50.4503) but tight enough that a real "I
// found her at Хрещатик 14" doesn't accidentally get bucketed as a
// fallback. 20 m is well below any meaningful Kyiv geography.
const MATCH_RADIUS_M = 20;

function metersBetween(a: Landmark, lat: number, lng: number): number {
  const dLat = (lat - a.lat) * 111320;
  const dLng = (lng - a.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

export function findLandmark(lat: number, lng: number): Landmark | null {
  for (const l of LANDMARKS) {
    if (metersBetween(l, lat, lng) < MATCH_RADIUS_M) return l;
  }
  return null;
}

// FNV-1a hash → uniform [0, 1) sampler. Deterministic for a given
// seed string so a re-upsert keeps a dog at the same jittered point.
function rngFromSeed(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let s = h >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

// Sample a point inside a disc of radius `radiusM` around (lat, lng).
// sqrt(u) for uniform areal density (otherwise points clump at the
// centre). Deterministic from the seed.
export function jitterAround(
  lat: number,
  lng: number,
  seed: string,
  radiusM = 120,
): { lat: number; lng: number } {
  const r = rngFromSeed(seed);
  const theta = r() * 2 * Math.PI;
  const rM = Math.sqrt(r()) * radiusM;
  const dLat = (rM * Math.cos(theta)) / 111320;
  const dLng =
    (rM * Math.sin(theta)) / (111320 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lng: lng + dLng };
}
