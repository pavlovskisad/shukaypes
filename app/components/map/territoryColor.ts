// One colour per territory owner, shared by everything that draws
// territory — the ground fill (MapLibre, CSS colour strings) and the 3D
// buildings standing on it (Three.js, linear RGB). They have to agree:
// a block whose ground is one colour and whose buildings are another
// reads as two different claims on the same spot.
//
// The hue is a hash of the owner id, so it's the same on every device and
// across sessions without the server having to assign or store anything.
// Yours is always brand blue and no neighbour can be issued it — the map's
// first job is answering "is this mine", and that answer must never depend
// on remembering which of twelve colours you were given today.

// Brand blue, rgb(0,60,255) — the CTA pill blue.
export const OWN_COLOR_CSS = 'rgb(0,60,255)';
export const OWN_COLOR_RGB: [number, number, number] = [0, 60 / 255, 1];

// A FIXED PALETTE, not a hash straight to a hue.
//
// Hashing an id to any of 360 hues sounds like it spreads owners out, and
// it doesn't: nothing stops two neighbours landing 8° apart, and 8° at one
// fixed saturation is not a colour difference anyone can see across a map.
// The result was a screen of near-identical mid-tones where telling whose
// ground you were standing on meant reading a label.
//
// So the hues are chosen instead of computed, spaced by how far apart they
// actually LOOK rather than by degrees. The gaps are deliberately uneven:
// wide through the greens, where the eye resolves hue poorly and 130 vs
// 145 is one colour, and tight through the reds and oranges, where it
// resolves well and 0 vs 20 is plainly two. 180-200 is skipped as well as
// the reserved band itself, so no neighbour gets a cyan close enough to
// brand blue to be mistaken for yours at a glance.
const HUES = [0, 20, 40, 60, 90, 130, 160, 180, 265, 290, 315, 340];

// Two tones per hue, so a collision on hue is still two different colours.
//
// TWO, not three, and NOTHING DARK. The first cut had a third tone at
// lightness 0.30 to widen the palette, and on screen those zones did not
// read as colours at all — they read as shadows cast across the city. The
// mistake was scoring the palette raw. Nobody sees these colours raw: the
// fill sits at 42% over pale map paper, so a dark colour composites to a
// mid grey no matter how saturated it is underneath.
//
// Scored the way it is actually seen — composited first, then compared in
// CIELAB — dropping the dark tier wins on every axis at once: closest pair
// 6.2 -> 8.7, nothing left that reads as grey, and total confusion on a
// 14-zone screen 6.5 -> 6.0 pairs. Fewer slots means slightly more exact
// repeats and far fewer near-misses, which is the better trade: two
// obviously-identical zones are easier to live with than two that are
// almost the same.
const TONES = [
  { s: 0.95, l: 0.42 },
  { s: 0.8, l: 0.66 },
];

interface Paint {
  hue: number;
  sat: number;
  light: number;
}

const PALETTE: Paint[] = TONES.flatMap((t) =>
  HUES.map((hue) => ({ hue, sat: t.s, light: t.l })),
);

function paintFor(id: string): Paint {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Hashed, not assigned in arrival order, so an owner keeps their colour
  // across sessions and devices with nothing stored anywhere — and, more
  // to the point, a zone doesn't change colour when a neighbour at the far
  // edge of the view scrolls in or out.
  //
  // The price is that 14 zones drawn from 36 slots will sometimes hand two
  // of them the same paint (~2.5 pairs per screen, by birthday). Handing
  // out slots so the drawn set never repeats would need the assignment to
  // depend on who is currently on screen — and then walking far enough to
  // push one neighbour out of view would recolour another, which destroys
  // the mapping this whole file exists to keep.
  return PALETTE[(h >>> 0) % PALETTE.length]!;
}

function hsl({ hue, sat, light }: Paint): [number, number, number] {
  const h = hue / 360;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m = light - c / 2;
  const seg = Math.floor(h * 6) % 6;
  const [r, g, b] =
    seg === 0
      ? [c, x, 0]
      : seg === 1
        ? [x, c, 0]
        : seg === 2
          ? [0, c, x]
          : seg === 3
            ? [0, x, c]
            : seg === 4
              ? [x, 0, c]
              : [c, 0, x];
  return [r + m, g + m, b + m];
}

export function ownerColorCss(id: string): string {
  const p = paintFor(id);
  return `hsl(${p.hue}, ${Math.round(p.sat * 100)}%, ${Math.round(p.light * 100)}%)`;
}

// Same colour as an RGB triple in 0..1, for Three.js material maths.
export function ownerColorRgb(id: string): [number, number, number] {
  return hsl(paintFor(id));
}

// Even-odd ray cast in raw degrees — the projection cancels out of an
// inside/outside test. Shared so the ground and the buildings decide
// which zone a spot belongs to the same way.
export function pointInRing(
  lat: number,
  lng: number,
  ring: { lat: number; lng: number }[],
): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i]!.lat;
    const xi = ring[i]!.lng;
    const yj = ring[j]!.lat;
    const xj = ring[j]!.lng;
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
