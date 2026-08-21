// Detects posts about pets in other cities.
//
// Why this exists: the map is Kyiv-only, and upsert already refuses
// coords outside the Greater Kyiv bbox — but that gate has a hole it
// documents itself (upsert.ts, "fallback-coord pets stay in"). A post
// about a cat in Uzhhorod usually can't be geocoded to a Kyiv landmark
// at all, so the parser falls back to the city-centre coord, the
// fallback bypasses the bbox check, and the row lands active. Measured
// on production: at least 9 of the 89 pets sitting on the fallback pin
// are in Uzhhorod, Kharkiv, Mykolaiv, Vinnytsia, Khmelnytskyi,
// Boryslav, Kryvyi Rih, Bucha, or a village outside the oblast.
//
// The parser prompt already says "if the post is about another city …
// set urgency to resolved" and it demonstrably does not fire. Worse, it
// would be wrong if it did: upsert maps urgency 'resolved' → status
// 'found', which tells a searching owner their pet was found. So the
// check lives here, in code, where it is deterministic and reviewable.
//
// THE TRAP THIS IS BUILT AROUND. Kyiv is full of streets named after
// other cities — Львівська площа, Харківське шосе, Одеська площа,
// Ужгородський провулок, and the Чернігівська / Житомирська /
// Бориспільська metro stations. A substring match on "львів" flags a
// pet on Львівська площа as being in Lviv and expires a real Kyiv row.
// So matching is token-exact, and a city stem only counts when what
// follows it is a *noun* ending. Adjectival endings (-ський, -ська,
// -ське, -цький) are the giveaway that the word is a street named after
// a city rather than the city itself, and they are rejected outright.
//
// Deliberately conservative. A missed out-of-city pet keeps the
// behaviour we already have (it sits invisibly on the fallback pin); a
// false positive expires somebody's real lost-pet report. When in
// doubt this returns null.
//
// RELATIONSHIP TO looksNotKyiv (pipeline/sources/olx.ts). That one asks
// the same question of a whole fetched ad PAGE, and it is right to be
// built differently: a page states its city in plain text, so it can
// take the cheap route — bare substring match, short-circuited by "if
// the page says Київ anywhere, it's a Kyiv ad". Neither half of that
// survives contact with a short string. A title like "Загубився пес на
// Львівській площі" never says Київ and does contain "Львів", so
// looksNotKyiv would call a pet on a Kyiv square a Lviv pet. Two rules
// because there are two inputs, not by accident — this one is for text
// written by a person, that one is for a document. If a city is added
// to one list, add it to the other.

export interface OtherCityHit {
  // Human-readable city name, for logs and dry-run output.
  city: string;
  // The exact token that matched, so a dry run can show its work and a
  // human can see *why* a row was flagged before anything is applied.
  token: string;
}

interface CityPattern {
  label: string;
  // Stems get the noun-ending treatment described above. Use for names
  // that inflect regularly: ужгород → ужгорода, вінниц → вінниці.
  stems?: string[];
  // Exact token forms, matched whole with no ending logic. Use for
  // names that are themselves adjectival (Хмельницький, Беремицьке) —
  // the stem rules would reject them as street names.
  forms?: string[];
}

