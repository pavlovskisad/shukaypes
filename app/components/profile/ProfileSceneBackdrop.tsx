// THE PARK, DRAWN BY THE SAME HAND AS EVERYTHING ELSE.
//
// This used to be pixel art: axis-aligned rectangles on a 2-px grid,
// flat saturated fills, not one outline anywhere. It was built to match
// an 8-bit dog sprite — but the dog we ship now is a white body with a
// black line drawn round it, and every card, pill and sheet in the app
// is white paper with a wobbly ink edge (see ui/HandDrawn). The scene
// was the last surface still speaking the old language, and against the
// inked chrome floating on top of it, it read as clip-art wallpaper
// behind a drawing.
//
// So: same landscape, same parallax, same day/night structure — redrawn
// as a drawing. In daylight it is pure line on white paper: no fill
// carries any colour, the horizon bows the way a hand-ruled line does,
// and the curve machinery is the app's own (`splinePath`), so a tree
// crown and a card's corner come off the same pen.
//
// LINE WEIGHT IS THE DEPTH CUE — the only one available once the colour
// is gone. Far things are drawn thinner than near ones, and everything
// in the scene stays under the 2px the foreground chrome uses, so the
// cards still lead and the park stays a backdrop.
//
// Three parallax layers + day/night theming:
//   far  — sky, sun-or-moon, clouds (factor ~0.06)
//   mid  — trees, lamppost, bench, lamp light cone at night (~0.18)
//   near — ground tufts (factor ~0.32)
// Plus the sky/ground plane that stays locked as the reference.
//
// Each layer is its own <svg> with the same 360×700 viewBox so the
// elements line up vertically.

import { INK } from '../../constants/surface';
import { splinePath } from '../ui/HandDrawn';

export type SceneMode = 'day' | 'night';

interface BackdropProps {
  // Dog's current center x in container pixels. Drives parallax.
  dogCenterX: number;
  // Container width in pixels — the dog's "world" reference.
  cardWidth: number;
  // ms — same value the dog's transform transition uses, so the
  // layers slide in sync. 0 for stationary.
  transitionMs: number;
  // 'day' or 'night' — drives the colour palette + sun/moon swap +
  // lamp light cone.
  mode: SceneMode;
}

const VIEW_W = 360;
// 700 to match a typical phone-viewport aspect ratio (360:700). With
// preserveAspectRatio="none" stretching the SVG to fill the full-bleed
// scene container, this renders at close to 1:1 on a phone, so a drawn
// disc stays a disc rather than an obvious egg.
const VIEW_H = 700;

// Horizon — trees + lamppost + bench stand on this line. 290 of 700 =
// 42% from top, so it sits a bit above centre and leaves room for the
// dog + stat deck on the lawn below.
const GROUND_Y = 290;

// STROKE WEIGHTS, in CSS px — every stroked path below carries
// `vectorEffect="non-scaling-stroke"`, so these are real screen pixels
// and not viewBox units. That matters twice over: the layers stretch by
// different amounts on the two axes (360→~390 across, 700→~844 down),
// which without it would draw a line noticeably fatter on one axis than
// the other; and it lets these sit on the same scale as the 2px the
// cards and pills are drawn with.
const W_FAR = 1.4; // clouds, sun, moon
const W_MID = 1.6; // trees, lamppost, bench
const W_HORIZON = 2; // the one line the whole scene hangs off
// The tufts get their own, finer, nib — see TUFTS.

// Per-mode palettes.
//
// DAY IS A LINE DRAWING: every fill below is the paper itself, and the
// ink does all of the describing. That is not the same as leaving the
// shapes unfilled — `fill: none` would let the horizon run straight
// through every tree, let one cloud cross-hatch the next, and let the
// sun's rays show through its own disc. White fill is not a colour here;
// it is the paper, doing the job of occlusion. So the keys stay named
// per element, all pointing at the same white: turning colour back on is
// then one block of edits rather than a rewrite.
//
// `ink` is part of the palette because night inverts the paper: a black
// line on a midnight sky is a line nobody can see. Day draws in the
// app's ink; night draws in pale pencil on dark ground, and keeps its
// tones. (Night is not currently selected — see ProfileDogScene — but
// leaving it drawing in invisible ink would be a trap for whoever turns
// it back on.)
const PAPER = '#ffffff';
const PALETTE = {
  day: {
    ink: INK,
    sky: PAPER,
    ground: PAPER,
    foliage: PAPER,
    trunk: PAPER,
    cloud: PAPER,
    sun: PAPER,
    moon: PAPER,
    lampBulb: PAPER,
  },
  night: {
    ink: '#dfe7f2',
    sky: '#1c2a44',
    ground: '#2a3a4a',
    foliage: '#33475a',
    trunk: '#3a3242',
    cloud: '#40536c',
    sun: '#f7dc9b',
    moon: '#f2efe2',
    lampBulb: '#fff2b3',
  },
} satisfies Record<SceneMode, Record<string, string>>;

