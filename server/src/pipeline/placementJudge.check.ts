// READING A VERDICT IS WHERE AN ANSWER BECOMES A DECISION ABOUT A PET.
//
// judgePlacement itself needs a network and a key, so it is not tested
// here. What is tested is the half that turns whatever came back into
// "hide this pet" or "show it" — and the rule that only an explicit
// REJECT hides anything. Everything else is a keep, because an empty
// answer, a refusal, or a sentence in an unexpected shape is not the
// model saying the pin is wrong.
import {
  parseVerdict,
  isJudgeable,
  placeNameOf,
  JUDGED_PREFIX,
  REJECTED_PREFIX,
} from './placementJudge.js';

let failures = 0;
function check(label: string, ok: boolean, got?: string): void {
  if (ok) {
    console.log(`  ✓ ${label}`);
    return;
  }
  failures++;
  console.error(`  ✗ ${label}${got === undefined ? '' : ` — got ${got}`}`);
}

// The two shapes the judge is asked for, as production returned them.
{
  const r = parseVerdict('REJECT Ad means вул. Соборна in Софіївська Борщагівка (village), not the central square');
  check('a REJECT is read as a reject', r?.keep === false, JSON.stringify(r));
  check(
    '…and keeps the reason, without the verdict word',
    r?.reason.startsWith('Ad means вул. Соборна') === true,
    r?.reason,
  );

  const k = parseVerdict('KEEP ad names Лук’янівка, matching the Лукʼянівська area in Kyiv');
  check('a KEEP is read as a keep', k?.keep === true, JSON.stringify(k));
}

// AN ANSWER WE CANNOT READ IS NOT A REJECTION.
//
// The first prototype run returned six empty answers out of forty-four —
// max_tokens was 300 and the model spent it thinking, leaving no text.
// The code then tested for a REJECT prefix, found none, and scored all
// six as keeps. Silent, and in the wrong direction: an unreadable answer
// had become a verdict. null now means "not judged", and the caller
// leaves the label alone.
for (const [label, text] of [
  ['empty', ''],
  ['whitespace', '   \n  '],
  ['a refusal', "I can't help with that."],
  ['prose with no verdict', 'This ad appears to describe a location in Kyiv.'],
  ['the word reject buried mid-sentence', 'I would not reject this pin.'],
]) {
  check(`no verdict from ${label}`, parseVerdict(text!) === null, JSON.stringify(parseVerdict(text!)));
}

// Case and punctuation vary; the decision must not.
for (const text of ['reject — wrong city', 'Reject: wrong city', 'REJECT wrong city']) {
  check(`«${text}» rejects`, parseVerdict(text)?.keep === false);
}

// Only the first line counts. A model that adds a second paragraph must
// not have it read as a fresh verdict.
{
  const r = parseVerdict('KEEP the ad names Оболонь\nREJECT actually, on reflection');
  check('only the first line is the verdict', r?.keep === true, JSON.stringify(r));
}

// WHICH PLACEMENTS THIS LAYER MAY TOUCH.
//
// Only the two it was built for. A marked address needs no second
// opinion, an owner's own pin certainly does not, and a model guess is
// not something a judge can rescue — there is no ad evidence to confirm.
check('judges bare', isJudgeable('gazetteer-bare:Оболонь') === true);
check('judges fuzzy', isJudgeable('gazetteer-fuzzy:Щось') === true);
for (const src of [
  'gazetteer-marked:Вулиця Літня',
  'owner',
  'sighting',
  'model-geo',
  'model-landmark:Olimpiiska / Олімпійська',
  'fall-through',
  `${JUDGED_PREFIX}Оболонь`,
  `${REJECTED_PREFIX}Соборна площа`,
]) {
  check(`leaves ${src} alone`, isJudgeable(src) === false);
}
check('leaves an unlabelled row alone', isJudgeable(null) === false);

// The place name survives the relabelling, so the ledger still says
// WHERE a rejected pet was put — the coordinate does not move.
check(
  'the place name reads back out of any tier',
  placeNameOf('gazetteer-bare:Соборна площа') === 'Соборна площа' &&
    placeNameOf(`${REJECTED_PREFIX}Соборна площа`) === 'Соборна площа' &&
    placeNameOf(`${JUDGED_PREFIX}Оболонь`) === 'Оболонь',
);
// A name containing a colon must not be truncated — the prefix is
// stripped by tier, not by splitting on the first colon.
check(
  'a place name with its own colon survives',
  placeNameOf('gazetteer-bare:Вул. Смілянська: район') === 'Вул. Смілянська: район',
  placeNameOf('gazetteer-bare:Вул. Смілянська: район'),
);

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('✓ placement judge: only an explicit refusal hides a pet');
