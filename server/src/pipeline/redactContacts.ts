// Take the owner's contact details out of an ad, and nothing else.
//
// The walker gets the ad twice, for two different reasons. DURING a
// search they need to answer "is this the dog?" — red collar, scared of
// men, answers to Мухтар — and that is what the ad body is full of.
// AFTER reporting a sighting they need the phone. The first view runs
// through here; the second does not.
//
// WHY THE SPLIT IS WORTH THE TROUBLE. The app already worked this way:
// `sourceUrl: seen ? sourceUrl : null` in MapView only offered the
// original post to somebody who answered yes. Keeping contact behind a
// report means an owner's phone rings when somebody has actually seen
// their animal, rather than every time a stranger opens a pin.
//
// IMPERFECTION IS ACCEPTABLE HERE, AND THAT IS A DESIGN POINT, not an
// excuse. A number that slips through is one the walker can get thirty
// seconds later by reporting the sighting. So this errs toward keeping
// the description readable rather than toward aggressive masking that
// eats house numbers and dates — a redaction that swallows "Оболонь,
// буд. 12" helps nobody.
//
// What it removes: phone numbers in the shapes Ukrainian ads actually
// use, e-mail addresses, and @handles. What it deliberately leaves:
// anything with fewer than nine digits, because that is a house number,
// a year, a price or a time.

const MASK = '[контакт приховано]';

// Nine digits is the discriminator. A Ukrainian mobile is ten (0671234567)
// or twelve with the country code (380671234567); a house number, a year,
// a flat number and a price are all shorter. Separators inside a number
// are common in ads: spaces, dashes, dots, brackets.
const PHONE_CANDIDATE = /\+?[\d][\d\s\-().]{7,}\d/g;
const MIN_PHONE_DIGITS = 9;
const MAX_PHONE_DIGITS = 15;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Telegram/Instagram handles. Requires a letter start and 4+ characters so
// it does not eat an e-mail's domain half or a stray "@".
const HANDLE = /(^|[\s(,;])@[A-Za-z][A-Za-z0-9_]{3,}/g;

export function redactContacts(text: string): string {
  if (!text) return text;

  // E-mails first: their @ would otherwise be seen by the handle rule.
  let out = text.replace(EMAIL, MASK);

  out = out.replace(PHONE_CANDIDATE, (match) => {
    const digits = match.replace(/\D/g, '').length;
    if (digits < MIN_PHONE_DIGITS || digits > MAX_PHONE_DIGITS) return match;
    return MASK;
  });

  out = out.replace(HANDLE, (match, lead: string) => `${lead}${MASK}`);

  return out;
}

/** Does this text still appear to carry a contact? Used only for a flag. */
export function looksLikeItHadContacts(original: string): boolean {
  return redactContacts(original) !== original;
}
