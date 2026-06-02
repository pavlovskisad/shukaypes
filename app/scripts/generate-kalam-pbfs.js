// One-shot PBF generator. Reads Kalam-Regular.ttf, emits 256-char
// range PBFs to app/public/fonts/Kalam Regular/. MapLibre fetches
// these via the style's glyphs URL pattern at runtime.
//
// Generates the first 256 ranges (covers Unicode codepoints 0-65535),
// which is more than enough for Latin + Cyrillic (Ukrainian needs both).
const fs = require('fs');
const path = require('path');
const fontnik = require('fontnik');

const TTF = '/tmp/kalam-extracted/Kalam-Regular.ttf';
const OUT_DIR = path.join(__dirname, '..', 'public', 'fonts', 'Kalam Regular');

fs.mkdirSync(OUT_DIR, { recursive: true });
const fontData = fs.readFileSync(TTF);

async function run() {
  const ranges = [];
  for (let start = 0; start < 65536; start += 256) ranges.push(start);
  let written = 0;
  let skipped = 0;
  for (const start of ranges) {
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
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
