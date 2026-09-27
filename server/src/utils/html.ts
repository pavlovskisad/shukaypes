// Escape a string for safe interpolation into Telegram HTML parse_mode
// (and any other HTML sink). Only the five characters Telegram's HTML mode
// treats specially need escaping; everything else is literal.
//
// This exists because bot replies are sent with parse_mode: 'HTML' and some
// interpolated values — a lost pet's name and emoji — come from the parser,
// i.e. from attacker-authorable post text. An unescaped '<' either breaks the
// send (Telegram rejects malformed HTML with a 400) or injects markup/links
// into a message posted to a public group.
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