// The profile page paints its own root in the sky colour so the scene
// reads as one continuous environment rather than a panel glued onto a
// differently-coloured page. It used to keep its own copy of these two
// hex values, which is the kind of duplication that survives exactly one
// palette change — so the page reads them from here.
export const SCENE_SKY: Record<SceneMode, string> = {
  day: PALETTE.day.sky,
  night: PALETTE.night.sky,
};

// …and the ambient creatures that fly over the scene draw in the same
// ink as the park they fly over — black on white by day, pale on the
// night sky. Same reason as SCENE_SKY: one source, not two copies.
export const SCENE_INK: Record<SceneMode, string> = {
  day: PALETTE.day.ink,
  night: PALETTE.night.ink,
};

// WHERE THE HORIZON LANDS, as a fraction of the scene's height.
//
// The layers stretch with preserveAspectRatio="none", so this line is
// always at the same fraction of the container and never at a fixed
// pixel depth. Anything that has to stay BELOW it — the dog walking on
// the lawn — has to be positioned from this number, not from a pixel
// constant that happens to look right on one screen. See
// ProfileDogScene, where a fixed inset walked the dog into the tree line
// on any viewport shorter than the one it was tuned on.
export const HORIZON_FRACTION = GROUND_Y / VIEW_H;

// ---------------------------------------------------------------------
// The pen.
//
// Everything below builds path data ONCE, at module load, into the
// constants further down. The geometry depends on nothing but its own
// seed, and the parallax layers re-render on every step the dog takes —
// rebuilding a dozen splines each time would be pure waste, and worse,
// a scene that re-rolled its own trees would visibly twitch as the dog
// walked. Same drawing, every render, every visit.
// ---------------------------------------------------------------------

// mulberry32 — the same small deterministic generator the hand-drawn
// borders use, for the same reason: a shape has to come out identical
// every time it is asked for.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A closed, gently irregular ellipse — a tree crown, the sun's disc.
// Two slow harmonics rather than per-point jitter, so the outline bows
// the way a hand does instead of shivering.
function blob(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  seed: number,
  { points = 16, wobble = 0.13 }: { points?: number; wobble?: number } = {},
): string {
  const r = rng(seed);
  const f1 = 2 + Math.floor(r() * 2);
  const f2 = 3 + Math.floor(r() * 3);
  const p1 = r() * Math.PI * 2;
  const p2 = r() * Math.PI * 2;
  const pts = Array.from({ length: points }, (_, i) => {
    const a = (i / points) * Math.PI * 2;
    const k =
      1 + wobble * (Math.sin(a * f1 + p1) * 0.72 + Math.sin(a * f2 + p2) * 0.28);
    return { x: cx + Math.cos(a) * rx * k, y: cy + Math.sin(a) * ry * k };
  });
  return splinePath(pts, true);
}

// A cloud: a flat-ish base with a scalloped top.
//
// Built as the UPPER ENVELOPE of three overlapping lobes rather than as
// three arcs stitched end to end. Stitched arcs double back on
// themselves wherever two lobes overlap, and a spline through points
// that go backwards ties a little knot at every join. Sampling `min(y)`
// across the width can't: the outline is a function of x, so it only
// ever moves forward.
function cloudPath(x: number, y: number, w: number, h: number, seed: number): string {
  const r = rng(seed);
  // Outer lobes are placed so the envelope meets the baseline exactly at
  // both ends (0.26 - 0.26 = 0, 0.74 + 0.26 = 1) — otherwise the cloud
  // ends on a vertical cliff.
  const lobes = [
    { c: 0.26, rx: 0.26, ry: 0.62 },
    { c: 0.5, rx: 0.3, ry: 1 },
    { c: 0.74, rx: 0.26, ry: 0.68 },
  ].map((l) => ({
    cx: x + l.c * w,
    rx: l.rx * w,
    ry: l.ry * h * (0.88 + r() * 0.24),
  }));
  const N = 24;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= N; i++) {
    const px = x + (i / N) * w;
    let py = y;
    for (const l of lobes) {
      const dx = (px - l.cx) / l.rx;
      if (Math.abs(dx) < 1) py = Math.min(py, y - Math.sqrt(1 - dx * dx) * l.ry);
    }
    pts.push({ x: px, y: py });
  }
  // …and back along the base, right to left, with a little sag so the
  // underside isn't a ruled edge either.
  pts.push({ x: x + w * 0.72, y: y + h * 0.1 });
  pts.push({ x: x + w * 0.34, y: y + h * 0.13 });
  pts.push({ x: x + w * 0.08, y: y + h * 0.05 });
  return splinePath(pts, true);
}