// Ukrainian + Russian + Latin spellings. Not exhaustive: this covers
// the cities actually observed leaking into the table plus the large
// ones most likely to follow. Adding a city is a one-line change.
const CITIES: CityPattern[] = [
  { label: 'Kharkiv', stems: ['харків', 'харьков', 'kharkiv', 'kharkov'] },
  { label: 'Odesa', stems: ['одес', 'одесс', 'odesa', 'odessa'] },
  { label: 'Dnipro', stems: ['дніпропетровськ', 'днепропетровск'], forms: ['дніпро', 'днепр', 'dnipro'] },
  { label: 'Lviv', stems: ['львів', 'львов', 'lviv', 'lvov'] },
  { label: 'Zaporizhzhia', stems: ['запоріжж', 'запорожь', 'zaporizhzhia'] },
  { label: 'Mykolaiv', stems: ['миколаїв', 'николаев', 'mykolaiv', 'nikolaev'] },
  { label: 'Vinnytsia', stems: ['вінниц', 'винниц', 'vinnytsia', 'vinnitsa'] },
  { label: 'Poltava', stems: ['полтав', 'poltava'] },
  { label: 'Chernihiv', stems: ['чернігів', 'чернигов', 'chernihiv'] },
  { label: 'Cherkasy', stems: ['черкас', 'cherkasy'] },
  { label: 'Zhytomyr', stems: ['житомир', 'zhytomyr'] },
  { label: 'Sumy', stems: ['sumy'], forms: ['суми', 'сумах'] },
  { label: 'Rivne', stems: ['rivne'], forms: ['рівне', 'рівному', 'ровно'] },
  { label: 'Lutsk', stems: ['луцьк', 'lutsk'] },
  { label: 'Ternopil', stems: ['тернопіл', 'ternopil'] },
  { label: 'Ivano-Frankivsk', stems: ['франківськ', 'франковск', 'frankivsk'] },
  { label: 'Uzhhorod', stems: ['ужгород', 'uzhhorod', 'uzhgorod'] },
  { label: 'Kherson', stems: ['херсон', 'kherson'] },
  { label: 'Mariupol', stems: ['маріупол', 'мариупол', 'mariupol'] },
  { label: 'Melitopol', stems: ['мелітопол', 'мелитопол', 'melitopol'] },
  { label: 'Kramatorsk', stems: ['краматорськ', 'краматорск', 'kramatorsk'] },
  { label: 'Berdiansk', stems: ['бердянськ', 'бердянск', 'berdiansk'] },
  { label: 'Kropyvnytskyi', stems: ['кропивниц', 'kropyvnytskyi'] },
  { label: 'Uman', stems: ['уман', 'uman'] },
  { label: 'Izmail', stems: ['ізмаїл', 'измаил', 'izmail'] },
  { label: 'Kryvyi Rih', stems: ['кривий ріг', 'кривой рог', 'kryvyi rih'], forms: ['кривом', 'долгинцево', 'долгінцево'] },
  { label: 'Boryslav', stems: ['борислав', 'boryslav'] },
  // Khmelnytskyi's own name is adjectival, so it can only be matched as
  // an exact form — the stem rules would read it as a street name.
  { label: 'Khmelnytskyi', forms: ['хмельницький', 'хмельницького', 'хмельницькому', 'хмельницкий', 'khmelnytskyi'] },
  // Kyiv-oblast towns beyond the bbox. Only the ones upsert's
  // KYIV_BBOX actually excludes belong here — see the note below.
  { label: 'Bila Tserkva', stems: ['біла церкв', 'белая церков', 'білої церкв'] },
  { label: 'Obukhiv', stems: ['обухів', 'obukhiv'] },
  { label: 'Fastiv', stems: ['фастів', 'fastiv'] },
  { label: 'Beremytske', forms: ['беремицьке', 'беремицького'] },
  // Observed on the fall-through pin, August: an ad reading «районі
  // Левади в Красилові». The і→о alternation is why both stems are
  // here — Красилів becomes Красилова, and matching only the
  // nominative finds neither.
  { label: 'Krasyliv', stems: ['красилів', 'красилов', 'krasyliv'] },
  // Named in an OLX ad the scraper fetched and was refused: «пропала
  // собака в околиці м. Заліщики».
  { label: 'Zalishchyky', stems: ['заліщик', 'залещик', 'zalishchyky'] },

  // DISTRICTS OF OTHER CITIES, which the city list cannot see.
  //
  // «АНД районі» is Амур-Нижньодніпровський район — Dnipro — and the ad
  // never says Dnipro, so every city stem above misses it. Same shape
  // for «Хортицький район» in Zaporizhzhia. These sat on the
  // fall-through pin looking exactly like unplaceable Kyiv pets.
  //
  // They have to be MULTI-WORD. A bare «хортицьк» is adjectival, and
  // the rule above rejects adjectival forms on purpose, because that is
  // what tells a Kyiv street named after a city from the city itself.
  // Pairing the stem with «район» restores the signal that the
  // adjective ending removed.
  //
  // Each inflection is listed rather than derived: multi-word stems are
  // matched by plain substring, so «Хортицькому районі» needs its own
  // entry. Better an obvious list than a clever rule nobody can audit.
  {
    label: 'Dnipro (AND district)',
    stems: ['анд район', 'анд р н', 'амур нижньодніпровськ'],
  },
  {
    label: 'Zaporizhzhia (Khortytskyi district)',
    stems: ['хортицький район', 'хортицькому район', 'хортицкий район'],
  },
];

