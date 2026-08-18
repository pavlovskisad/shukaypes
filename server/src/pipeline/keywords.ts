// Shared title/body filters every source runs before spending a Haiku
// parse. Conservative on the lost-pet side (both pet AND lost/found
// keywords must hit) and aggressive on the rehoming side (any clear
// rehoming phrase short-circuits). Low-signal posts land in scrape_log
// with skipReason 'title-filter' or 'rehoming' so we can audit later.
//
// Stems over full forms — Ukrainian/Russian inflect heavily so we match
// on roots ("вівчарк" covers вівчарка/вівчарку/вівчарці) rather than
// nominative literals. Edge cases worth knowing:
//   - LOST allows знайт|знайш|знайд but NOT знайо (знайомий = acquaintance).
//   - PET stem stays "такса" not "такс" — taxi/таксофон would otherwise hit;
//     instead we list the oblique forms (таксу/таксою) explicitly so
//     "загубив таксу" lands without false positives on taxi-words.
//   - PET stem "киц" picks up киця/киці/кисуня — separate root from кіт/кот.
//   - "пес"/"пёс" lose the vowel in oblique cases (genitive "пса",
//     dative "псу", etc) so we list those forms explicitly — the bare
//     "пс" root would overmatch "псих" / "псувати".
//   - "пудель"/"шарпей" lose the final soft-sign / й in oblique cases
//     (пуделя, шарпея) so we list those forms too — same vowel-drop
//     pattern as "пес".
//   - REHOMING starts with шука|знайт so "Допоможіть знайти дім" lands
//     here even though it also passes the LOST filter.

export const PET_KEYWORDS = /(собак|пес|пёс|пса|псу|псі|псом|псах|псів|щен|цуцен|dog|puppy|hound|шпіц|хаск|ретрівер|бульдог|лабрад|пудель|пуделя|пуделю|пуделем|такса|таксу|таксою|вівчарк|джек-?\s?рассел|чихуахуа|корг|шарпей|шарпея|шарпею|шарпеєм|шиба|боксер|кіт|кот|кошен|киц|cat|kitten|tabby|британ|мейн-?кун|перс|сфінкс|сиам|сіам|рагдол|бенгал)/i;

export const LOST_KEYWORDS = /(пропа|лост|загуб|зник|знайд|знайт|знайш|найден|нашли|сбеж|втеч|потер|розшук|lost|found|missing)/i;

export const REHOMING_KEYWORDS = /((?:шука[єют]|знайт[иуе])[^.!?\n]{0,20}(?:дім|домівк|родин|госпо)|в\s+(?:добрі|добрые|хороші|хорошие)\s+руки|віддам|віддаю|віддає|віддаєм|роздам|роздаю|роздає|роздаєм|отдам|отдаю|раздам|раздаю|в\s+дар|пристр[оау]|ищет\s+дом|ищу\s+дом|безкоштовно|бесплатно)/i;

export function looksLikeLostPet(title: string): boolean {
  return PET_KEYWORDS.test(title) && LOST_KEYWORDS.test(title);
}

export function looksLikeRehoming(title: string): boolean {
  return REHOMING_KEYWORDS.test(title);
}

// FOUND REPORTS ARE NOT SEARCHES, and the app has been treating them as
// one. «песик (знайдений)» — somebody has the animal safe indoors and is
// looking for its OWNER — was appearing under «загублені» with a
// «терміново» badge, asking a walker to go comb the streets for a dog
// already sitting on a stranger's sofa.
//
// They are ingested on purpose: LOST_KEYWORDS includes знайд|знайш and
// four listing queries search for exactly them, because a found stray
// genuinely needs its owner found. That is a real job. It is just not
// the same job, and it deserves its own screen rather than a misleading
// place on this one.
//
// The distinction is "found words present, lost words absent". A post
// that says both — «Пропала собака… знайшлася» — is left as lost, since
// the ambiguity is better resolved by a human than by a regex.
//
// знайт is deliberately NOT a found stem: «Допоможіть знайти собаку» is
// somebody ASKING for help finding, which is the most lost a post can be.
const FOUND_STEMS = /(знайд|знайш|найден|нашли|прибил|пристал|found)/i;
const LOST_STEMS = /(пропа|загуб|зник|потер|сбеж|втеч|розшук|lost|missing)/i;

/** Somebody HAS this animal and wants its owner — not a search to join. */
export function looksLikeFoundReport(title: string): boolean {
  return FOUND_STEMS.test(title) && !LOST_STEMS.test(title);
}

