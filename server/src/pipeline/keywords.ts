// Shared title/body filters every source runs before spending a Haiku
// parse. Conservative on the lost-pet side (both pet AND lost/found
// keywords must hit) and aggressive on the rehoming side (any clear
// rehoming phrase short-circuits). Low-signal posts land in scrape_log
// with skipReason 'title-filter' or 'rehoming' so we can audit later.

export const PET_KEYWORDS = /(собак|пес|пёс|щен|цуценя|dog|puppy|hound|шпіц|хаск|ретрівер|бульдог|лабрад|пудель|такса|вівчарка|джек-рассел|джек рассел|чихуахуа|корг|шарпей|шиба|боксер|кіт|кот|кота|котик|кошен|кошеня|cat|kitten|tabby|британ|мейн-кун|мейнкун|перс|сфінкс|сиам|сіам|рагдол|бенгал)/i;

export const LOST_KEYWORDS = /(пропа|лост|загуб|зник|знайд|найден|нашли|знайшли|сбеж|втеч|lost|found)/i;

export const REHOMING_KEYWORDS = /(шука[єют][^.!?\n]{0,20}дім|шука[єют][^.!?\n]{0,20}домівк|шука[єют][^.!?\n]{0,20}родин|шука[єют][^.!?\n]{0,20}госпо|в\s+добрі\s+руки|в\s+добрые\s+руки|в\s+хорошие\s+руки|віддам|віддаю|віддає|віддаєм|роздам|роздаю|роздає|роздаєм|отдам|отдаю|раздам|раздаю|в\s+дар|пристр[оау]|ищет\s+дом|ищу\s+дом|безкоштовно|бесплатно)/i;

export function looksLikeLostPet(title: string): boolean {
  return PET_KEYWORDS.test(title) && LOST_KEYWORDS.test(title);
}

export function looksLikeRehoming(title: string): boolean {
  return REHOMING_KEYWORDS.test(title);
}