// DELIBERATELY ABSENT: Bucha, Irpin, Brovary, Boryspil, Vyshhorod,
// Vasylkiv. upsert's KYIV_BBOX is documented as "generous enough to
// include Vyshgorod, Brovary, Bucha, Boryspil, Vasylkiv approaches",
// so a pet in any of them is one this project has decided to carry. A
// pet whose coords the bbox admits and whose text this module rejects
// is two guards disagreeing about the same animal, and the one that
// runs second wins by accident. If the map's reach changes, change it
// in both places or in neither.

// Endings that mark a word as an adjective derived from a place name —
// i.e. a Kyiv street named after a city, not the city. Checked before
// the noun endings and always wins.
const ADJECTIVAL = /^(ськ|ск|ьк|цьк|ьськ)/;

// Noun endings a city name can legitimately carry in the cases that
// show up in these posts: nominative (""), genitive ("біля Вінниці"),
// locative ("в Ужгороді"), instrumental ("під Полтавою"). Anything
// longer or stranger is treated as a different word entirely.
const NOUN_ENDINGS = new Set([
  '', 'а', 'у', 'і', 'и', 'е', 'ю', 'я', 'ї', 'ом', 'ем', 'ою', 'ею', 'ові', 'еві', 'ах', 'ям',
]);

// If the post names Kyiv, it is a Kyiv post — full stop, no other city
// is considered. Measured need: a real production row titled
// "КИЇВ!!! ЗНИК собака!!" describes a dog that slipped its leash by the
// Olimpiiska stadium, and mentions being evacuated from Kramatorsk
// months earlier. Without this guard the city of origin in a pet's
// backstory reads as the city it is lost in, and a correctly-placed
// Kyiv dog gets expired off the map.
const KYIV_WORDS = /київ|києв|киев|kyiv|kiev/;

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’`ʼ]/g, '')
    .replace(/́/g, '');
}

// Split on anything that isn't a letter or digit. Explicit character
// ranges rather than \p{L} because this string travels through shells
// and config files where a lone backslash does not always survive.
const TOKEN_SPLIT = /[^A-Za-zА-Яа-яЁёІіЇїЄєҐґ0-9]+/;

function tokenize(text: string): string[] {
  return normalise(text).split(TOKEN_SPLIT).filter((t) => t.length > 0);
}

function matchesStem(token: string, stem: string): boolean {
  if (!token.startsWith(stem)) return false;
  const rest = token.slice(stem.length);
  if (ADJECTIVAL.test(rest)) return false;
  return NOUN_ENDINGS.has(rest);
}

/**
 * Returns the other-city hit if `text` names a city that isn't Kyiv,
 * or null. Multi-word city names ("кривий ріг") are matched against the
 * normalised text; single words against exact tokens.
 */
export function detectOtherCity(text: string): OtherCityHit | null {
  if (!text) return null;
  const normalised = normalise(text);
  if (KYIV_WORDS.test(normalised)) return null;
  const tokens = tokenize(text);
  if (tokens.length === 0) return null;
  const tokenSet = new Set(tokens);
  const flat = tokens.join(' ');

  for (const city of CITIES) {
    for (const form of city.forms ?? []) {
      if (tokenSet.has(form)) return { city: city.label, token: form };
    }
    for (const stem of city.stems ?? []) {
      // Multi-word stems ("кривий ріг") can't be token-matched.
      if (stem.includes(' ')) {
        if (flat.includes(stem)) return { city: city.label, token: stem };
        continue;
      }
      for (const token of tokens) {
        if (matchesStem(token, stem)) return { city: city.label, token };
      }
    }
  }
  return null;
}
