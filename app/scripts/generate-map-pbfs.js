// One-shot PBF generator for MapLibre map labels.
//
// Reads a TTF, emits 256-char range PBFs into
// app/public/fonts/<font-name>/. MapLibre fetches these at runtime
// via the style's `glyphs` URL pattern (set in crayonStyle's
// fetchCrayonStyleSpec to `${origin}/fonts/{fontstack}/{range}.pbf`).
//
// Usage:
//   node app/scripts/generate-map-pbfs.js <path-to.ttf> "<Font Name>"
//
// Example:
//   node app/scripts/generate-map-pbfs.js /tmp/MyFont.ttf "MyFont Regular"
//
// After it finishes, set MAP_FONT in crayonStyle.ts to "<Font Name>"
// so the map's `text-font` references the new directory.

const fs = require('fs');
const path = require('path');
const fontnik = require('fontnik');

const TTF = process.argv[2];
const FONT_NAME = process.argv[3];
if (!TTF || !FONT_NAME) {
  console.error('Usage: node generate-map-pbfs.js <path-to.ttf> "<Font Name>"');
  process.exit(1);
}

const OUT_DIR = path.join(__dirname, '..', 'public', 'fonts', FONT_NAME);
fs.mkdirSync(OUT_DIR, { recursive: true });
const fontData = fs.readFileSync(TTF);

async function run() {
  let written = 0;
  let skipped = 0;
  for (let start = 0; start < 65536; start += 256) {
    const end = start + 255;
    await new Promise((resolve) => {
      fontnik.range({ font: fontData, start, end }, (err, data) => {
        if (err) {
          skipped++;
          resolve();
          return;
        }
        const file = path.join(OUT_DIR, `${start}-${end}.pbf`);
        fs.writeFileSync(file, data);
        written++;
        resolve();
      });
    });
  }
  console.log(`Done. Wrote ${written} PBFs, skipped ${skipped} empty ranges.`);
  console.log(`Output dir: ${OUT_DIR}`);
  console.log(`Next: set MAP_FONT in app/components/map/crayonStyle.ts to "${FONT_NAME}".`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
