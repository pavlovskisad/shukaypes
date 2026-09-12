// The sender address, in the one shape Resend accepts.
//
// Resend's `from` must be `email@domain` or `Name <email@domain>`, and
// it validates the field before it validates the key, with a 422 that
// names the format but not what was wrong with it — and a Fly secret
// cannot be read back to look. So the value is parsed here, once, into
// a name and an address, and put back together in a form that cannot
// be refused:
//
//   - stray quotes and whitespace around the value or the name go
//     (a value pasted with its shell quotes still works);
//   - a name with anything outside ASCII — «шукайпес» — is sent as an
//     RFC 2047 encoded-word (`=?UTF-8?B?…?=`), which is plain ASCII on
//     the wire and what every mail client shows as the name. That is
//     what nodemailer does with the same input; Resend is a REST call
//     with no such layer in front of it.
//
// `fromProblem` names what is wrong with a value that cannot be
// parsed at all, for the boot log, so a bad secret is found at deploy
// rather than at the first registration.

export interface MailFrom {
  name: string | null;
  address: string;
}

const ADDRESS = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

function unquote(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    return t.slice(1, -1).trim();
  }
  return t;
}

export function parseFrom(raw: string | undefined): MailFrom | null {
  if (!raw) return null;
  const value = unquote(raw);
  const m = /^(.*?)\s*<([^<>]+)>$/.exec(value);
  if (m) {
    const address = (m[2] ?? '').trim();
    if (!ADDRESS.test(address)) return null;
    const name = unquote(m[1] ?? '');
    return { name: name.length > 0 ? name : null, address };
  }
  if (ADDRESS.test(value)) return { name: null, address: value };
  return null;
}

function isAscii(s: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7e]*$/.test(s);
}

/** The header value to send: ASCII, in Resend's shape. */
export function formatFrom(from: MailFrom): string {
  if (!from.name) return from.address;
  if (isAscii(from.name)) {
    // Quote a name with the characters that would otherwise break the
    // `Name <email>` parse — a comma, a colon, a semicolon.
    const needsQuotes = /[,;:()<>@\\"]/.test(from.name);
    const name = needsQuotes ? `"${from.name.replace(/(["\\])/g, '\\$1')}"` : from.name;
    return `${name} <${from.address}>`;
  }
  const encoded = Buffer.from(from.name, 'utf8').toString('base64');
  return `=?UTF-8?B?${encoded}?= <${from.address}>`;
}

/** Why a value cannot be a sender, in one line, or null when it can. */
export function fromProblem(raw: string | undefined): string | null {
  if (!raw || raw.trim().length === 0) return 'empty';
  if (parseFrom(raw)) return null;
  if (!raw.includes('@')) return 'no @ in it';
  if (/[<>]/.test(raw) && !/<[^<>]+>$/.test(raw.trim().replace(/["']$/, ''))) return 'angle brackets not around the address';
  return 'not `email@domain` or `Name <email@domain>`';
}
