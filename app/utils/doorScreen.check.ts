// Fixture check for which screen the door opens on (utils/doorScreen.ts).
// Run with `pnpm check`. No network, no database, no React.
//
// The bug it exists for was not visible in a static reading: every
// line of the old pickScreen was defensible on its own, and the one
// that broke registration only fired after a logout — state a reload
// cleared. So the cases below are written as SEQUENCES a person walks
// through, not as a table of inputs.

import { pickDoorScreen, type DoorMe, type DoorScreen } from './doorScreen.js';

function fail(msg: string): never {
  console.error(`✗ door: ${msg}`);
  process.exit(1);
}

function expect(got: DoorScreen, want: DoorScreen, what: string): void {
  if (got !== want) fail(`${what}: expected ${want}, got ${got}`);
}

const SHUT: DoorMe = { door: 'register' };
const WAITING: DoorMe = { door: 'verify' };
const OPEN: DoorMe = { door: 'open' };

// ------------------------------------------------ the two answers

// A first-time visitor. The dog asks, they say they are new.
expect(pickDoorScreen('register', SHUT, null), 'register', 'a fresh visitor asking to register');
expect(pickDoorScreen('login', SHUT, null), 'login', 'a fresh visitor asking to log in');

// THE BUG THAT SHIPPED. Somebody logs out from the profile (which set
// doorPrefer = 'login'), lands back at the gate, and answers «ні,
// давай познайомимось!» — a different person on the same phone, or
// the same one making a second account. They got the LOGIN screen, and
// no tap anywhere reached registration until the page was reloaded.
//
// There is no argument left in this function for a preference to
// arrive in. That is the fix: the answer is the answer.
expect(
  pickDoorScreen('register', SHUT, null),
  'register',
  'asking to register after a logout in the same session',
);
expect(pickDoorScreen('login', SHUT, null), 'login', 'asking to log in after a logout');

// ------------------------------------------------ the server wins

// A reset link in hand beats any answer — that is where the account
// actually is, and nothing else can be done until the password is set.
expect(pickDoorScreen('register', SHUT, 'tok'), 'reset', 'a held reset token over a register tap');
expect(pickDoorScreen('login', SHUT, 'tok'), 'reset', 'a held reset token over a login tap');
expect(pickDoorScreen('reset', null, 'tok'), 'reset', 'the reset sheet with its token');

// An account waiting on its letter cannot register again or log in.
expect(pickDoorScreen('register', WAITING, null), 'verify', 'a register tap while waiting to verify');
expect(pickDoorScreen('login', WAITING, null), 'verify', 'a login tap while waiting to verify');

// ------------------------------------------------ the portrait step

// The portrait comes after the door, so with the door shut it IS the
// door that shows.
expect(pickDoorScreen('avatar', OPEN, null), 'avatar', 'the portrait step with the door open');
expect(pickDoorScreen('avatar', SHUT, null), 'register', 'the portrait step with the door shut');
expect(pickDoorScreen('avatar', null, null), 'register', 'the portrait step before /auth/me answered');

// ------------------------------------------- screens with no state

// 'verify' and 'reset' are only asked for alongside the state that
// makes them mean something, and both are handled above. Arriving here
// means that state is gone — a spent link, an account already through
// — and the sheet falls back rather than showing a dead screen.
expect(pickDoorScreen('verify', SHUT, null), 'register', 'a verify sheet with nothing to verify');
expect(pickDoorScreen('reset', SHUT, null), 'register', 'a reset sheet with no token');
expect(pickDoorScreen('verify', OPEN, null), 'register', 'a verify sheet for an account already through');

console.log('✓ door: the answer at the gate wins; only a reset token or an unverified account override it');
