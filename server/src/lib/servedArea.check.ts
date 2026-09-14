// The served-area box exists twice on purpose. The client reads
// SERVED_AREA from the shared package; the server cannot load that
// package at runtime (its main is a .ts file and dist is plain node), so
// pipeline/upsert.ts carries its own KYIV_BBOX, which the ingest gate and
// the Places spend gate already share. This check reads the shared file
// as text — importing it would pull a file from outside the server's
// rootDir into its build — and fails the moment the two differ.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { KYIV_BBOX, inKyivBbox } from './servedArea.js';

let failed = 0;
function check(name: string, ok: boolean) {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
}

const sharedPath = fileURLToPath(new URL('../../../shared/types/index.ts', import.meta.url));
const shared = readFileSync(sharedPath, 'utf8');
const block = /export const SERVED_AREA = \{([^}]*)\}/.exec(shared)?.[1] ?? '';
check('shared SERVED_AREA found', block.length > 0);
for (const side of ['north', 'south', 'west', 'east'] as const) {
  const m = new RegExp(`${side}:\\s*(-?\\d+(?:\\.\\d+)?)`).exec(block);
  const value = m ? Number(m[1]) : NaN;
  check(`${side}: shared ${value} = server ${KYIV_BBOX[side]}`, value === KYIV_BBOX[side]);
}

const cases: Array<[string, number, number, boolean]> = [
  ['Maidan', 50.4501, 30.5234, true],
  ['Boyarka (map bounds corner)', 50.3, 30.28, true],
  ['Brovary', 50.51, 30.79, true],
  ['Boryspil airport', 50.345, 30.895, true],
  ['sixty km south-west (jammed, 14 Sep)', 50.0, 29.8, false],
  ['Lima', -12.05, -77.04, false],
];
for (const [name, lat, lng, want] of cases) {
  check(`${name} ${want ? 'inside' : 'outside'}`, inKyivBbox(lat, lng) === want);
}

if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
