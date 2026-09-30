// Fixture check for the ad's phone links (utils/phoneLinks.ts).
// Run with `pnpm check`. No network, no database, no React.

import { splitPhones } from './phoneLinks.js';

function fail(msg: string): never {
  console.error(`✗ phones: ${msg}`);
  process.exit(1);
}

function tels(text: string): string[] {
  return splitPhones(text).flatMap((p) => (p.kind === 'phone' ? [p.tel] : []));
}

function expect(text: string, want: string[]): void {
  const got = tels(text);
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(`${JSON.stringify(text)}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
  // The pieces must put the ad back together exactly — a link that eats
  // a space or a letter changes what the owner wrote.
  const joined = splitPhones(text).map((p) => p.value).join('');
  if (joined !== text) fail(`${JSON.stringify(text)}: parts rejoin as ${JSON.stringify(joined)}`);
}

const N = 'tel:+380671234567';
expect('0671234567', [N]);
expect('тел. 067 123 45 67, Олена', [N]);
expect('(067) 123-45-67', [N]);
expect('+38 067 123 45 67', [N]);
expect('+380671234567', [N]);
expect('380671234567', [N]);
expect('067.123.45.67 або 050 765 43 21', [N, 'tel:+380507654321']);
// Masked by OLX: nothing to dial.
expect('05*******62', []);
// Longer digit runs are ids and prices, not phones.
expect('оголошення 90671234567123', []);
expect('винагорода 5000 грн', []);
expect('0671234567,0507654321', [N, 'tel:+380507654321']);
expect('', []);

console.log('✓ phones: all cases pass');
