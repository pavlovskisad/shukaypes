// One-shot PBF generator. Reads Caveat TTF, emits 256-char range PBFs
// to app/public/fonts/Caveat Regular/. MapLibre fetches these via the
// style's glyphs URL pattern at runtime.
const fs = require('fs');
const path = require('path');
const fontnik = require('fontnik');

const TTF = process.argv[2] || '/tmp/Caveat.ttf';
const OUT_DIR = path.join(__dirname, '..', 'public', 'fonts', 'Caveat Regular');

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
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
