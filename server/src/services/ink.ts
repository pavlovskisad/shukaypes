// OUR OWN INK, over the model's drawing. D-72.
//
// The model draws the right animal in something near the illustrator's
// hand and still comes back a touch neat: a thinner line than the
// posters, precise edges, tidy hatching. Three of those are not about
// what was drawn but about how the line sits on the paper, and that
// part the app can do itself, the way the UI's frames are drawn by the
// app (D-70) rather than shipped as pictures:
//
//   1. THRESHOLD to pure black and white — no grey, no anti-aliasing
//      wash; a marker leaves ink or it does not.
//   2. THICKEN the line to marker weight. The posters' line is ~8 px of
//      1200; the model's is ~3 px of 1024. Dilation by a square kernel
//      brings it up. Fine hatching merges into darker patches, which is
//      what a fat marker does to fine hatching.
//   3. WOBBLE: a smooth random displacement of the whole drawing, a few
//      pixels, so no edge is straight and no curve is clean. Seeded from
//      the bytes, so the same drawing inks the same way twice and a
//      redraw inks differently.
//
// Pure JS over pngjs, no native image library; a 1024² drawing takes
// tens of milliseconds. Transparent pixels count as paper. Off with
// AVATAR_INK=off, and never applied to a non-PNG result.

import { PNG } from 'pngjs';

export interface InkOptions {
  /** Luminance at or below this is ink. 0–255. */
  threshold?: number;
  /** Dilation radius in px at 1024; scaled to the image. */
  weight?: number;
  /** Displacement amplitude in px at 1024; scaled to the image. */
  wobble?: number;
  /** Noise cell size in px at 1024; scaled. Bigger = lazier waves. */
  cell?: number;
}

const DEFAULTS: Required<InkOptions> = { threshold: 160, weight: 3, wobble: 5, cell: 56 };

export function inkEnabled(): boolean {
  return process.env.AVATAR_INK?.trim().toLowerCase() !== 'off';
}

// Deterministic 32-bit hash of the bytes, for the noise seed.
function hashBytes(bytes: Buffer): number {
  let h = 2166136261;
  const step = Math.max(1, Math.floor(bytes.length / 4096));
  for (let i = 0; i < bytes.length; i += step) {
    h ^= bytes[i]!;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smooth value noise on a coarse grid, bilinearly interpolated, in
// [-1, 1]. Two independent fields give dx and dy.
function noiseField(w: number, h: number, cell: number, rnd: () => number): (x: number, y: number) => number {
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const grid = new Float32Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd() * 2 - 1;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / cell;
    const fy = y / cell;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = smooth(fx - x0);
    const ty = smooth(fy - y0);
    const g = (gx: number, gy: number) => grid[gy * gw + gx] ?? 0;
    const a = g(x0, y0) * (1 - tx) + g(x0 + 1, y0) * tx;
    const b = g(x0, y0 + 1) * (1 - tx) + g(x0 + 1, y0 + 1) * tx;
    return a * (1 - ty) + b * ty;
  };
}

/**
 * PNG bytes in, PNG bytes out: black ink on white paper, thickened
 * and wobbled. Throws on bytes pngjs cannot parse.
 */
export function inkify(png: Buffer, opts: InkOptions = {}): Buffer {
  const o = { ...DEFAULTS, ...opts };
  const src = PNG.sync.read(png);
  const { width: w, height: h, data } = src;
  const scale = Math.max(w, h) / 1024;
  const radius = Math.max(0, Math.round(o.weight * scale));
  const amp = o.wobble * scale;
  const cell = Math.max(8, o.cell * scale);

  // 1. Binary ink mask. Transparent = paper.
  const ink = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < ink.length; i++, p += 4) {
    const a = data[p + 3]!;
    if (a < 128) continue;
    const lum = 0.299 * data[p]! + 0.587 * data[p + 1]! + 0.114 * data[p + 2]!;
    // Semi-transparent edge pixels lean toward paper.
    const eff = lum + ((255 - a) / 255) * 255;
    if (eff <= o.threshold) ink[i] = 1;
  }

  // 2. Dilate, separably (a square kernel is a marker's nib, near enough).
  let mask = ink;
  if (radius > 0) {
    const tmp = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let v = 0;
        for (let k = -radius; k <= radius && !v; k++) {
          const xx = x + k;
          if (xx >= 0 && xx < w && mask[row + xx]) v = 1;
        }
        tmp[row + x] = v;
      }
    }
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = 0;
        for (let k = -radius; k <= radius && !v; k++) {
          const yy = y + k;
          if (yy >= 0 && yy < h && tmp[yy * w + x]) v = 1;
        }
        out[y * w + x] = v;
      }
    }
    mask = out;
  }

  // 3. Wobble: sample the mask through a smooth displacement field.
  const rnd = mulberry32(hashBytes(png));
  const nx = noiseField(w, h, cell, rnd);
  const ny = noiseField(w, h, cell, rnd);
  const dst = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.round(x + nx(x, y) * amp);
      const sy = Math.round(y + ny(x, y) * amp);
      const inside = sx >= 0 && sx < w && sy >= 0 && sy < h && mask[sy * w + sx] === 1;
      const p = (y * w + x) * 4;
      const v = inside ? 0 : 255;
      dst.data[p] = v;
      dst.data[p + 1] = v;
      dst.data[p + 2] = v;
      dst.data[p + 3] = 255;
    }
  }
  return PNG.sync.write(dst);
}
