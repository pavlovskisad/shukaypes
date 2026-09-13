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
// Configuration, both optional — the feature ships dormant and /auth/me
// says `avatarConfigured: false`, which hides the step entirely:
//   FAL_KEY       the fal.ai API key. Each drawing costs a few cents,
//                 which is why the route caps drawings per person per
//                 day (routes/auth.ts) on top of the burst limiter.
//   FAL_API_URL   the endpoint, overridable for the local e2e stack
//                 (a fake on 127.0.0.1 that returns a fixed PNG), the
//                 way RESEND_API_URL stands in for Resend.
//
// Every failure is an AvatarError with a code the client has a
// sentence for. Nothing here logs the photo or the drawing's bytes.

import type { FastifyBaseLogger } from 'fastify';

const DEFAULT_API_URL = 'https://fal.run/fal-ai/flux-pro/kontext';
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

function apiUrl(): string {
  return process.env.FAL_API_URL?.trim() || DEFAULT_API_URL;
}

// One recipe, like the ink line in the UI (D-70): not tuned per pet.
// The species and breed are said so the model keeps the right animal
// when the photo is ambiguous (a puppy in a blanket); the rest describes
// the app's own paper — the drawing has to sit next to HandDrawn's
// frames and read as the same hand.
export function avatarPrompt(pet: { species: string | null; breed: string | null }): string {
  const what =
    pet.species === 'cat' ? 'cat' : pet.species === 'dog' ? 'dog' : 'pet';
  const breed = pet.breed ? ` (${pet.breed})` : '';
  return (
    `Redraw this ${what}${breed} as a minimal hand-drawn black ink line portrait on plain white paper: ` +
    'a few confident, slightly wobbly pen strokes, head and shoulders, centred, facing the viewer. ' +
    "Keep the animal's real features recognisable — ear shape, muzzle, markings, fur texture — " +
    'but simplify everything into clean outlines. No shading, no colour, no grey fill, no background, ' +
    'no text, no frame, no signature. Pure black lines on pure white.'
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

  const started = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), DRAW_TIMEOUT_MS);
  let json: FalResponse | null = null;
  let status = 0;
  try {
    const res = await fetch(apiUrl(), {
      method: 'POST',
      headers: { authorization: `Key ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: avatarPrompt(pet),
        image_url: `data:${photo.mime};base64,${photo.bytes.toString('base64')}`,
        output_format: 'png',
        aspect_ratio: '1:1',
        num_images: 1,
        // The model's own safety filter: 2 is its default; a family pet
        // photo never trips it, and a refusal is still surfaced below.
        safety_tolerance: '2',
      }),
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
      { kind: 'avatar_draw', status, detail: typeof json?.detail === 'string' ? json.detail.slice(0, 200) : undefined, ms: Date.now() - started },
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
    log.info({ kind: 'avatar_draw', bytes: bytes.length, ms: Date.now() - started }, '[avatar] drawn');
    return { bytes, mime: (mime.split(';')[0] ?? 'image/png').trim() };
  } catch (err) {
    log.warn({ kind: 'avatar_draw', err: (err as Error).message, ms: Date.now() - started }, '[avatar] result fetch failed');
    throw new AvatarError('avatar_failed', (err as Error).message);
  } finally {
    clearTimeout(ftimer);
  }
}
