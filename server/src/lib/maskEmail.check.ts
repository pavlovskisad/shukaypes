// Fixture check for maskEmail: the mask never reveals more of the local
// part than it promises, never leaks the length, and never throws on
// junk. Run with `pnpm check:mask`. No network, no database.
//
// This guards a PRIVACY property, which is why it is a check and not a
// comment: the next person to "improve" the mask should have to argue
// with a failing script rather than with prose.

import { maskEmail } from './maskEmail.js';

let failed = 0;
function eq(got: unknown, want: unknown, what: string): void {
  if (got !== want) {
    console.error(`✗ ${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    failed++;
  }
}

eq(maskEmail('sashko@gmail.com'), 'sa•••@gmail.com', 'ordinary address');
eq(maskEmail('ab@example.com'), 'a•••@example.com', 'two-character local part');
eq(maskEmail('a@example.com'), '•••@example.com', 'one-character local part');
eq(maskEmail('first.last+tag@sub.domain.co.uk'), 'fi•••@sub.domain.co.uk', 'plus tag and subdomain');
eq(maskEmail('UPPER@Example.COM'), 'UP•••@Example.COM', 'case is left alone');
eq(maskEmail(null), null, 'null passes through');
eq(maskEmail(undefined), null, 'undefined passes through');
eq(maskEmail(''), null, 'empty passes through');
eq(maskEmail('nobody'), '•••', 'no @ reveals nothing');
eq(maskEmail('@domain.com'), '•••', 'empty local part reveals nothing');

// The length of the address must not be recoverable from the mask.
const a = maskEmail('bo@gmail.com');
const b = maskEmail('bonifaciusmaximus@gmail.com');
if (a && b && a.length !== b.length - 1) {
  // 'b' + 3 bullets + domain vs 'bo' + 3 bullets + domain — one char of
  // difference comes from the revealed prefix, never from the mask.
  console.error(`✗ mask length leaks: ${a} vs ${b}`);
  failed++;
}

// Nothing but the first two characters of the local part may survive.
for (const addr of ['secretive@x.com', 'zz-top-9@y.org', 'ЯрославЛ@пошта.укр']) {
  const out = maskEmail(addr)!;
  const local = addr.slice(0, addr.lastIndexOf('@'));
  const revealed = out.slice(0, out.indexOf('•'));
  if (!local.startsWith(revealed) || revealed.length > 2) {
    console.error(`✗ over-revealed ${addr} → ${out}`);
    failed++;
  }
  const hidden = local.slice(revealed.length);
  if (hidden.length > 2 && out.includes(hidden)) {
    console.error(`✗ hidden part still present: ${addr} → ${out}`);
    failed++;
  }
}

if (failed) process.exit(1);
console.log('✓ mask: 2 characters, 3 bullets, domain — no length, no more');
