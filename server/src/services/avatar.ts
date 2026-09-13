// The pet's portrait: a photo in, a small ink drawing out. D-72.
//
// The drawing is made by an image model behind fal.ai (FLUX.1 Kontext,
// an editing model: it keeps the animal in the photo and changes how
// it is rendered), asked for the same thing the rest of the app is
// drawn in — a few black pen lines on white paper, no shading, no
// colour. The ORIGINAL PHOTO IS NEVER KEPT: it goes to the model as a
// data URI inside the request, the drawing comes back, and only the
// drawing is stored (as a Telegram file_id, like every other picture
// here — see crosspost.ts). The app's promise to the person is exactly
// that, and it is made in the sheet that asks for the photo.
//
// THREE RECIPES, one env switch (AVATAR_RECIPE):
//   reference  (default) the photo goes to the image model beside the
//              samples (Nano Banana, Google's Gemini image edit, behind
//              fal.ai), with a SHORT prompt: copy the style of the
//              drawings, do not copy the photo, same dog. The long
//              prompts before it — 300 words of rules about strokes,
//              symmetry and fur — were mostly ignored, and the words
//              that did land ("sketch", "low-detail") pushed the model
//              toward a thin pen sketch, the opposite of the posters.
//              The owner's read, 13 Sep evening: we give it too many
//              instructions; ask for three things and show it the
//              pictures.
//   describe   the photo is shown to a vision model ONCE, which says
//              in one line what a caricaturist would need
//              (petDescription.ts); the image model then draws from
//              those words, the samples and the photo. Kept for
//              comparison; it drew the right dog and no less realistic.
//   marker     the photo alone on FLUX Kontext, single image, the
//              style in words. The fallback when the reference files
//              are missing. Good likeness, wrong hand.
//
// NOT Kontext's own multi-image endpoint for the reference recipe: on
// its one real run it drew the reference bulldog instead of the
// owner's retriever. An editing model that composites its inputs
// cannot be handed an animal as a style sample.
//
// Configuration — the feature ships dormant and /auth/me says
// `avatarConfigured: false`, which hides the step entirely:
//   FAL_KEY         the fal.ai API key. Each drawing costs a few
//                   cents, which is why the route caps drawings per
//                   person per day (routes/auth.ts) on top of the
//                   burst limiter.
//   AVATAR_RECIPE   'describe' | 'reference' | 'marker', see above.
//   FAL_API_URL     overrides whichever endpoint the recipe picks, for
//                   the local e2e stack (a fake on 127.0.0.1 that
//                   returns a fixed PNG), the way RESEND_API_URL stands
//                   in for Resend.
//   AVATAR_REFS_DIR where the reference PNGs are; defaults to
//                   ./assets/avatar-refs under the working directory,
//                   which is where the Dockerfile puts them.
//
// Whatever the model returns then goes through OUR OWN INK (ink.ts):
// thresholded to pure black, thickened to marker weight, wobbled —
// the part of the hand the app can do itself. AVATAR_INK=off skips it.
//
// Every failure is an AvatarError with a code the client has a
// sentence for. Nothing here logs the photo or the drawing's bytes.

import fs from 'node:fs';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { inkEnabled, inkify } from './ink.js';
import { describePet } from './petDescription.js';

const DEFAULT_API_URL = 'https://fal.run/fal-ai/flux-pro/kontext';
const DEFAULT_REFERENCE_API_URL = 'https://fal.run/fal-ai/nano-banana/edit';
// Which of the illustrator's ten drawings go in the request. The model
// copies whatever the samples do, more than anything the prompt says:
// given the fur-heavy ones (maltese, shaggy, spitz, the curly poodle)
// it drew a retriever with fur strokes all over the chest and ears —
// "good but need less detail and more mistakes" (the owner, 13 Sep
// evening). So the set is the four most abstract, the owner's pick:
// the poodle with the loopy ears and the terrier ("like these two"),
// the mop, which is one scribble, and the spaniel, a dozen loose
// lines. Not the bulldog (a tidy head) and not the dachshund (a clean
// side profile, the only one not facing the viewer). Fewer lines in,
// fewer lines out.
export const REF_FILES = ['poodle.png', 'terrier.png', 'mop.png', 'spaniel.png'];
// The model takes ~5–15 s; the fetch of the result a second more.
const DRAW_TIMEOUT_MS = 90_000;
const FETCH_TIMEOUT_MS = 30_000;
// A drawing on white compresses well; anything past this is not one.
const MAX_RESULT_BYTES = 6 * 1024 * 1024;

