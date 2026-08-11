// Fixture check for the pet identity rule.
// Run with: pnpm --filter @shukajpes/server check:same-pet
//
// Every MUST-NOT-MERGE case below is a real pair that was active in
// production on 11 Aug, and every one of them was considered the same
// pet by the rule this replaces. They are the point of the file: a
// wrong merge overwrites one family's lost pet with another's and the
// losing record is gone, while a missed merge leaves a tidy-up job.
//
// Exits non-zero on failure.

import { isSamePet, isUsableName, breedsCompatible, type PetIdentity } from './samePet.js';

const DAY = 86_400_000;
const T0 = 1_760_000_000_000;

function pet(over: Partial<PetIdentity> = {}): PetIdentity {
  return { name: 'Мурзик', species: 'dog', breed: 'unknown', lastSeenAtMs: T0, ...over };
}

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    failures++;
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ---- MUST NOT MERGE: real production pairs, all different animals ----

check(
  'Лола/Лола — chihuahua vs dachshund, 721m apart',
  !isSamePet(
    pet({ name: 'Лола', breed: 'chihuahua' }),
    pet({ name: 'Лола', breed: 'dachshund / такса', lastSeenAtMs: T0 + 6.5 * DAY }),
    721,
  ),
);

check(
  'кіт/кіт хлопчик — two cats sharing only a generic word',
  !isSamePet(
    pet({ name: 'кіт', species: 'cat', breed: 'unknown' }),
    pet({ name: 'кіт хлопчик', species: 'cat', breed: 'unknown', lastSeenAtMs: T0 + 6.9 * DAY }),
    0,
  ),
);

check(
  'котик/котик — both on the fallback pin, both breed-less',
  !isSamePet(
    pet({ name: 'котик', species: 'cat', breed: 'unknown' }),
    pet({ name: 'котик', species: 'cat', breed: 'mixed', lastSeenAtMs: T0 + 2.3 * DAY }),
    0,
  ),
);

check(
  'сіро-білий котик — descriptor, not a name',
  !isSamePet(
    pet({ name: 'сіро-білий котик', species: 'cat' }),
    pet({ name: 'сіро-білий котик', species: 'cat', lastSeenAtMs: T0 + DAY }),
    10,
  ),
);

check(
  'собака без імені — descriptor, not a name',
  !isSamePet(pet({ name: 'собака без імені' }), pet({ name: 'собака без імені' }), 10),
);

// ---- MUST MERGE: the one genuine duplicate, and clear reposts ----

check(
  'Тайсон/Тайсон — same street, same day, breed unknown both sides',
  isSamePet(
    pet({ name: 'Тайсон', breed: 'unknown' }),
    pet({ name: 'Тайсон', breed: 'unknown' }),
    0,
  ),
);

check(
  'Бусинка repost — one side states a breed, other unknown',
  isSamePet(
    pet({ name: 'Бусинка', breed: 'mixed / дворняга' }),
    pet({ name: 'бусинка', breed: 'unknown', lastSeenAtMs: T0 + 2 * DAY }),
    400,
  ),
);

check(
  'same breed written two ways still merges',
  isSamePet(
    pet({ name: 'Такса Філ', breed: 'dachshund / такса' }),
    pet({ name: 'Такса Філ', breed: 'такса' }),
    50,
  ),
);

// ---- The pre-existing guards must survive ----

check(
  'different species never merge',
  !isSamePet(pet({ name: 'Мурка', species: 'dog' }), pet({ name: 'Мурка', species: 'cat' }), 0),
);
check(
  'beyond 1500m never merges',
  !isSamePet(pet({ name: 'Тайсон' }), pet({ name: 'Тайсон' }), 1500),
);
check(
  'beyond 7 days never merges',
  !isSamePet(pet({ name: 'Тайсон' }), pet({ name: 'Тайсон', lastSeenAtMs: T0 + 7 * DAY }), 0),
);

// ---- Unit-level, so a failure above points somewhere ----

check('isUsableName rejects "котик"', !isUsableName('котик'));
check('isUsableName rejects "чорний пес"', !isUsableName('чорний пес'));
check('isUsableName rejects "two dogs (owner unknown)"', !isUsableName('two dogs (owner unknown)'));
check('isUsableName accepts "Тайсон"', isUsableName('Тайсон'));
check('isUsableName accepts "Бусинка"', isUsableName('Бусинка'));
check('breedsCompatible unknown vs anything', breedsCompatible('unknown', 'chihuahua'));
check('breedsCompatible rejects two stated breeds', !breedsCompatible('chihuahua', 'dachshund'));

if (failures === 0) {
  console.log('✓ pet identity rule: all cases pass');
} else {
  console.error(`\n✗ ${failures} case(s) failed`);
  process.exit(1);
}
