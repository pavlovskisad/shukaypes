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

// Hues in this band read as "yours" and are reserved.
const OWN_HUE_LO = 200;
const OWN_HUE_HI = 252;

function hueFor(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hue = (h >>> 0) % 360;
  // Fold the reserved band away rather than clamping to its edges, which
  // would pile several owners onto the same two hues.
  return hue >= OWN_HUE_LO && hue < OWN_HUE_HI
    ? (hue + (OWN_HUE_HI - OWN_HUE_LO)) % 360
    : hue;
}

// Fixed saturation/lightness so twenty owners read as one family of paint
// rather than a bag of highlighters.
const SAT = 0.62;
const LIGHT = 0.45;

export function ownerColorCss(id: string): string {
  return `hsl(${hueFor(id)}, ${SAT * 100}%, ${LIGHT * 100}%)`;
}

// Same colour as an RGB triple in 0..1, for Three.js material maths.
export function ownerColorRgb(id: string): [number, number, number] {
  const h = hueFor(id) / 360;
  const c = (1 - Math.abs(2 * LIGHT - 1)) * SAT;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m = LIGHT - c / 2;
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
