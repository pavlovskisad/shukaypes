// Issue, list and revoke beta invite codes.
//
// The gate itself is dormant until INVITE_REQUIRED=1, so the useful
// order is: issue codes here, hand them out, confirm they work, then
// turn the gate on. Doing it the other way round shuts the door before
// anybody has a key.
//
// Usage:
//   list            pnpm --filter @shukajpes/server invite
//   issue one       pnpm --filter @shukajpes/server invite -- --new --note="kyiv dog walkers tg"
//   issue multi-use pnpm --filter @shukajpes/server invite -- --new --uses=25 --note="cohort 1"
//   revoke          pnpm --filter @shukajpes/server invite -- --revoke=WALKKYIV
//
//   production      fly ssh console -a shukajpes-api -C "node dist/db/invite.js --new --uses=25"
//
// Codes are readable on purpose — somebody types these into a phone, or
// reads them aloud. No 0/O/1/I/L, so nobody has to guess which is which.

import 'dotenv/config';
import { desc, eq, sql } from 'drizzle-orm';
import { pathToFileURL } from 'url';
import { db, schema, pg } from './index.js';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateCode(len = 8): string {
  const bytes = new Uint8Array(len);
  // Not security-critical — a code only admits somebody to a beta, and
  // used_count bounds the damage — but there is no reason to reach for a
  // weaker source than the one already available.
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function main() {
  const revoke = arg('revoke');
  if (revoke) {
    const code = revoke.trim().toUpperCase();
    const updated = await db
      .update(schema.inviteCodes)
      .set({ revokedAt: new Date() })
      .where(eq(schema.inviteCodes.code, code))
      .returning({ code: schema.inviteCodes.code });
    console.log(updated.length ? `revoked ${code}` : `no such code: ${code}`);
    // Deliberately does NOT remove the accounts it admitted. Revoking
    // stops further use; it is not a way to un-invite people who are
    // already walking.
    return;
  }

  if (process.argv.includes('--new')) {
    const uses = Number(arg('uses') ?? 1);
    const note = arg('note');
    const code = generateCode();
    await db.insert(schema.inviteCodes).values({
      code,
      maxUses: Number.isFinite(uses) && uses > 0 ? Math.floor(uses) : 1,
      note: note ?? null,
    });
    console.log(`\n  ${code}    (${uses} use${uses === 1 ? '' : 's'})${note ? `  — ${note}` : ''}\n`);
    console.log(`  web       https://shukaypes.vercel.app/?invite=${code}`);
    console.log(`  telegram  https://t.me/<bot>?startapp=${code}\n`);
    return;
  }

  const rows = await db
    .select({
      code: schema.inviteCodes.code,
      maxUses: schema.inviteCodes.maxUses,
      usedCount: schema.inviteCodes.usedCount,
      note: schema.inviteCodes.note,
      revokedAt: schema.inviteCodes.revokedAt,
      createdAt: schema.inviteCodes.createdAt,
    })
    .from(schema.inviteCodes)
    .orderBy(desc(schema.inviteCodes.createdAt));

  const gateOn = process.env.INVITE_REQUIRED?.trim().toLowerCase();
  const enabled = gateOn === '1' || gateOn === 'true' || gateOn === 'yes';
  console.log(
    `\ninvite gate: ${enabled ? 'ON — new accounts need a code' : 'OFF — anyone can sign up (INVITE_REQUIRED unset)'}`,
  );

  if (rows.length === 0) {
    console.log('\nno codes issued yet. --new to make one.\n');
    return;
  }
  console.log(`\n${rows.length} code(s):\n`);
  for (const r of rows) {
    const state = r.revokedAt ? 'REVOKED' : r.usedCount >= r.maxUses ? 'used up' : 'live';
    console.log(
      `  ${r.code}  ${String(r.usedCount).padStart(3)}/${String(r.maxUses).padEnd(3)}  ${state.padEnd(8)}  ${r.note ?? ''}`,
    );
  }

  const [{ redeemed } = { redeemed: 0 }] = await db
    .select({ redeemed: sql<number>`count(*)::int` })
    .from(schema.inviteRedemptions);
  console.log(`\n${redeemed} account(s) admitted by code.\n`);
}

const isEntry = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isEntry) {
  main()
    .then(() => pg.end())
    .catch((err) => {
      console.error(err);
      pg.end().finally(() => process.exit(1));
    });
}
