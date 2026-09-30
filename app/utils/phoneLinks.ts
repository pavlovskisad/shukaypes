// Finds phone numbers in an owner's ad so the sheet can make them
// tappable (UX-14.7). The whole point of storing the ad is the owner's
// number; a walker standing in the street should reach it with one tap,
// not by memorising ten digits and retyping them in the dialer.
//
// Ukrainian numbers only, in the shapes ads actually paste them in:
// "0671234567", "067 123 45 67", "(067) 123-45-67", "+38 067 123 45 67",
// "+380671234567". Masked runs ("05*******62", see contactsMasked in
// PostModal) do not match — there is nothing to dial.

export type PhonePart =
  | { kind: 'text'; value: string }
  | { kind: 'phone'; value: string; tel: string };

// Optional +38 / 38 country code, then the 0XX operator code and seven
// digits, with spaces, dashes, dots or brackets anywhere between groups.
// The edges stop it matching the middle of a longer digit run (an OLX ad
// id, a price). The leading edge is a captured character rather than a
// lookbehind: Safari before 16.4 cannot parse (?<!…), and a regex it
// cannot parse is a SyntaxError that takes the whole bundle down.
const PHONE_RE =
  /(^|[^\d+])((?:\+?38[\s.\-]*)?\(?0\d{2}\)?[\s.\-]*\d{3}[\s.\-]*\d{2}[\s.\-]*\d{2})(?!\d)/g;

// "(067) 123-45-67" → "tel:+380671234567". Always the full international
// form, so it dials the same from a SIM registered anywhere.
export function telHref(match: string): string {
  const digits = match.replace(/\D/g, '');
  const local = digits.startsWith('38') ? digits.slice(2) : digits;
  return `tel:+38${local}`;
}

export function splitPhones(text: string): PhonePart[] {
  const parts: PhonePart[] = [];
  let last = 0;
  for (const m of text.matchAll(PHONE_RE)) {
    const phone = m[2];
    const i = (m.index ?? 0) + m[1].length;
    if (i > last) parts.push({ kind: 'text', value: text.slice(last, i) });
    parts.push({ kind: 'phone', value: phone, tel: telHref(phone) });
    last = i + phone.length;
  }
  if (last < text.length) parts.push({ kind: 'text', value: text.slice(last) });
  return parts;
}
