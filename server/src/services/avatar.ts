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
// TWO RECIPES, one env switch (AVATAR_RECIPE):
//   reference  (default) the photo goes to an image-editing model
//              built for "make this look like that" (Nano Banana,
//              Google's Gemini image edit, behind fal.ai) beside three
//              of the illustrator's own drawings (assets/avatar-refs,
//              the landing page's posters), and the model is told to
//              borrow their hand. The owner's words, 13 Sep: the style
//              is a child's uneven marker doodle, and no sentence got
//              a model there — the words-only drawing came back a
//              handsome, detailed, realistic ink retriever. Pictures
//              of the hand are the brief.
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
//   AVATAR_RECIPE   'reference' | 'marker', see above.
//   FAL_API_URL     overrides whichever endpoint the recipe picks, for
//                   the local e2e stack (a fake on 127.0.0.1 that
//                   returns a fixed PNG), the way RESEND_API_URL stands
//                   in for Resend.
//   AVATAR_REFS_DIR where the reference PNGs are; defaults to
//                   ./assets/avatar-refs under the working directory,
//                   which is where the Dockerfile puts them.
//
// Every failure is an AvatarError with a code the client has a
// sentence for. Nothing here logs the photo or the drawing's bytes.

import fs from 'node:fs';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';

const DEFAULT_API_URL = 'https://fal.run/fal-ai/flux-pro/kontext';
const DEFAULT_REFERENCE_API_URL = 'https://fal.run/fal-ai/nano-banana/edit';
// Four of the illustrator's drawings — the owner's pick (13 Sep): the
// most chaotic, most obviously hand-made ones, not the cleanest. A
// model given tidy samples tidies; given scribbles it scribbles. The
// mop (a scrawl of loops), the maltese (angry, hairy), the terrier
// (zigzag fur), the poodle (loopy ears). The bulldog and the
// dachshund, the two cleanest, stay in the folder and out of the set.
export const REF_FILES = ['mop.png', 'maltese.png', 'terrier.png', 'poodle.png'];
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

export type AvatarRecipe = 'reference' | 'marker';

export function avatarRecipe(): AvatarRecipe {
  return process.env.AVATAR_RECIPE?.trim() === 'marker' ? 'marker' : 'reference';
}

function apiUrl(recipe: AvatarRecipe): string {
  const override = process.env.FAL_API_URL?.trim();
  if (override) return override;
  return recipe === 'reference' ? DEFAULT_REFERENCE_API_URL : DEFAULT_API_URL;
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

// The reference recipe's words. The drawings carry the style; the
// words say which image is the subject and which are the samples,
// name the qualities the owner asked for (uneven, childlike, little
// detail) so the model does not "improve" on the samples, and forbid
// the one thing an editing model does unasked: drawing the sample.
export function referencePrompt(pet: { species: string | null; breed: string | null }): string {
  const what = pet.species === 'cat' ? 'cat' : pet.species === 'dog' ? 'dog' : 'pet';
  return (
    `The first image is a photo of a ${petWord(pet)}. The other ${REF_FILES.length} images are drawings by one illustrator and ` +
    'show only a drawing STYLE: a thick black felt-tip marker, one uniform line weight, uneven wobbly hand-drawn ' +
    "lines like a child's drawing, a big simplified head, dot eyes, a solid black nose, very little detail, a few " +
    'hatching strokes only where the fur is shaggy, plain white background and nothing else. ' +
    `Draw the ${what} from the photo — this exact animal, its own ear shape, muzzle, markings and expression — ` +
    "as a portrait in that illustrator's style, as crude and playful as the drawings, not more polished. " +
    'Do not draw any of the animals from the drawings. No shading, no grey, no colour, no fine detail, no text, no frame.'
  );
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
  const refs = avatarRecipe() === 'reference' ? referenceImages(log) : null;
  const recipe: AvatarRecipe = refs ? 'reference' : 'marker';
  const common = { output_format: 'png', aspect_ratio: '1:1', num_images: 1 };
  const request =
    recipe === 'reference'
      ? { prompt: referencePrompt(pet), image_urls: [photoUri, ...(refs as string[])], ...common }
      : // Kontext's own safety filter: 2 is its default; a family pet
        // photo never trips it, and a refusal is still surfaced below.
        { prompt: avatarPrompt(pet), image_url: photoUri, ...common, safety_tolerance: '2' };

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
    const mime = json?.images?.[0]?.content_type || res.headers.get('content-type') || 'image/png';
    log.info({ kind: 'avatar_draw', recipe, bytes: bytes.length, ms: Date.now() - started }, '[avatar] drawn');
    return { bytes, mime: (mime.split(';')[0] ?? 'image/png').trim() };
  } catch (err) {
    log.warn({ kind: 'avatar_draw', err: (err as Error).message, ms: Date.now() - started }, '[avatar] result fetch failed');
    throw new AvatarError('avatar_failed', (err as Error).message);
  } finally {
    clearTimeout(ftimer);
  }
}
