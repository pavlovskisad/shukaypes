// Fixture check for first-party report composition.
// Run with: pnpm --filter @shukajpes/server check:owner-report
//
// The one invariant that must never break: the PIN LINE carries no
// contacts. The full post carries them on purpose (the owner typed a
// phone into a lost-pet form so finders can call), but the pin line is
// serialized into map payloads that go to every walker every 15s.

import { composeOwnerReport, TG_CAPTION_MAX } from './ownerReport.js';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    failures++;
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

{
  const r = composeOwnerReport({
    species: 'dog',
    name: 'Бусинка',
    description: 'Руда дворняга, червоний нашийник, загубилась біля Контрактової.',
    contactPhone: '+380 67 555 12 34',
  });
  check('phone is in the post', r.postText.includes('067') || r.postText.includes('67 555'));
  check('phone is NOT on the pin', !/\d{3}/.test(r.description), r.description);
  check('name flows through', r.name === 'Бусинка');
  check('species word in the post', r.postText.includes('Загубився пес'));
  check('dog emoji', r.emoji === '🐕');
}

{
  // A phone typed into the description field, despite the phone field
  // existing — the reason the pin line runs through redactContacts.
  const r = composeOwnerReport({
    species: 'cat',
    description: 'Сірий кіт, дзвоніть 0675551234, дуже боязкий',
  });
  check('phone in description never reaches the pin', !/\d{5}/.test(r.description), r.description);
  check('unnamed cat gets a descriptor', r.name === 'безіменний кіт', r.name);
  check('cat emoji', r.emoji === '🐈');
}

{
  // Telegram's caption limit is a hard 400 from the API, not a nicety.
  const r = composeOwnerReport({
    species: 'dog',
    description: 'дуже '.repeat(400) + 'загубився',
  });
  check('caption fits telegram', [...r.caption].length <= TG_CAPTION_MAX, String(r.caption.length));
  check('full post keeps everything the cap cut', r.postText.length >= r.caption.length);
}

{
  // Whitespace collapses; nothing invents content.
  const r = composeOwnerReport({ species: 'dog', description: '  пес   зник\n\nучора  ' });
  check('whitespace collapses', r.description === 'пес зник учора', r.description);
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('✓ owner reports: contacts stay in the post, never on the pin');
