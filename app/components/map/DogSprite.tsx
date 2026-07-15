// Pixel-art companion sprite — the "dogs with tiny stroke" set (animated
// GIFs, one per pose, by our designer).
//
// These are self-animating GIFs, so unlike the old PNG sprite-sheets we no
// longer step frames in JS — the browser plays each GIF's baked timing and
// loops it. That drops all the frame-count / frameMs / staticFrame bookkeeping;
// swapping `anim` just swaps which GIF the div paints.
//
// Assets live in /public/dog/ so they're served as plain static URLs
// (bypassing Metro's asset pipeline). Each GIF is a 64×64 frame (sniffing is
// 64×55; we bottom-align so the paws still sit on the anchor).
//
// We render at 2× nominal so the dog reads on the map at zoom 16 without
// eating neighbouring tiles. The container's anchor (the dog's paws) sits on
// the companionPos lat/lng — feet on the ground, head "above" it.
//
// Direction: the art is a single side view facing right. For leftward movement
// we flip horizontally via scaleX(-1). North/south reuses the last horizontal
// facing — top-down map movement has no "front view", and faking one looks
// worse than letting the dog slide while facing east/west.

export type DogAnim =
  | 'walking'
  | 'sitting'
  | 'running'
  | 'sniffing'
  | 'lying'
  | 'jumping'
  | 'crouched';

// Native GIF frame box. All poses are 64×64 (sniffing 64×55, bottom-aligned).
const FRAME_PX = 64;
// Global size trim applied on top of each caller's `scale` — the designer's
// dogs ran a touch large, so everything renders at 85% (15% smaller).
const SIZE_SCALE = 0.85;

// Synthesized white "sticker" stroke around the dog. The without-stroke art is
// a light body with only a thin dark contour, which loses its edge on dark /
// busy backgrounds (night, sniff mode, the 3D shadows). We add the halo here in
// CSS — stacked hard drop-shadows in 8 directions — so it works regardless of
// which art set is uploaded, outlines the whole silhouette, and is tunable.
// STROKE_SRC_PX is the rim thickness in SOURCE (64px-native) pixels; it scales
// with the sprite so it looks the same at any caller `scale`. Kept low (0.4) so
// it reads as a tight outline hugging the silhouette rather than a fat halo —
// the 8 chained drop-shadows compound, so a small value is already a clean,
// continuous ~1px line.
const STROKE_COLOR = '#ffffff';
const STROKE_SRC_PX = 0.4;
const STROKE_DIRS: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

const GIFS: Record<DogAnim, string> = {
  walking: '/dog/walking.gif',
  sitting: '/dog/sitting.gif',
  running: '/dog/running.gif',
  sniffing: '/dog/sniffing.gif',
  lying: '/dog/lying.gif',
  jumping: '/dog/jumping.gif',
  crouched: '/dog/crouched.gif',
};
// death.gif ships alongside these for a future "fainted/ko" state — no caller
// uses it yet, so it's intentionally not in the DogAnim union.

// Warm the browser cache for every GIF on module import, so the FIRST render
// of a given anim doesn't flash blank while the image is fetched. Cheap
// one-shot — each GIF is a few KB.
if (typeof window !== 'undefined') {
  for (const url of Object.values(GIFS)) {
    const img = new Image();
    img.src = url;
  }
}

interface DogSpriteProps {
  anim: DogAnim;
  // True when the dog should face left. The art is inherently right-facing, so
  // we flip via CSS instead of keeping a second copy of every animation.
  facingLeft: boolean;
  // Multiplier on the 64px native frame. 2 = 128px on screen, ~the right
  // presence at our 16+ map zoom.
  scale?: number;
}

export function DogSprite({ anim, facingLeft, scale = 2 }: DogSpriteProps) {
  const size = FRAME_PX * scale * SIZE_SCALE;
  // Rim thickness in screen px (≈ STROKE_SRC_PX source pixels at this scale).
  const rim = (size / FRAME_PX) * STROKE_SRC_PX;
  const stroke = STROKE_DIRS.map(
    ([dx, dy]) => `drop-shadow(${dx * rim}px ${dy * rim}px 0 ${STROKE_COLOR})`,
  ).join(' ');
  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${GIFS[anim]})`,
        backgroundRepeat: 'no-repeat',
        // White sticker halo synthesized from stacked drop-shadows (see above).
        filter: stroke,
        // Anchor the art to the bottom-centre so the paws sit on the marker
        // point; a shorter frame (sniffing, 64×55) leaves clear space at the
        // top rather than lifting the feet.
        backgroundPosition: 'center bottom',
        // Scale width to `size` and let height follow the aspect ratio, so the
        // non-square sniffing frame isn't stretched.
        backgroundSize: `${size}px auto`,
        // pixelated keeps the 8-bit edges crisp at 2×; without it the browser
        // smooth-scales the dog into a blurry smudge.
        imageRendering: 'pixelated',
        transform: facingLeft ? 'scaleX(-1)' : undefined,
        pointerEvents: 'none',
      }}
    />
  );
}