type Log = Pick<FastifyBaseLogger, 'info' | 'warn'>;

export type AvatarErrorCode = 'avatar_unconfigured' | 'avatar_failed' | 'avatar_refused';

export class AvatarError extends Error {
  constructor(
    public readonly code: AvatarErrorCode,
    detail?: string,
  ) {
    super(detail ?? code);
  }
}

export function avatarConfigured(): boolean {
  return !!process.env.FAL_KEY?.trim();
}

export type AvatarRecipe = 'describe' | 'reference' | 'marker';

export function avatarRecipe(): AvatarRecipe {
  const raw = process.env.AVATAR_RECIPE?.trim();
  return raw === 'marker' || raw === 'describe' ? raw : 'reference';
}

function apiUrl(recipe: AvatarRecipe): string {
  const override = process.env.FAL_API_URL?.trim();
  if (override) return override;
  return recipe === 'marker' ? DEFAULT_API_URL : DEFAULT_REFERENCE_API_URL;
}

function refsDir(): string {
  return process.env.AVATAR_REFS_DIR?.trim() || path.join(process.cwd(), 'assets', 'avatar-refs');
}

// Read once, kept as data URIs. Null when any file is missing — the
// draw then falls back to the marker recipe rather than failing, and
// says so in the log once.
let refsCache: string[] | null | undefined;
function referenceImages(log: Log): string[] | null {
  if (refsCache !== undefined) return refsCache;
  try {
    refsCache = REF_FILES.map(
      (f) => `data:image/png;base64,${fs.readFileSync(path.join(refsDir(), f)).toString('base64')}`,
    );
  } catch (err) {
    log.warn({ kind: 'avatar_refs', dir: refsDir(), err: (err as Error).message }, '[avatar] reference drawings missing — marker recipe');
    refsCache = null;
  }
  return refsCache;
}

// One recipe, like the ink line in the UI (D-70): not tuned per pet.
// The look is the landing page's posters (shukaypes.xyz, 13 Sep): a
// thick felt-tip marker, ONE line weight, a big cartoon head with dot
// eyes and a round nose, hatching only where the fur is shaggy, and
// nothing else on the paper. Named as a tool and a set of rules rather
// than as adjectives — "sketchy" gets a fine-line study, "marker" and
// "one line weight" get the poster. The species and breed are said so
// the model keeps the right animal when the photo is ambiguous (a
// puppy in a blanket).
function petWord(pet: { species: string | null; breed: string | null }): string {
  const what = pet.species === 'cat' ? 'cat' : pet.species === 'dog' ? 'dog' : 'pet';
  return pet.breed ? `${what} (${pet.breed})` : what;
}

// The reference recipe. The drawings carry the style; the words say
// which image is the subject and which are the samples, name what the
// owner asked for (uneven, childlike, few strokes, a fat line) so the
// model does not "improve" on the samples, and forbid the one thing
// an editing model does unasked: drawing the sample.
//
// ORDER MATTERS to a model like this: the drawings go first and the
// photo last, so the run of samples sets the register before the
// subject arrives. Photo first, four drawings after, and the model
// drew a tidy ink illustration of the right dog (13 Sep, 15:47).
export function referencePrompt(pet: { species: string | null; breed: string | null }, refCount = REF_FILES.length): string {
  const what = pet.species === 'cat' ? 'cat' : pet.species === 'dog' ? 'dog' : 'pet';
  return (
    `The first ${refCount} images are drawings by one illustrator; the last image is a photo of a ${petWord(pet)}. ` +
    `Draw this ${what} exactly the way those drawings are drawn: hand-drawn, childish, fast, fat uneven black ` +
    'marker lines, weird, low effort, a rough draft, funny and a bit ugly — a funny character out of a ' +
    "children's picture book, a cartoon, not a portrait. Copy the style and the idea of the " +
    'drawings, not their animals. Do not make it realistic and do not copy the photo — take only what makes ' +
    `this ${what} recognisable: its coat, ears, muzzle and markings. Half the lines you would normally draw: ` +
    'an outline, the ears, two small dot eyes, a nose, a mouth, and that is all — no fur strokes, no whiskers, ' +
    'no wrinkles, no marks for shading. Leave the mistakes in: lines that miss, overshoot or do not meet, ' +
    'proportions that are off. Head and shoulders facing the viewer, black lines on plain white, nothing else.'
  );
}

