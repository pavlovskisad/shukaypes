// Fixture check for the dev-tools gate.
// Run with: pnpm --filter @shukajpes/server check:dev-auth
//
// The failure mode this guards is a gate that is open when nobody meant
// it to be. `DEV_TOOLS_PASSWORD` unset is the state of every deployment
// nobody is testing against, including production most of the time — and
// the classic way a check like this fails open is an empty configured
// value comparing equal to an empty presented one. Then /territory/reset
// answers for anybody who sends a blank header, and the first anyone
// hears of it is a beta tester whose territory vanished.
//
// So: unset means closed, under every input, including the ones that
// would sail through a naive `presented === configured`.

import { DEV_KEY_HEADER, devAccessAllowed, devRoutesEnabled, hasDevKey } from './devAuth.js';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    failures++;
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const PASSWORD = 'correct-horse-battery-staple';

function withEnv(
  env: { password?: string; devRoutes?: string },
  run: () => void,
): void {
  const prevPassword = process.env.DEV_TOOLS_PASSWORD;
  const prevRoutes = process.env.DEV_ROUTES;
  if (env.password === undefined) delete process.env.DEV_TOOLS_PASSWORD;
  else process.env.DEV_TOOLS_PASSWORD = env.password;
  if (env.devRoutes === undefined) delete process.env.DEV_ROUTES;
  else process.env.DEV_ROUTES = env.devRoutes;
  try {
    run();
  } finally {
    if (prevPassword === undefined) delete process.env.DEV_TOOLS_PASSWORD;
    else process.env.DEV_TOOLS_PASSWORD = prevPassword;
    if (prevRoutes === undefined) delete process.env.DEV_ROUTES;
    else process.env.DEV_ROUTES = prevRoutes;
  }
}

// ---- THE INVARIANT: no configured password means no way in ----

withEnv({}, () => {
  const presentations: (string | string[] | undefined)[] = [
    undefined,
    '',
    ' ',
    'anything',
    'Bearer ',
    'Bearer anything',
    [''],
    ['anything'],
  ];
  for (const presented of presentations) {
    check(
      `unset password refuses ${JSON.stringify(presented)}`,
      hasDevKey(presented) === false,
    );
    check(
      `unset password refuses access for ${JSON.stringify(presented)}`,
      devAccessAllowed(presented) === false,
    );
  }
});

// An empty configured password is a misconfiguration, not an open door.
withEnv({ password: '' }, () => {
  check('empty configured password refuses an empty header', hasDevKey('') === false);
  check('empty configured password refuses undefined', hasDevKey(undefined) === false);
});

// ---- The password works, and only the right one ----

withEnv({ password: PASSWORD }, () => {
  check('correct password is accepted', hasDevKey(PASSWORD) === true);
  check('correct password as a Bearer token is accepted', hasDevKey(`Bearer ${PASSWORD}`) === true);
  check('correct password in an array header is accepted', hasDevKey([PASSWORD]) === true);
  check('wrong password is refused', hasDevKey('wrong') === false);
  // Length-mismatched and prefix cases: the constant-time compare returns
  // early on length, which must not be mistaken for a match.
  check('prefix of the password is refused', hasDevKey(PASSWORD.slice(0, -1)) === false);
  check('password plus a suffix is refused', hasDevKey(`${PASSWORD}x`) === false);
  check('empty header is refused', hasDevKey('') === false);
  check('undefined header is refused', hasDevKey(undefined) === false);
});

// ---- DEV_ROUTES is the other way in, and is independent ----

withEnv({ devRoutes: '1' }, () => {
  check('DEV_ROUTES=1 opens access with no header', devAccessAllowed(undefined) === true);
  check('DEV_ROUTES=1 reports enabled', devRoutesEnabled() === true);
  // Still no password configured, so the header itself proves nothing.
  check('DEV_ROUTES=1 does not make a bogus header valid', hasDevKey('anything') === false);
});

withEnv({ devRoutes: '0' }, () => {
  check('DEV_ROUTES=0 is off', devRoutesEnabled() === false);
  check('DEV_ROUTES=0 refuses access', devAccessAllowed(undefined) === false);
});

withEnv({ devRoutes: 'true' }, () => {
  // Only the literal '1' counts — 'true' is the kind of value somebody
  // sets in a hurry and then believes is off.
  check("DEV_ROUTES='true' is not enabled", devRoutesEnabled() === false);
});

// ---- The header name the routes read is the one the client sends ----

check('header name is x-dev-key', DEV_KEY_HEADER === 'x-dev-key');

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('✓ dev gate: closed unless a password is configured and presented');
