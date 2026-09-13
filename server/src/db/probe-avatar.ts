// DRAW THE SAME THREE PETS THREE WAYS, and look.
//
// The portrait (D-72) has one question left that no test can answer:
// which model and which prompt make a drawing that is the OWNER's pet
// in the ILLUSTRATOR's hand. The first real run (13 Sep) answered one
// thing the hard way: FLUX Kontext's multi-image endpoint, handed a
// reference drawing, draws the reference. So this prints nine pictures
// for a human to compare, rather than a number:
//
//   marker   Kontext, single image, the style in words — what the app
//            ships (services/avatar.ts, AVATAR_RECIPE=marker)
//   nb1      Nano Banana (Gemini image edit) with the photo and ONE of
//            the illustrator's drawings
//   nbAll    Nano Banana with the photo and the app's own reference
//            set (REF_FILES in services/avatar.ts) and prompt — what
//            the app ships (AVATAR_RECIPE=reference)
//
// on three photos that ship in assets/avatar-probe (a lab, a beagle,
// a cat — smooth, patched, whiskered). Each drawing is a paid call,
// a few cents; the whole run is under a dollar. Outputs land in
// ./probe-out (gitignored) with a log.json of status and timings.
//
// READ-ONLY toward the app: no database, no Telegram, nothing stored.
// Needs FAL_KEY in the environment; the key is never printed.
//
// Usage (from server/):
//   FAL_KEY=… pnpm probe:avatar            all nine
//   FAL_KEY=… pnpm probe:avatar nbAll      one recipe
//   FAL_KEY=… pnpm probe:avatar nb1 cat    one recipe, one pet

import fs from 'node:fs';
import path from 'node:path';
import { REF_FILES, avatarPrompt, referenceBody } from '../services/avatar.js';
import { inkify } from '../services/ink.js';

const KEY = process.env.FAL_KEY?.trim();
if (!KEY) {
  console.error('FAL_KEY is not set — nothing to draw with.');
  process.exit(1);
}

// The same seam services/avatar.ts has: the local e2e fake stands in
// for every endpoint when FAL_API_URL is set.
const OVERRIDE = process.env.FAL_API_URL?.trim();
const endpoint = (real: string) => OVERRIDE || real;

const ASSETS = path.join(process.cwd(), 'assets');
const OUT = path.join(process.cwd(), 'probe-out');
fs.mkdirSync(OUT, { recursive: true });

const dataUri = (file: string, mime: string): string =>
  `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
const ref = (name: string) => dataUri(path.join(ASSETS, 'avatar-refs', name), 'image/png');
const photo = (name: string) => dataUri(path.join(ASSETS, 'avatar-probe', name), 'image/jpeg');

const PETS = [
  { id: 'lab', file: 'lab.jpg', species: 'dog', breed: null },
  { id: 'beagle', file: 'beagle.jpg', species: 'dog', breed: null },
  { id: 'cat', file: 'cat.jpg', species: 'cat', breed: null },
] as const;

// The style, said once, for the reference recipes.
const STYLE =
  'thick black felt-tip marker, one uniform line weight, a big simplified head facing the viewer, dot eyes, ' +
  'a solid black nose, hatching only where the fur is shaggy, plain white background and nothing else. ' +
  'No shading, no grey, no colour, no text, no frame.';

type Pet = (typeof PETS)[number];
interface Call {
  url: string;
  body: Record<string, unknown>;
}

const RECIPES: Record<string, (p: Pet) => Call> = {
  marker: (p) => ({
    url: endpoint('https://fal.run/fal-ai/flux-pro/kontext'),
    body: {
      prompt: avatarPrompt({ species: p.species, breed: p.breed }),
      image_url: photo(p.file),
      output_format: 'png',
      aspect_ratio: '1:1',
      safety_tolerance: '2',
    },
  }),
  nb1: (p) => ({
    url: endpoint('https://fal.run/fal-ai/nano-banana/edit'),
    body: {
      prompt:
        `The first image is a photo of a ${p.species}; the second image is a drawing that shows a drawing STYLE only. ` +
        `Draw the ${p.species} from the photo — this exact animal, its own ear shape, muzzle, markings and expression — ` +
        `as a portrait in that style: ${STYLE} Do not draw the animal from the second image.`,
      image_urls: [photo(p.file), ref('mop.png')],
      output_format: 'png',
      aspect_ratio: '1:1',
      num_images: 1,
    },
  }),
  nbAll: (p) => ({
    url: endpoint('https://fal.run/fal-ai/nano-banana/edit'),
    body: referenceBody(photo(p.file), REF_FILES.map(ref), { species: p.species, breed: p.breed }),
  }),
};

interface FalImage {
  url?: string;
  width?: number;
  height?: number;
}
interface FalResponse {
  images?: FalImage[];
  detail?: unknown;
}

const onlyRecipe = process.argv[2];
const onlyPet = process.argv[3];
if (onlyRecipe && !RECIPES[onlyRecipe]) {
  console.error(`unknown recipe ${onlyRecipe}; one of ${Object.keys(RECIPES).join(', ')}`);
  process.exit(1);
}

interface Entry {
  pet: string;
  recipe: string;
  status?: number;
  ms?: number;
  size?: string;
  bytes?: number;
  detail?: string;
  err?: string;
}

const log: Entry[] = [];
for (const pet of PETS) {
  if (onlyPet && onlyPet !== pet.id) continue;
  for (const [name, make] of Object.entries(RECIPES)) {
    if (onlyRecipe && onlyRecipe !== name) continue;
    const t0 = Date.now();
    const { url, body } = make(pet);
    const entry: Entry = { pet: pet.id, recipe: name };
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Key ${KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
      const json = (await res.json().catch(() => null)) as FalResponse | null;
      entry.status = res.status;
      entry.ms = Date.now() - t0;
      const img = json?.images?.[0];
      if (!res.ok || !img?.url) {
        entry.detail = JSON.stringify(json).slice(0, 300);
      } else {
        entry.size = `${img.width ?? '?'}x${img.height ?? '?'}`;
        const bytes = Buffer.from(await (await fetch(img.url)).arrayBuffer());
        fs.writeFileSync(path.join(OUT, `${pet.id}-${name}-raw.png`), bytes);
        // The app's own ink pass (services/ink.ts), so the pair shows
        // what the model did and what the app does to it.
        fs.writeFileSync(path.join(OUT, `${pet.id}-${name}.png`), inkify(bytes));
        entry.bytes = bytes.length;
      }
    } catch (err) {
      entry.err = String(err).slice(0, 200);
    }
    log.push(entry);
    console.log(JSON.stringify(entry));
  }
}
fs.writeFileSync(path.join(OUT, 'log.json'), JSON.stringify(log, null, 1));
console.log(`done — ${log.filter((e) => e.bytes).length} drawings in ${OUT}`);