// A tapered trunk / post: two long wobbling sides, narrower at the top.
function taper(
  cx: number,
  yBottom: number,
  yTop: number,
  halfBottom: number,
  halfTop: number,
  seed: number,
): string {
  const r = rng(seed);
  const bow = 0.55 + r() * 0.5;
  const phase = r() * Math.PI * 2;
  const N = 5;
  const side = (dir: 1 | -1) =>
    Array.from({ length: N + 1 }, (_, i) => {
      const u = i / N;
      const yy = yBottom + (yTop - yBottom) * u;
      const half = halfBottom + (halfTop - halfBottom) * u;
      return { x: cx + dir * half + Math.sin(u * Math.PI + phase) * bow, y: yy };
    });
  return splinePath([...side(-1), ...side(1).reverse()], true);
}

// A run of points along the horizon, bowing slowly. Shared by the
// ground's fill and the line drawn on top of it, so the two can never
// disagree about where the horizon is — the same trick HandDrawnPaperTop
// plays with the pet cards' photo band.
const HORIZON_AMP = 3.2;
function horizonPts(): { x: number; y: number }[] {
  const r = rng(0x5eed1);
  const f1 = 1.3 + r() * 0.5;
  const f2 = 3 + r() * 1.5;
  const p1 = r() * Math.PI * 2;
  const p2 = r() * Math.PI * 2;
  const N = 24;
  return Array.from({ length: N + 1 }, (_, i) => {
    const u = i / N;
    const a = u * Math.PI * 2;
    return {
      x: u * VIEW_W,
      y:
        GROUND_Y +
        (Math.sin(a * f1 + p1) * 0.78 + Math.sin(a * f2 + p2) * 0.22) * HORIZON_AMP,
    };
  });
}

// A short stroke — grass tuft blade, bench leg, lamppost stem.
function stroke(x0: number, y0: number, x1: number, y1: number, bow: number): string {
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  // Push the midpoint along the segment's normal so the line bows.
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} Q ${(mx - (dy / len) * bow).toFixed(2)} ${(
    my +
    (dx / len) * bow
  ).toFixed(2)} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

// ---------------------------------------------------------------------
// The drawing, built once.
// ---------------------------------------------------------------------

const HORIZON = horizonPts();
const HORIZON_LINE = splinePath(HORIZON, false);
// The lawn is the same line, closed down the sides to the bottom of the
// viewBox. The sky is a plain full-height rect underneath, so however
// the horizon dips there is never a seam to show through.
const GROUND_FILL = `${HORIZON_LINE} L ${VIEW_W} ${VIEW_H} L 0 ${VIEW_H} Z`;

interface TreeArt {
  crown: string;
  trunk: string;
}

// A TREE LINE, NOT SIX OF THE SAME TREE.
//
// The first cut ran scales 0.85 → 1.4 with one silhouette, which is a
// 1.6× range on a single shape — near enough to identical that the row
// read as a repeated stamp. Three knobs instead of one:
//
//   scale       overall size. 0.78 → 1.7 now, a 2.2× range, so the row
//               has genuine near and far in it.
//   aspect      crown proportion, > 1 wide and squat, < 1 tall and
//               narrow. Applied as sqrt either way so the crown changes
//               SHAPE without also changing area — otherwise "wide"
//               silently means "bigger" and the two knobs fight.
//   trunkRatio  how much of the tree is bare trunk. A low value is a
//               shrub sitting on the ground; a high one is a tree you
//               could walk under.
interface TreeSpec {
  cx: number;
  scale: number;
  aspect: number;
  trunkRatio: number;
  seed: number;
}

