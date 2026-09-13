// DRAW THE BOT ROSTER'S PORTRAITS. D-73.
//
// One drawing per roster entry (services/botAvatars.ts), made the way a
// person's portrait is made (D-72) minus the photo a bot does not have:
// the describe recipe — the entry's one-line description, the two
// sample drawings, the short prompt — through the image model, then the
// app's own ink pass, into assets/bot-avatars/<i>.png. The files are
// committed and ship in the image; the bots cron reads them at spawn.
//
// Skips entries that already have a file, so a re-run only draws what is
// missing; pass an index to redraw one on purpose. Each drawing is a paid
// call, a few cents; the whole roster is about a dollar.
//
// READ-ONLY toward the app: no database, no Telegram, nothing stored but
// the files. Needs FAL_KEY; the key is never printed.
//
// Usage (from server/):
//   FAL_KEY=… pnpm bots:avatars          every entry without a file
//   FAL_KEY=… pnpm bots:avatars 7        redraw entry 7
//   FAL_KEY=… pnpm bots:avatars 7 8 9    redraw several

import fs from 'node:fs';
import path from 'node:path';
import { REF_FILES, describeBody } from '../services/avatar.js';
import { inkify } from '../services/ink.js';
import { BOT_ROSTER, botAvatarFile, botAvatarsDir } from '../services/botAvatars.js';

const KEY = process.env.FAL_KEY?.trim();
if (!KEY) {
  console.error('FAL_KEY is not set — nothing to draw with.');
  process.exit(1);
}
const ENDPOINT = process.env.FAL_API_URL?.trim() || 'https://fal.run/fal-ai/nano-banana/edit';

const refsDir = process.env.AVATAR_REFS_DIR?.trim() || path.join(process.cwd(), 'assets', 'avatar-refs');
const refs = REF_FILES.map(
  (f) => `data:image/png;base64,${fs.readFileSync(path.join(refsDir, f)).toString('base64')}`,
);
fs.mkdirSync(botAvatarsDir(), { recursive: true });

const wanted = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < BOT_ROSTER.length);
const todo = wanted.length ? wanted : BOT_ROSTER.map((_, i) => i).filter((i) => !fs.existsSync(botAvatarFile(i)));
console.log(`${todo.length} to draw${wanted.length ? '' : ' (missing files)'}`);

interface FalResponse {
  images?: { url?: string; content_type?: string }[];
  detail?: unknown;
}

let drawn = 0;
for (const i of todo) {
  const e = BOT_ROSTER[i]!;
  const t0 = Date.now();
  try {
    const body = describeBody(refs, e.description, { species: 'dog', breed: e.breed }, null);
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Key ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    const json = (await res.json().catch(() => null)) as FalResponse | null;
    const img = json?.images?.[0];
    if (!res.ok || !img?.url) {
      console.log(JSON.stringify({ i, name: e.name, status: res.status, detail: JSON.stringify(json).slice(0, 200) }));
      continue;
    }
    const raw = Buffer.from(await (await fetch(img.url)).arrayBuffer());
    const png = img.content_type === 'image/png' || raw.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    if (!png) {
      console.log(JSON.stringify({ i, name: e.name, err: `not a PNG: ${img.content_type}` }));
      continue;
    }
    fs.writeFileSync(botAvatarFile(i), inkify(raw));
    drawn++;
    console.log(JSON.stringify({ i, name: e.name, breed: e.breed, ms: Date.now() - t0, bytes: raw.length }));
  } catch (err) {
    console.log(JSON.stringify({ i, name: e.name, err: String(err).slice(0, 200) }));
  }
}
console.log(`done — ${drawn} drawn into ${botAvatarsDir()}`);
