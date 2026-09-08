// WHAT WE WILL AND WILL NOT SEND SOMEBODY WALKING TO.
//
// The bar decides whether a real person spends an afternoon looking for
// an animal in the right district or the wrong one, so it should be hard
// to widen by accident. Each tier below is named explicitly: adding a
// source to CONFIDENT_PLACEMENT_PREFIXES without deciding it here fails.
import {
  isConfidentPlacement,
  confidentPlacementSqlFragment,
  CONFIDENT_PLACEMENT_PREFIXES,
} from './placementConfidence.js';

let failures = 0;
function check(label: string, ok: boolean, got?: string): void {
  if (ok) {
    console.log(`  ✓ ${label}`);
    return;
  }
  failures++;
  console.error(`  ✗ ${label}${got === undefined ? '' : ` — got ${got}`}`);
}

// Shown: a person put the pin there, or the ad named the place.
for (const src of [
  'owner',
  'sighting',
  'gazetteer-marked:Цирк',
  'gazetteer-marked:Вулиця Літня',
  // A bare match a model read the ad and confirmed — «пропав пес на
  // Оболоні» is a complete address, it just carries no «вул.».
  'gazetteer-judged:Оболонь',
]) {
  check(`shown: ${src}`, isConfidentPlacement(src) === true);
}

// Hidden: every path where nothing in the ad put the animal there.
// «Таруша» (model-landmark, ad names a Kharkiv metro) and the Myla cat
// (fuzzy, ad names a village, matched a music school) are the two the
// owner reported from the map.
for (const src of [
  // Unjudged. The judge has not been asked, so nothing vouches for it.
  'gazetteer-bare:Соборна площа',
  'gazetteer-fuzzy:Київська Дитяча Школа Мистецтв #2 ім М.І.Вериківського',
  // Judged and REFUSED — «Горобчик», whose «Соборна» is a street inside
  // Софіївська Борщагівка, not the square in the centre.
  'gazetteer-rejected:Соборна площа',
  'model-landmark:Olimpiiska / Олімпійська',
  'model-geo',
  'fall-through',
]) {
  check(`hidden: ${src}`, isConfidentPlacement(src) === false);
}

// Rows predating migration 0037 were all model-placed.
check('hidden: null (legacy)', isConfidentPlacement(null) === false);

// A prefix must not match a longer tier name that merely starts the same
// way — the colon is what stops «gazetteer-marked» from admitting a
// hypothetical «gazetteer-marked-loosely».
check(
  'the bare tier name without its colon is not confident',
  isConfidentPlacement('gazetteer-marked') === false,
);

// The SQL and the predicate are generated from one list, so they cannot
// disagree — but assert the SQL actually mentions every tier, in case the
// generator is edited into dropping one silently.
{
  const sql = confidentPlacementSqlFragment('lost_dogs.placement_source');
  for (const p of CONFIDENT_PLACEMENT_PREFIXES) {
    check(`sql covers ${p}`, sql.includes(p));
  }
  check('sql excludes NULL explicitly', sql.includes('IS NOT NULL'));
  check(
    'sql is parenthesised so it can be ANDed safely',
    sql.startsWith('(') && sql.endsWith(')'),
    sql,
  );
}

// The list itself is the product decision. If it grows, somebody should
// have to come here and say why — an unreviewed extra tier is exactly how
// a walker ends up back at Олімпійська.
check(
  'the bar is still the four defensible sources',
  CONFIDENT_PLACEMENT_PREFIXES.length === 4,
  CONFIDENT_PLACEMENT_PREFIXES.join(', '),
);

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('✓ placement confidence: a pin is an invitation, and we only make defensible ones');