function treeArt({ cx, scale, aspect, trunkRatio, seed }: TreeSpec): TreeArt {
  const k = Math.sqrt(aspect);
  const trunkH = 9 * scale * trunkRatio;
  const crownRx = 11.5 * scale * k;
  const crownRy = (10 * scale) / k;
  const crownCy = GROUND_Y - trunkH - crownRy * 0.72;
  return {
    crown: blob(cx, crownCy, crownRx, crownRy, seed, { wobble: 0.15 }),
    // Rooted BELOW the horizon and buried in the crown at the top, so
    // neither join can open a gap when the wobbly line moves under it.
    trunk: taper(
      cx,
      GROUND_Y + 5,
      crownCy + crownRy * 0.45,
      2.4 * scale,
      1.5 * scale,
      seed + 1,
    ),
  };
}

// Spaced so no two crowns touch, and so the 124…209 stretch stays clear
// for the lamppost and the bench.
// The size range does the work; the trunk ratio stays near 1 on the
// small ones. A wide crown on a stubby trunk is not a small tree, it is
// a mushroom — which is exactly what scale 0.78 at trunkRatio 0.5 drew.
// Only the tall narrow one departs, and upwards.
const TREES: TreeArt[] = [
  treeArt({ cx: 16, scale: 1.55, aspect: 1.05, trunkRatio: 0.9, seed: 101 }),
  // The little one.
  treeArt({ cx: 74, scale: 0.8, aspect: 1.15, trunkRatio: 1, seed: 202 }),
  // …and the tall narrow one right beside it, for the contrast.
  treeArt({ cx: 112, scale: 1.15, aspect: 0.8, trunkRatio: 1.35, seed: 303 }),
  treeArt({ cx: 222, scale: 0.95, aspect: 1.2, trunkRatio: 0.95, seed: 404 }),
  treeArt({ cx: 274, scale: 1.35, aspect: 0.88, trunkRatio: 1.15, seed: 505 }),
  // Pulled in from 332: the biggest crown out at the right margin spent
  // most of the parallax range sliced in half by the screen edge.
  treeArt({ cx: 322, scale: 1.5, aspect: 1.1, trunkRatio: 0.95, seed: 606 }),
];

interface CloudArt {
  d: string;
  animation: string;
}

const CLOUDS: CloudArt[] = [
  { d: cloudPath(20, 122, 41, 13, 11), animation: 'cloud-a 34s ease-in-out infinite' },
  { d: cloudPath(112, 88, 34, 11, 22), animation: 'cloud-b 28s ease-in-out infinite' },
  { d: cloudPath(176, 158, 29, 10, 33), animation: 'cloud-c 42s ease-in-out infinite' },
  { d: cloudPath(240, 100, 39, 13, 44), animation: 'cloud-d 38s ease-in-out infinite' },
];

const SKY_CX = 292;
const SKY_CY = 132;
const SUN_DISC = blob(SKY_CX, SKY_CY, 11, 11, 77, { points: 18, wobble: 0.07 });
// Eight rays, each a short bowed dash — the sun a person draws, not a
// gradient. Angles are offset so no ray points straight at a cloud.
const SUN_RAYS: string[] = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2 + 0.2;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return stroke(SKY_CX + c * 14.5, SKY_CY + s * 14.5, SKY_CX + c * 20, SKY_CY + s * 20, 0.5);
});
const MOON_DISC = blob(SKY_CX, SKY_CY, 10, 10, 88, { points: 18, wobble: 0.06 });
// The bite out of the side that makes a disc read as a moon.
const MOON_SHADE = blob(SKY_CX + 7, SKY_CY - 1.5, 7.5, 8, 99, { points: 14, wobble: 0.08 });

