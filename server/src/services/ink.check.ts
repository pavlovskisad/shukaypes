// Fixture check for the ink pass (services/ink.ts): a thin grey
// anti-aliased line on white, with a transparent margin, comes out as
// pure black and white, fatter, and not straight. Run with
// `pnpm check:ink`. No network, no model.

import { PNG } from 'pngjs';
import { inkify } from './ink.js';

function drawing(): Buffer {
  const w = 256;
  const h = 256;
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      // Transparent margin, paper inside, a 1-px grey line at y = 128
      // and a soft 3-px vertical line at x = 64.
      const margin = x < 8 || y < 8 || x >= w - 8 || y >= h - 8;
      let v = 255;
      if (y === 128 && x >= 32 && x < 224) v = 90;
      if (Math.abs(x - 64) <= 1 && y >= 32 && y < 224) v = Math.abs(x - 64) === 0 ? 20 : 140;
      png.data[p] = v;
      png.data[p + 1] = v;
      png.data[p + 2] = v;
      png.data[p + 3] = margin ? 0 : 255;
    }
  }
  return PNG.sync.write(png);
}

function fail(msg: string): never {
  console.error(`✗ ink: ${msg}`);
  process.exit(1);
}

const src = drawing();
const out = PNG.sync.read(inkify(src));
if (out.width !== 256 || out.height !== 256) fail('size changed');

let black = 0;
let other = 0;
const rows = new Set<number>();
for (let i = 0; i < out.data.length; i += 4) {
  const [r, g, b, a] = [out.data[i]!, out.data[i + 1]!, out.data[i + 2]!, out.data[i + 3]!];
  if (a !== 255) fail('output must be opaque');
  if (r === 0 && g === 0 && b === 0) {
    black++;
    rows.add(Math.floor(i / 4 / 256));
  } else if (!(r === 255 && g === 255 && b === 255)) other++;
}
if (other > 0) fail(`${other} pixels are neither black nor white`);
// Source ink: ~192 + ~3×192 px, of which the soft line's grey fringe
// falls under the threshold. At 256 px the nib scales to 1 px, so the
// ink roughly doubles, less what the warp carries past the edge — and
// it is still a small share of the paper.
if (black < 1200) fail(`too little ink: ${black}`);
if (black > 256 * 256 * 0.25) fail(`too much ink: ${black}`);
// The horizontal line was one row; wobbled and thickened it spans many.
if (rows.size < 8) fail(`line did not wobble: ${rows.size} rows`);

// Deterministic: the same bytes ink the same way.
if (!inkify(src).equals(inkify(src))) fail('not deterministic');

console.log(`✓ ink: pure black on white, ${black} px of ink over ${rows.size} rows, deterministic`);
