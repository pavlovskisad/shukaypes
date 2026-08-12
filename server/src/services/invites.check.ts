// Fixture check for the invite gate's one dangerous decision.
// Run with: pnpm --filter @shukajpes/server check:invites
//
// The failure mode this guards is not a leak, it is a lockout. There are
// several hundred accounts whose entire credential is a device id in a
// browser's localStorage — no email, no password, no account merge, no
// recovery. If the gate is ever asked of an existing account, every one
// of those people loses their pet, their territory and their companion's
// memory of them, permanently, and the only symptom is a 403 they cannot
// do anything about.
//
// So the invariant is checked exhaustively rather than trusted to the
// order of two branches: hasExistingAccount must dominate every other
// input. No configuration, present or future, may make it otherwise.

import { mustPresentInvite, normaliseCode } from '../lib/inviteGate.js';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    failures++;
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ---- THE INVARIANT: existing accounts are never gated ----

for (const required of [true, false]) {
  check(
    `existing account is never asked for a code (required=${required})`,
    mustPresentInvite({ hasExistingAccount: true, required }) === false,
  );
}

// ---- New accounts follow the flag ----

check(
  'new account is gated when invites are required',
  mustPresentInvite({ hasExistingAccount: false, required: true }) === true,
);
check(
  'new account is not gated when invites are off',
  mustPresentInvite({ hasExistingAccount: false, required: false }) === false,
);

// ---- Ships dormant ----
//
// With INVITE_REQUIRED unset the gate must be inert, so merging this
// changes nothing for anybody until there are codes to hand out.
delete process.env.INVITE_REQUIRED;
check(
  'gate is inert when INVITE_REQUIRED is unset',
  mustPresentInvite({ hasExistingAccount: false }) === false,
);
process.env.INVITE_REQUIRED = '1';
check(
  'gate engages when INVITE_REQUIRED=1',
  mustPresentInvite({ hasExistingAccount: false }) === true,
);
check(
  'and STILL does not touch existing accounts',
  mustPresentInvite({ hasExistingAccount: true }) === false,
);
delete process.env.INVITE_REQUIRED;

// ---- Code normalisation ----

check('codes are case-insensitive', normaliseCode('  walkkyiv ') === 'WALKKYIV');
check('empty is rejected', normaliseCode('') === null);
check('undefined is rejected', normaliseCode(undefined) === null);
check('too short is rejected', normaliseCode('abc') === null);
check('overlong is rejected', normaliseCode('x'.repeat(33)) === null);

if (failures === 0) {
  console.log('✓ invite gate: existing accounts are never locked out');
} else {
  console.error(`\n✗ ${failures} case(s) failed`);
  process.exit(1);
}