// Bench — drawn as lines. A 38-unit-wide seat filled with anything at
// all just turns into a smudge at this size.
//
// IT RIDES WITH THE TREES, not with the grass. It was a near-layer
// object at first, which is the truthful depth for a thing you could sit
// on — and it meant the bench slid across the tree line by ±25 units as
// the dog walked (the near and mid factors differ by 0.14 over a ~390px
// container), so it spent half its time drawn through a trunk. Parking
// it on the same layer as the trees costs one depth cue and buys a
// composition that holds at every position: it sits in the clear stretch
// between the third tree and the fourth (124…209), beside the lamppost.
// A SEAT AND A BACK, not two rails of equal length. Drawn first as one
// long line with a second the same length above it and a vertical at
// each end, it came out as a field gate: nothing said which edge you sit
// on. Three things fix it — the seat runs wider than the back, the back
// is two close slats rather than one lonely rail, and an apron line
// under the seat gives the plank some thickness.
const BENCH_X = 166;
const SEAT_Y = GROUND_Y - 9;
const BACK_Y = GROUND_Y - 19;
const BENCH: string[] = [
  // Seat plank — the widest line, and its front edge just under it.
  stroke(BENCH_X, SEAT_Y, BENCH_X + 38, SEAT_Y - 0.5, 0.4),
  stroke(BENCH_X + 1.5, SEAT_Y + 2.6, BENCH_X + 36.5, SEAT_Y + 2.2, 0.3),
  // Backrest: two slats, inset from the seat's ends.
  stroke(BENCH_X + 6, BACK_Y, BENCH_X + 33, BACK_Y - 0.4, 0.4),
  stroke(BENCH_X + 6, BACK_Y + 4, BENCH_X + 33, BACK_Y + 3.6, 0.4),
  // Uprights, leaning back a touch the way a bench's do.
  stroke(BENCH_X + 7, SEAT_Y, BENCH_X + 5.5, BACK_Y - 1.5, 0.3),
  stroke(BENCH_X + 31, SEAT_Y, BENCH_X + 32.5, BACK_Y - 1.5, -0.3),
  // Legs, sunk just under the horizon so the bench stands in the grass
  // rather than balancing on it.
  stroke(BENCH_X + 6, SEAT_Y + 2.6, BENCH_X + 4.5, GROUND_Y + 3, 0.3),
  stroke(BENCH_X + 32, SEAT_Y + 2.6, BENCH_X + 33.5, GROUND_Y + 3, -0.3),
];

// Lamppost — stem, cross-arm, and a small wash-filled lantern.
const LAMP_X = 151;
const LAMP_TOP = GROUND_Y - 58;
const LAMP_STEM = stroke(LAMP_X, GROUND_Y + 3, LAMP_X + 0.5, LAMP_TOP, 1.1);
const LAMP_ARM = stroke(LAMP_X - 5, LAMP_TOP, LAMP_X + 6, LAMP_TOP - 0.5, 0.6);
const LAMP_HEAD = blob(LAMP_X + 0.5, LAMP_TOP + 3.5, 4.5, 3.4, 55, { points: 10, wobble: 0.1 });

// Grass tufts — three blades apiece. Ink ticks along the horizon, where
// the old scene had little green rectangles.
//
// TALL, FINE, AND NOT MEETING AT A POINT. Two earlier cuts both drew an
// arrowhead instead of grass: short blades under a 1.8px nib merged into
// a dark blob at the root, and once they were long enough to separate,
// three lines converging on one x still read as a ↓. Longer blades, a
// finer nib, and three bases spread over a couple of units — so the tuft
// grows out of a patch of ground rather than out of a single dot.
// FOUR, NOT SIX, AND NO TWO ALIKE. Six identical three-blade fans at
// even spacing read as a repeated stamp along the horizon — the same
// fault the tree line had. Each tuft now picks its own blade count and
// height, so one is a tall three, one a sparse pair, one a dense four.
const W_TUFT = 1.5;
function tuft(x: number, blades: number, h: number, seed: number): string[] {
  const r = rng(seed);
  return Array.from({ length: blades }, (_, i) => {
    // -1 at the left of the fan, +1 at the right.
    const u = blades === 1 ? 0 : (i / (blades - 1)) * 2 - 1;
    const base = x + u * 1.8 + (r() - 0.5) * 0.9;
    const lean = u * (4.5 + r() * 2);
    // Outer blades are shorter, the way a real clump falls away.
    const len = h * (1 - Math.abs(u) * 0.24) * (0.86 + r() * 0.28);
    // Each blade arcs away from the centre of its own fan.
    const bow = u === 0 ? 0.6 : -u * 1.5;
    return stroke(base, GROUND_Y + 2, base + lean, GROUND_Y - len, bow);
  });
}
const TUFTS: string[] = [
  ...tuft(46, 3, 13, 701),
  ...tuft(132, 2, 8, 702),
  ...tuft(246, 4, 11, 703),
  ...tuft(306, 2, 12, 704),
];