// The request body for the reference recipe, in the order above —
// shared with probe:avatar so a probe run and a real draw are the
// same call.
export function referenceBody(
  photoUri: string,
  refs: string[],
  pet: { species: string | null; breed: string | null },
): Record<string, unknown> {
  return {
    prompt: referencePrompt(pet, refs.length),
    image_urls: [...refs, photoUri],
    output_format: 'png',
    aspect_ratio: '1:1',
    num_images: 1,
  };
}

// The describe recipe's words: the samples and a sentence, no photo.
// The model is told there is no photo on purpose, or it looks for
// one among the samples and draws the maltese.
// The photo, in the describe recipe, is a likeness check and nothing
// more: on by default, AVATAR_DESCRIBE_PHOTO=off drops it. The first
// run without it drew the illustrator's usual shaggy dog for a smooth
// golden one — the right hand, the wrong animal; the owner's read was
// that a person would not feel it was their dog.
export function describeWithPhoto(): boolean {
  return process.env.AVATAR_DESCRIBE_PHOTO?.trim().toLowerCase() !== 'off';
}

export function describePrompt(
  description: string,
  pet: { species: string | null; breed: string | null },
  refCount = REF_FILES.length,
  withPhoto = true,
): string {
  const what = pet.species === 'cat' ? 'cat' : pet.species === 'dog' ? 'dog' : 'pet';
  const photoLine = withPhoto
    ? `the last image is a photo of the ${what}, only there so it is the same animal. `
    : 'There is no photo. ';
  return (
    `The first ${refCount} images are drawings by one illustrator; ${photoLine}` +
    `Draw this ${what} exactly the way those drawings are drawn: hand-drawn, childish, fast, fat uneven black ` +
    'marker lines, weird, low effort, a rough draft, funny and a bit ugly — a funny character out of a ' +
    "children's picture book, a cartoon, not a portrait. Copy the style and the idea of the " +
    `drawings, not their animals. Do not make it realistic. The ${what}: "${description}" ` +
    'Half the lines you would normally draw: an outline, the ears, two small dot eyes, a nose, a mouth, and ' +
    'that is all — no fur strokes, no whiskers, no wrinkles. Leave the mistakes in. ' +
    'Head and shoulders facing the viewer, black lines on plain white, nothing else.'
  );
}

export function describeBody(
  refs: string[],
  description: string,
  pet: { species: string | null; breed: string | null },
  photoUri: string | null = null,
): Record<string, unknown> {
  return {
    prompt: describePrompt(description, pet, refs.length, photoUri !== null),
    image_urls: photoUri ? [...refs, photoUri] : refs,
    output_format: 'png',
    aspect_ratio: '1:1',
    num_images: 1,
  };
}

export function avatarPrompt(pet: { species: string | null; breed: string | null }): string {
  return (
    `Redraw the ${petWord(pet)} in this photo as a bold hand-drawn cartoon portrait in thick black felt-tip marker ` +
    'on plain white paper, like a hand-drawn lost-pet poster. One uniform line weight everywhere, no thin lines. ' +
    'Simplify: a big head filling the frame, facing the viewer, dot eyes, a round nose, a simple mouth; a few ' +
    'short hatching strokes only where the fur is shaggy, none where it is smooth. Keep what makes this animal ' +
    'recognisable — ear shape, muzzle, markings. Playful and naive, not realistic. No shading, no grey, no colour, ' +
    'no background, no text, no frame, no signature. Solid black marker lines on pure white.'
  );
}

interface FalResponse {
  images?: { url?: string; content_type?: string }[];
  has_nsfw_concepts?: boolean[];
  detail?: unknown;
}

/**
 * Photo → drawing. Throws AvatarError; never returns a partial result.
 */
