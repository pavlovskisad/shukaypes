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
//   - PET stem stays "такса" not "такс" — taxi/таксофон would otherwise hit.
//   - PET stem "киц" picks up киця/киці/кисуня — separate root from кіт/кот.
//   - REHOMING starts with шука|знайт so "Допоможіть знайти дім" lands
//     here even though it also passes the LOST filter.

export const PET_KEYWORDS = /(собак|пес|пёс|щен|цуцен|dog|puppy|hound|шпіц|хаск|ретрівер|бульдог|лабрад|пудель|такса|вівчарк|джек-?\s?рассел|чихуахуа|корг|шарпей|шиба|боксер|кіт|кот|кошен|киц|cat|kitten|tabby|британ|мейн-?кун|перс|сфінкс|сиам|сіам|рагдол|бенгал)/i;

export const LOST_KEYWORDS = /(пропа|лост|загуб|зник|знайд|знайт|знайш|найден|нашли|сбеж|втеч|потер|розшук|lost|found|missing)/i;

export const REHOMING_KEYWORDS = /((?:шука[єют]|знайт[иуе])[^.!?\n]{0,20}(?:дім|домівк|родин|госпо)|в\s+(?:добрі|добрые|хороші|хорошие)\s+руки|віддам|віддаю|віддає|віддаєм|роздам|роздаю|роздає|роздаєм|отдам|отдаю|раздам|раздаю|в\s+дар|пристр[оау]|ищет\s+дом|ищу\s+дом|безкоштовно|бесплатно)/i;

export function looksLikeLostPet(title: string): boolean {
  return PET_KEYWORDS.test(title) && LOST_KEYWORDS.test(title);
}

export function looksLikeRehoming(title: string): boolean {
  return REHOMING_KEYWORDS.test(title);
}