// Stars — small ink sparks, night only.
const STAR_POS: [number, number][] = [
  [50, 80], [82, 150], [124, 50], [200, 110], [248, 180], [296, 70], [332, 140],
];

function layerStyle(
  dogCenterX: number,
  cardWidth: number,
  factor: number,
  transitionMs: number,
): React.CSSProperties {
  const offset = dogCenterX - cardWidth / 2;
  const tx = -offset * factor;
  return {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    transform: `translateX(${tx}px)`,
    transition: transitionMs > 0 ? `transform ${transitionMs}ms linear` : 'none',
  };
}

// Everything the sun animates about turns around its own centre, in the
// layer's user units. See the sun's own comment for why fill-box will
// not do.
const SUN_ORIGIN = {
  transformBox: 'view-box',
  transformOrigin: `${SKY_CX}px ${SKY_CY}px`,
} as const;

// Shared stroke props. Round caps and joins throughout — a pencil has no
// mitre.
const PEN = {
  fill: 'none',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  vectorEffect: 'non-scaling-stroke',
} as const;

export function ProfileSceneBackdrop({
  dogCenterX,
  cardWidth,
  transitionMs,
  mode,
}: BackdropProps) {
  const p = PALETTE[mode];
  return (
    <>
      {/* Sky + lawn wash — locked, no parallax. The sky runs the full
          height and the lawn is painted over it, so a dip in the
          horizon can never open a gap between the two. */}
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
        aria-hidden
      >
        <rect x={0} y={0} width={VIEW_W} height={VIEW_H} fill={p.sky} />
        <path d={GROUND_FILL} fill={p.ground} stroke="none" />
        <path d={HORIZON_LINE} {...PEN} stroke={p.ink} strokeWidth={W_HORIZON} />
      </svg>

      {/* Far layer — sun-or-moon, stars at night, clouds. */}
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        style={layerStyle(dogCenterX, cardWidth, 0.06, transitionMs)}
        aria-hidden
      >
        {/* Cloud drift keyframes — each cloud picks a different period
            and direction so the sky doesn't slide uniformly. Translates
            are in viewBox units (the SVG stretches with
            preserveAspectRatio="none", so they read as fractions of the
            sky width on screen). */}
        <style>{`
          @keyframes cloud-a { 0%,100% { transform: translateX(0); } 50% { transform: translateX(20px); } }
          @keyframes cloud-b { 0%,100% { transform: translateX(0); } 50% { transform: translateX(-16px); } }
          @keyframes cloud-c { 0%,100% { transform: translateX(0); } 50% { transform: translateX(24px); } }
          @keyframes cloud-d { 0%,100% { transform: translateX(0); } 50% { transform: translateX(-22px); } }
          /* Rays reach out and draw back; the disc rocks. Both are tiny
             on purpose — this is a drawing catching the light, not a
             loading spinner. */
          @keyframes sun-ray { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.14); } }
          @keyframes sun-wobble { 0%, 100% { transform: rotate(-2.5deg); } 50% { transform: rotate(2.5deg); } }
          @media (prefers-reduced-motion: reduce) {
            /* Somebody who has asked the system for less movement gets a
               still sun, and still clouds with it. */
            [data-sun], [data-cloud] { animation: none !important; }
          }
        `}</style>

        {mode === 'night'
          ? STAR_POS.map(([x, y]) => (
              <path
                key={`star-${x}-${y}`}
                d={`${stroke(x - 2, y, x + 2, y, 0)} ${stroke(x, y - 2, x, y + 2, 0)}`}
                {...PEN}
                stroke={p.ink}
                strokeWidth={W_FAR}
              />
            ))
          : null}

        {mode === 'day' ? (
          <g>
            {/* THE SUN IS THE ONE THING IN THE SKY THAT SHINES.
                Each ray breathes out and back on its own delay, so the
                shimmer travels round the disc instead of the whole star
                pulsing at once; the disc itself rocks a couple of degrees
                on a longer, prime-ish period so the two never lock into a
                single visible beat.

                transform-box: view-box with an explicit origin at the
                sun's centre — the default (fill-box) would scale each ray
                about ITS OWN bounding box, which for a short dash pointing
                outward is nowhere near the sun and would send the rays
                wandering off across the sky. */}
            <g data-sun style={{ animation: 'sun-wobble 13s ease-in-out infinite', ...SUN_ORIGIN }}>
              <path d={SUN_DISC} fill={p.sun} stroke="none" />
              <path d={SUN_DISC} {...PEN} stroke={p.ink} strokeWidth={W_FAR} />
            </g>
            {SUN_RAYS.map((d, i) => (
              <path
                key={`ray-${i}`}
                data-sun
                d={d}
                {...PEN}
                stroke={p.ink}
                strokeWidth={W_FAR}
                style={{
                  animation: `sun-ray 3.4s ease-in-out ${(i * 0.21).toFixed(2)}s infinite`,
                  ...SUN_ORIGIN,
                }}
              />
            ))}
          </g>
        ) : (
          <g>
            <path d={MOON_DISC} fill={p.moon} stroke="none" />
            <path d={MOON_DISC} {...PEN} stroke={p.ink} strokeWidth={W_FAR} />
            {/* The crater side, drawn as a line rather than filled — a
                second disc in sky colour would smear whatever drifts
                behind it. */}
            <path d={MOON_SHADE} {...PEN} stroke={p.ink} strokeWidth={W_FAR} opacity={0.5} />
          </g>
        )}

        {CLOUDS.map((c, i) => (
          <g key={`cloud-${i}`} data-cloud style={{ animation: c.animation }}>
            <path d={c.d} fill={p.cloud} stroke="none" />
            <path d={c.d} {...PEN} stroke={p.ink} strokeWidth={W_FAR} />
          </g>
        ))}
      </svg>

      {/* Mid layer — trees + lamppost. Lamp light cone added at night,
          drawn UNDER the lamppost itself so the post sits on top of the
          glow. */}
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        style={layerStyle(dogCenterX, cardWidth, 0.18, transitionMs)}
        aria-hidden
      >
        {mode === 'night' ? (
          <>
            {/* Light cone: short trapezoid from bulb (narrow top) to just
                below the bench (wide bottom), warm yellow with low alpha
                so the post + bench still read through. */}
            <polygon
              points={`${LAMP_X - 4},${LAMP_TOP + 6} ${LAMP_X + 5},${LAMP_TOP + 6} ${LAMP_X + 15},${GROUND_Y + 5} ${LAMP_X - 14},${GROUND_Y + 5}`}
              fill="rgba(255, 215, 130, 0.2)"
            />
            <polygon
              points={`${LAMP_X - 1},${LAMP_TOP + 6} ${LAMP_X + 2},${LAMP_TOP + 6} ${LAMP_X + 8},${GROUND_Y + 5} ${LAMP_X - 6},${GROUND_Y + 5}`}
              fill="rgba(255, 230, 160, 0.25)"
            />
          </>
        ) : null}

        {TREES.map((tree, i) => (
          <g key={`tree-${i}`}>
            {/* Trunk under crown, so the crown's own line closes over
                the top of it. */}
            <path d={tree.trunk} fill={p.trunk} stroke="none" />
            <path d={tree.trunk} {...PEN} stroke={p.ink} strokeWidth={W_MID} />
            <path d={tree.crown} fill={p.foliage} stroke="none" />
            <path d={tree.crown} {...PEN} stroke={p.ink} strokeWidth={W_MID} />
          </g>
        ))}

        <g>
          <path d={LAMP_STEM} {...PEN} stroke={p.ink} strokeWidth={W_MID} />
          <path d={LAMP_ARM} {...PEN} stroke={p.ink} strokeWidth={W_MID} />
          <path d={LAMP_HEAD} fill={p.lampBulb} stroke="none" />
          <path d={LAMP_HEAD} {...PEN} stroke={p.ink} strokeWidth={W_MID} />
        </g>

        {BENCH.map((d, i) => (
          <path key={`bench-${i}`} d={d} {...PEN} stroke={p.ink} strokeWidth={W_MID} />
        ))}
      </svg>

      {/* Near layer — grass tufts. Fastest parallax. */}
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        style={layerStyle(dogCenterX, cardWidth, 0.32, transitionMs)}
        aria-hidden
      >
        {TUFTS.map((d, i) => (
          <path key={`tuft-${i}`} d={d} {...PEN} stroke={p.ink} strokeWidth={W_TUFT} />
        ))}
      </svg>
    </>
  );
}