export async function drawAvatar(
  photo: { bytes: Buffer; mime: string },
  pet: { species: string | null; breed: string | null },
  log: Log,
): Promise<{ bytes: Buffer; mime: string }> {
  const key = process.env.FAL_KEY?.trim();
  if (!key) throw new AvatarError('avatar_unconfigured');

  const photoUri = `data:${photo.mime};base64,${photo.bytes.toString('base64')}`;
  const wanted = avatarRecipe();
  const refs = wanted === 'marker' ? null : referenceImages(log);
  let recipe: AvatarRecipe = refs ? wanted : 'marker';
  let description: string | null = null;
  if (recipe === 'describe') {
    try {
      description = await describePet(photo, pet);
    } catch (err) {
      log.warn({ kind: 'avatar_describe', err: (err as Error).message }, '[avatar] description failed — reference recipe');
    }
    if (description) {
      // The line is about an animal's coat and ears; logging it is
      // what makes a wrong drawing debuggable.
      log.info({ kind: 'avatar_describe', description, photo: describeWithPhoto() }, '[avatar] pet described');
    } else {
      recipe = 'reference';
    }
  }
  const request =
    recipe === 'describe'
      ? describeBody(refs as string[], description as string, pet, describeWithPhoto() ? photoUri : null)
      : recipe === 'reference'
        ? referenceBody(photoUri, refs as string[], pet)
        : // Kontext's own safety filter: 2 is its default; a family pet
          // photo never trips it, and a refusal is still surfaced below.
          {
          prompt: avatarPrompt(pet),
          image_url: photoUri,
          output_format: 'png',
          aspect_ratio: '1:1',
          num_images: 1,
          safety_tolerance: '2',
        };

  const started = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), DRAW_TIMEOUT_MS);
  let json: FalResponse | null = null;
  let status = 0;
  try {
    const res = await fetch(apiUrl(recipe), {
      method: 'POST',
      headers: { authorization: `Key ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal: ctl.signal,
    });
    status = res.status;
    json = (await res.json().catch(() => null)) as FalResponse | null;
  } catch (err) {
    log.warn({ kind: 'avatar_draw', err: (err as Error).message, ms: Date.now() - started }, '[avatar] model call threw');
    throw new AvatarError('avatar_failed', (err as Error).message);
  } finally {
    clearTimeout(timer);
  }

  const url = json?.images?.[0]?.url;
  if (status < 200 || status >= 300 || !url) {
    log.warn(
      { kind: 'avatar_draw', recipe, status, detail: typeof json?.detail === 'string' ? json.detail.slice(0, 200) : undefined, ms: Date.now() - started },
      '[avatar] model rejected the call',
    );
    throw new AvatarError('avatar_failed', `status ${status}`);
  }
  if (json?.has_nsfw_concepts?.[0]) {
    log.warn({ kind: 'avatar_draw', ms: Date.now() - started }, '[avatar] model flagged the result');
    throw new AvatarError('avatar_refused');
  }

  // The result lives on fal's CDN for a while; fetch it now, it is the
  // only copy that will exist once it expires.
  const fctl = new AbortController();
  const ftimer = setTimeout(() => fctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: fctl.signal });
    if (!res.ok) throw new Error(`result fetch ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_RESULT_BYTES) throw new Error(`result size ${bytes.length}`);
    const mime = (
      (json?.images?.[0]?.content_type || res.headers.get('content-type') || 'image/png').split(';')[0] ?? 'image/png'
    ).trim();
    log.info({ kind: 'avatar_draw', recipe, bytes: bytes.length, ms: Date.now() - started }, '[avatar] drawn');
    // Our own ink over the model's line (ink.ts). A failure to re-ink
    // is a log line and the model's drawing as it came.
    if (mime === 'image/png' && inkEnabled()) {
      try {
        const inked = inkify(bytes);
        log.info({ kind: 'avatar_ink', bytes: inked.length, ms: Date.now() - started }, '[avatar] inked');
        return { bytes: inked, mime };
      } catch (err) {
        log.warn({ kind: 'avatar_ink', err: (err as Error).message }, '[avatar] ink pass failed — drawing kept as drawn');
      }
    }
    return { bytes, mime };
  } catch (err) {
    log.warn({ kind: 'avatar_draw', err: (err as Error).message, ms: Date.now() - started }, '[avatar] result fetch failed');
    throw new AvatarError('avatar_failed', (err as Error).message);
  } finally {
    clearTimeout(ftimer);
  }
}
