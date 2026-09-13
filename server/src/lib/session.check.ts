// Fixture check for session tokens.
// Run with: pnpm --filter @shukajpes/server check:session
//
// The failure modes this guards, in the order they would hurt:
//   - a token that verifies under no secret, or under the wrong one
//     (anyone could mint one);
//   - a tampered payload that still verifies (change `u`, be somebody
//     else);
//   - an expired token that still verifies (a stolen one lives forever);
//   - a token minted under one key still verifying after rotation.
// And the quieter one: a deployment with no secret configured must
// behave exactly as one that has never heard of tokens — nothing
// minted, nothing verified, identity resolved the old way.

import {
  SESSION_RENEW_WINDOW_S,
  SESSION_TTL_S,
  mintSession,
  sessionNeedsRenewal,
  sessionSecret,
  verifySession,
} from './session.js';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    failures++;
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function withEnv(env: { secret?: string; bot?: string }, run: () => void): void {
  const prevSecret = process.env.SESSION_SECRET;
  const prevBot = process.env.TELEGRAM_BOT_TOKEN;
  if (env.secret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = env.secret;
  if (env.bot === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = env.bot;
  try {
    run();
  } finally {
    if (prevSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = prevSecret;
    if (prevBot === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = prevBot;
  }
}

const NOW = 1_800_000_000;
const CLAIMS = { userId: 'user_abc', deviceId: 'tg:123456', via: 'telegram' as const };

// ---- No secret of any kind: tokens are off, and off means OFF ----
withEnv({}, () => {
  check('no secret → no secret', sessionSecret() === null);
  check('no secret → mint returns null', mintSession(CLAIMS, NOW) === null);
  check('no secret → nothing verifies', verifySession('v1.e30.AAAA', NOW) === null);
});

// ---- A short explicit secret is not a secret ----
withEnv({ secret: 'short' }, () => {
  check('short SESSION_SECRET is ignored', sessionSecret() === null);
});

// ---- Derived from the bot token when no explicit secret ----
withEnv({ bot: '123456:ABC-DEF' }, () => {
  const s = sessionSecret();
  check('bot token → derived secret', s !== null && s.length === 32);
  const t = mintSession(CLAIMS, NOW);
  check('bot-derived key mints', typeof t === 'string');
  check('bot-derived key verifies', verifySession(t ?? undefined, NOW)?.userId === 'user_abc');
  check(
    'derived secret is not the bot token itself',
    s !== null && !s.equals(Buffer.from('123456:ABC-DEF', 'utf8')),
  );
});

// ---- Round trip, shape, and every way it must fail ----
withEnv({ secret: 'a-perfectly-adequate-session-secret' }, () => {
  const token = mintSession(CLAIMS, NOW);
  check('mints a token', typeof token === 'string');
  if (!token) process.exit(1);
  check('token is v1.<payload>.<sig>', token.split('.').length === 3 && token.startsWith('v1.'));
  check('token is small', token.length < 320, `${token.length} chars`);

  const claims = verifySession(token, NOW);
  check('verifies', claims !== null);
  check('carries the user', claims?.userId === 'user_abc');
  check('carries the device id', claims?.deviceId === 'tg:123456');
  check('carries via', claims?.via === 'telegram');
  check('expires one TTL out', claims?.expiresAt === NOW + SESSION_TTL_S);

  // Expiry
  check('valid just before expiry', verifySession(token, NOW + SESSION_TTL_S - 1) !== null);
  check('expired at expiry', verifySession(token, NOW + SESSION_TTL_S) === null);
  check('expired well after', verifySession(token, NOW + 10 * SESSION_TTL_S) === null);

  // Renewal window
  check('fresh token does not renew', !sessionNeedsRenewal(claims!, NOW));
  check(
    'token in its last hours renews',
    sessionNeedsRenewal(claims!, NOW + SESSION_TTL_S - SESSION_RENEW_WINDOW_S + 1),
  );

  // Tampering: change the payload, keep the signature
  const [v, payload, sig] = token.split('.') as [string, string, string];
  const forged = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  forged.u = 'somebody_else';
  const forgedPayload = Buffer.from(JSON.stringify(forged)).toString('base64url');
  check('tampered payload does not verify', verifySession(`${v}.${forgedPayload}.${sig}`, NOW) === null);
  // Tampering: flip a character of the signature
  const flipped = sig[0] === 'A' ? 'B' : 'A';
  check('tampered signature does not verify', verifySession(`${v}.${payload}.${flipped}${sig.slice(1)}`, NOW) === null);
  // Wrong version, wrong shape, junk
  check('wrong version rejected', verifySession(`v2.${payload}.${sig}`, NOW) === null);
  check('two-part token rejected', verifySession(`v1.${payload}`, NOW) === null);
  check('empty rejected', verifySession('', NOW) === null);
  check('undefined rejected', verifySession(undefined, NOW) === null);
  check('oversized rejected', verifySession('v1.' + 'a'.repeat(5000) + '.b', NOW) === null);

  // A payload from the future (clock skew beyond tolerance)
  const future = mintSession(CLAIMS, NOW + 3600);
  check('token from the future rejected', verifySession(future ?? undefined, NOW) === null);
  // A payload claiming a longer life than the TTL, signed correctly
  const long = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  long.exp = NOW + 30 * SESSION_TTL_S;
  const longPayload = Buffer.from(JSON.stringify(long)).toString('base64url');
  check(
    'over-long lifetime rejected even if it were signed',
    verifySession(`${v}.${longPayload}.${sig}`, NOW) === null,
  );

  // Device-id sessions carry the raw device id
  const dev = mintSession({ userId: 'u2', deviceId: 'deadbeefdeadbeef', via: 'device' }, NOW);
  const devClaims = verifySession(dev ?? undefined, NOW);
  check('device session verifies', devClaims?.via === 'device' && devClaims.deviceId === 'deadbeefdeadbeef');
});

// ---- Rotation: a token minted under one key dies with it ----
let minted: string | null = null;
withEnv({ secret: 'first-secret-first-secret' }, () => {
  minted = mintSession(CLAIMS, NOW);
});
withEnv({ secret: 'second-secret-second-secret' }, () => {
  check('token from the previous key does not verify', verifySession(minted ?? undefined, NOW) === null);
});
withEnv({ bot: '999:other' }, () => {
  check('explicit-key token does not verify under a derived key', verifySession(minted ?? undefined, NOW) === null);
});

if (failures > 0) {
  console.error(`session check: ${failures} failure(s)`);
  process.exit(1);
}
console.log('session check: ✓ mint, verify, expiry, renewal, tamper, rotation, and off-when-unconfigured');
