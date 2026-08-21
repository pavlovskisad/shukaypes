// THE INK LINE, DRAWN BY HAND.
//
// Every edge in this app was a CSS border: geometrically perfect, the
// same on every card, and the one thing on screen that could not have
// come off the pen the rest of the artwork came off. The posters on the
// landing page are the reference — each frame is a wobbly rectangle,
// and no two are the same rectangle.
//
// So: an SVG outline drawn over the element instead of a border on it.
// The path follows the exact rounded rectangle a CSS border would have
// traced, then nudges each sampled point along its own normal by a
// little smooth noise. Corners stay circular, the straight runs bow
// slightly, and the amount is small enough to read as a hand rather
// than as a mistake.
//
// UNIQUE, not stamped. Pass a `seed` — a pet's id, a spot's id — and
// that thing keeps its own frame for as long as it exists, the same one
// every render. Leave it off and the element draws itself a fresh one
// when it mounts. Two cards side by side are never the same rectangle,
// which is the whole point of drawing them by hand.

import { useLayoutEffect, useRef, useState } from 'react';
import { INK } from '../../constants/surface';

// How far a point may wander off the true outline, in CSS px, on a
// full-size card. The brief was "a little bit uneven, but not too much"
// and this is that number.
const DEFAULT_AMP = 1.1;

// …but the same 1.25px is not the same amount of wobble on a 320px card
// and on a 68px disc. Flat, it made the radial menu's circles read as
// potatoes: two slow waves around a short perimeter is a bow on a long
// edge and a dent on a small one. So the amplitude scales with the
// element down to a floor, and small things stay nearly round.

// HOW MUCH PAPER SHOWS OUTSIDE THE LINE, in CSS px, on every surface
// that draws one. A sticker has a margin of backing around its artwork
// and that is the look; the amount just has to be the SAME everywhere,
// which it was not — a card drew its line flush to its own edge while a
// pill drew it 2px in, because the pill keeps a transparent border to
// hold the size a real one gave it and an inset:0 overlay lands inside
// that. One number now, applied from the border box out.
//
// It also has to clear DEFAULT_AMP, or on a big surface — where the
// wobble runs at full amplitude — the line bows OUT past the paper it
// is drawn on. Measured at 1: the pet cards came back at -0.44px, ink
// hanging over the edge.
export const PAPER_EDGE = 1.5;

const AMP_FULL_AT_PX = 150;
const AMP_MIN_SCALE = 0.3;

function ampFor(w: number, h: number, base: number): number {
  const s = Math.min(w, h) / AMP_FULL_AT_PX;
  return base * Math.max(AMP_MIN_SCALE, Math.min(1, s));
}

// Distance between sampled points along the outline. Small enough that a
// corner stays round, large enough that the noise reads as a slow bow
// rather than a tremor — and clamped by the shape's own perimeter, so a
// small circle still gets enough points to come out round.
const STEP_PX = 15;

function stepFor(perimeter: number): number {
  return Math.max(5, Math.min(STEP_PX, perimeter / 26));
}

function hashSeed(seed: string | number): number {
  const s = String(seed);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32 — small, fast, and deterministic, which is the only
// property that matters here: the same pet must get the same frame on
// every render or the card twitches.
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

interface Sample {
  x: number;
  y: number;
  // Outward normal, so the noise pushes the line off the shape rather
  // than along it — that is what makes a bowed edge instead of a
  // stretched one.
  nx: number;
  ny: number;
  // Distance travelled along the outline, so the noise is continuous
  // across the corners instead of restarting at each side.
  t: number;
}

// Walks the rounded rectangle and returns points along it. `open` names
// an edge to leave out, for the things docked against a screen edge:
// 'top' for the sheets that slide down from off-screen, 'right' for the
// pill docked to the right margin. The path then runs from one end of
// the missing edge to the other without closing, and the two corners it
// would have had stay square — which is what those elements already do
// with their own border radii.
function sampleRoundRect(
  w: number,
  h: number,
  r: number,
  open: OpenEdge,
  step: number,
): { pts: Sample[]; total: number } {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  const pts: Sample[] = [];
  let t = 0;

  // EVERY SEGMENT IS HALF-OPEN — it emits its start and not its end,
  // because the next segment's start IS that end.
  //
  // Emitting both put a DUPLICATE point at all eight junctions, which is
  // exactly where the corners are, and a spline through two points in
  // the same place has a zero-length tangent there: it goes locally
  // straight and then turns. That is what made the frames read as
  // "corner, straight bit, corner" — programmatic — instead of as a
  // line somebody drew. The circles never showed it because a circle is
  // four arcs with no straight runs between them.
  const line = (
    x0: number, y0: number, x1: number, y1: number,
    nx: number, ny: number,
  ) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.round(len / step));
    for (let i = 0; i < n; i++) {
      const f = i / n;
      pts.push({ x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, nx, ny, t: t + len * f });
    }
    t += len;
  };

  const arc = (cx: number, cy: number, a0: number, a1: number) => {
    const len = Math.abs(a1 - a0) * rr;
    const n = Math.max(2, Math.round(len / step));
    for (let i = 0; i < n; i++) {
      const a = a0 + (a1 - a0) * (i / n);
      pts.push({
        x: cx + Math.cos(a) * rr,
        y: cy + Math.sin(a) * rr,
        nx: Math.cos(a),
        ny: Math.sin(a),
        t: t + len * (i / n),
      });
    }
    t += len;
  };

  // The one point a half-open walk leaves out: where an OPEN path stops.
  // A closed one needs no such thing — it stops where it started.
  const end = (x: number, y: number, nx: number, ny: number) => {
    pts.push({ x, y, nx, ny, t });
  };

  if (open === 'top') {
    // Top-left, down the left side, around the bottom, up to top-right.
    line(0, 0, 0, h - rr, -1, 0);
    arc(rr, h - rr, Math.PI, Math.PI / 2);
    line(rr, h, w - rr, h, 0, 1);
    arc(w - rr, h - rr, Math.PI / 2, 0);
    line(w, h - rr, w, 0, 1, 0);
    end(w, 0, 1, 0);
  } else if (open === 'right') {
    // Top-right, back along the top, down the left, out along the
    // bottom to the right edge again.
    line(w, 0, rr, 0, 0, -1);
    arc(rr, rr, Math.PI * 1.5, Math.PI);
    line(0, rr, 0, h - rr, -1, 0);
    arc(rr, h - rr, Math.PI, Math.PI / 2);
    line(rr, h, w, h, 0, 1);
    end(w, h, 0, 1);
  } else {
    line(rr, 0, w - rr, 0, 0, -1);
    arc(w - rr, rr, -Math.PI / 2, 0);
    line(w, rr, w, h - rr, 1, 0);
    arc(w - rr, h - rr, 0, Math.PI / 2);
    line(w - rr, h, rr, h, 0, 1);
    arc(rr, h - rr, Math.PI / 2, Math.PI);
    line(0, h - rr, 0, rr, -1, 0);
    arc(rr, rr, Math.PI, Math.PI * 1.5);
  }
  return { pts, total: t };
}

// Smooth closed-loop noise: two sines at whole-number frequencies, so a
// closed outline meets itself exactly where it started and there is no
// seam at the top-left corner. Seeded phases and frequencies are what
// make one frame differ from the next.
//
// SLOW waves. The first cut ran 2–3 and 5–7 cycles around the outline
// and the faster one carried a third of the weight, which put a visible
// ripple along every edge. One or two long waves with a quiet second
// harmonic is what a hand actually does to a straight line: it drifts
// off and comes back, once, over the whole run.
function noiseFn(seed: number, closed: boolean, period: number) {
  const rand = rng(seed);
  const f1 = closed ? 1 + Math.floor(rand() * 2) : 0.8 + rand() * 0.6;
  const f2 = closed ? 3 + Math.floor(rand() * 2) : 2 + rand();
  const p1 = rand() * Math.PI * 2;
  const p2 = rand() * Math.PI * 2;
  const w2 = 0.14 + rand() * 0.14;
  return (t: number) => {
    const u = (t / period) * Math.PI * 2;
    return (Math.sin(u * f1 + p1) * (1 - w2) + Math.sin(u * f2 + p2) * w2);
  };
}

// CENTRIPETAL Catmull-Rom through the points, as cubic Béziers.
//
// The uniform version — control handles at (p2 - p0)/6 — assumes the
// points are evenly spaced, and ours are not: a corner packs several
// samples into a 20px arc while a card's edge spreads them over 250px.
// Uniform handles across that boundary either overshoot into a little
// loop or collapse toward zero and pinch, and a pinch is exactly what a
// corner drawn by a program looks like. Weighting each handle by the
// distance to its neighbour (alpha = 0.5, Barry–Goldman) removes both:
// no cusps, no self-intersection, no matter how uneven the spacing.
const CR_ALPHA = 0.5;

// Exported because it is the app's ONE answer to "draw a smooth line
// through these points" — the territory chips on the board run their
// simplified outlines through it so a claim reads as a drawn shape
// rather than a polygon. Same curve, same reasoning, one implementation.
export function splinePath(pts: { x: number; y: number }[], closed: boolean): string {
  const n = pts.length;
  if (n < 2) return '';
  const at = (i: number) => pts[closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i))]!;
  const knot = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.max(1e-4, Math.pow(Math.hypot(b.x - a.x, b.y - a.y), CR_ALPHA));
  let d = `M ${at(0).x.toFixed(2)} ${at(0).y.toFixed(2)}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1); const p1 = at(i); const p2 = at(i + 1); const p3 = at(i + 2);
    const d1 = knot(p0, p1); const d2 = knot(p1, p2); const d3 = knot(p2, p3);
    const c1x =
      (d1 * d1 * p2.x - d2 * d2 * p0.x + (2 * d1 * d1 + 3 * d1 * d2 + d2 * d2) * p1.x) /
      (3 * d1 * (d1 + d2));
    const c1y =
      (d1 * d1 * p2.y - d2 * d2 * p0.y + (2 * d1 * d1 + 3 * d1 * d2 + d2 * d2) * p1.y) /
      (3 * d1 * (d1 + d2));
    const c2x =
      (d3 * d3 * p1.x - d2 * d2 * p3.x + (2 * d3 * d3 + 3 * d3 * d2 + d2 * d2) * p2.x) /
      (3 * d3 * (d3 + d2));
    const c2y =
      (d3 * d3 * p1.y - d2 * d2 * p3.y + (2 * d3 * d3 + 3 * d3 * d2 + d2 * d2) * p2.y) /
      (3 * d3 * (d3 + d2));
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return closed ? `${d} Z` : d;
}

export type OpenEdge = 'top' | 'right' | undefined;

export function handDrawnRectPath(
  w: number,
  h: number,
  radius: number,
  seed: string | number,
  opts?: { amp?: number; open?: OpenEdge },
): string {
  if (!(w > 1 && h > 1)) return '';
  const amp = opts?.amp ?? DEFAULT_AMP;
  const open = opts?.open;
  // Perimeter of the true shape, for the sampling step. Close enough
  // from the box: the rounded corners only shorten it slightly.
  const step = stepFor(2 * (w + h));
  const { pts, total } = sampleRoundRect(w, h, radius, open, step);
  if (total <= 0) return '';
  const noise = noiseFn(hashSeed(seed), !open, total);
  const scaled = ampFor(w, h, amp);
  const moved = pts.map((p) => {
    const o = noise(p.t) * scaled;
    return { x: p.x + p.nx * o, y: p.y + p.ny * o };
  });
  return splinePath(moved, !open);
}

// Measures the box it is dropped into. The path is built in real pixels
// rather than in a stretched viewBox, so a corner on a wide card is the
// same round corner as on a narrow one instead of an ellipse.
function useBoxSize() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  // How wide the HOST's border is. Several of these elements keep a
  // transparent 2px border purely to hold the size a real one gave them
  // (see MODAL_PILL_LIGHT), and an absolutely-positioned child at
  // inset:0 lands on the PADDING box — 2px inside the paper's real
  // edge. Left alone, those surfaces showed 2px of white outside the
  // ink while a card with no border showed none, which is the "some
  // bigger, some smaller" the frames were called out for.
  const [hostBorder, setHostBorder] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    // offsetWidth/Height, NOT getBoundingClientRect. The rect is the
    // TRANSFORMED box, and half this app's chrome spends time under a
    // scale(): the HUD sits at scale(0) while the gate is up, and the
    // deck's peek cards live at scale(0.74). Measured through the rect,
    // a pill mounted behind the gate came back 0×0 and drew nothing —
    // and then never corrected itself, because a transform does not
    // resize the border box and ResizeObserver never fires for it.
    // The layout size is the honest one, and the SVG is scaled by the
    // same transform as everything else afterwards.
    const read = () => {
      const host = el.parentElement;
      const bw = host
        ? Math.round(parseFloat(getComputedStyle(host).borderTopWidth) || 0)
        : 0;
      setHostBorder((prev) => (prev === bw ? prev : bw));
      // With `inset: -hostBorder` below, this div spans the host's
      // BORDER box — the outline of the paper itself.
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hostBorder]);
  return { ref, size, hostBorder };
}

// A single drawn rule, for the places that ink one edge rather than
// four — the label band across a pet's card, a divider inside a sheet.
// Left as a straight CSS border it is the one perfect line among a
// screenful of drawn ones, which is exactly where the eye goes.
export function HandDrawnLine({
  seed,
  color = INK,
  strokeWidth = 2,
  amp = 1,
}: {
  seed?: string | number;
  color?: string;
  strokeWidth?: number;
  amp?: number;
}) {
  const { ref, size } = useBoxSize();
  const [ownSeed] = useState(() => Math.floor(Math.random() * 1e9));
  const w = size.w;
  let d = '';
  if (w > 1) {
    const noise = noiseFn(hashSeed(seed ?? ownSeed), false, w);
    const n = Math.max(2, Math.round(w / STEP_PX));
    const pts = Array.from({ length: n + 1 }, (_, i) => {
      const x = (w * i) / n;
      return { x, y: strokeWidth / 2 + noise(x) * amp };
    });
    d = splinePath(pts, false);
  }
  return (
    <div
      ref={ref}
      aria-hidden
      style={{ position: 'absolute', left: 0, right: 0, top: 0, height: strokeWidth * 2, pointerEvents: 'none' }}
    >
      {d ? (
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${size.w} ${strokeWidth * 2}`}
          style={{ display: 'block', overflow: 'visible' }}
        >
          <path d={d} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
        </svg>
      ) : null}
    </div>
  );
}

// Sampled points along a horizontal run, wobbled. Shared by the paper
// edge and the bars below.
function wobbleRun(w: number, seed: string | number, amp: number, y0: number) {
  const noise = noiseFn(hashSeed(seed), false, w);
  const n = Math.max(2, Math.round(w / STEP_PX));
  return Array.from({ length: n + 1 }, (_, i) => {
    const x = (w * i) / n;
    return { x, y: y0 + noise(x) * amp };
  });
}

// A PIECE OF PAPER WHOSE TOP EDGE IS THE DRAWN LINE.
//
// The pet card lays a white band across the bottom of the photo and
// inks the join. With a straight-edged band and a wobbly rule over it,
// the two disagree by a pixel or so all the way along — and wherever
// the rule dipped below the band's real edge, a sliver of white showed
// ABOVE the ink, between the photo and its own line. The photo looked
// cut by a ruler and then underlined slightly lower down.
//
// So the paper and the line are one shape: a filled path whose top runs
// along the wobble, with the same wobble stroked on top of it. There is
// nothing left to disagree.
export function HandDrawnPaperTop({
  seed,
  color = INK,
  fill = '#ffffff',
  strokeWidth = 2,
  amp = 1,
  // How far above the element the paper starts, so the wobble has room
  // to rise into instead of being clipped at the top of its own box.
  overhang = 6,
}: {
  seed?: string | number;
  color?: string;
  fill?: string;
  strokeWidth?: number;
  amp?: number;
  overhang?: number;
}) {
  const { ref, size } = useBoxSize();
  const [ownSeed] = useState(() => Math.floor(Math.random() * 1e9));
  let fillD = '';
  let strokeD = '';
  if (size.w > 1 && size.h > 1) {
    const pts = wobbleRun(size.w, seed ?? ownSeed, amp, overhang);
    strokeD = splinePath(pts, false);
    fillD = `${strokeD} L ${size.w.toFixed(2)} ${size.h.toFixed(2)} L 0 ${size.h.toFixed(2)} Z`;
  }
  return (
    <div
      ref={ref}
      aria-hidden
      // NO z-index. Its siblings inside the band are positioned too (an
      // RN View is position:relative on web), so DOM order alone puts
      // the words above the paper.
      style={{ position: 'absolute', left: 0, right: 0, top: -overhang, bottom: 0, pointerEvents: 'none' }}
    >
      {fillD ? (
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${size.w} ${size.h}`}
          style={{ display: 'block', overflow: 'visible' }}
        >
          <path d={fillD} fill={fill} stroke="none" />
          <path d={strokeD} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
        </svg>
      ) : null}
    </div>
  );
}

// A PROGRESS BAR AS A STROKE, not as two nested rectangles.
//
// A rectangle inside a rectangle is the one shape on these screens that
// could only have been laid out by a machine. Drawn instead: one line
// the height of the bar, wobbling gently along its length, with the
// filled part painted over the track on the same path — so the two can
// never disagree about where the bar runs. Round caps give the ends
// their radius for free, and the leading edge of the fill lands on the
// track like a marker stopping.
//
// The fill is the SAME path with `pathLength=1` and a dash of the
// progress fraction, which is exact along the curve rather than a width
// percentage that would ignore the wobble.
export function HandDrawnBar({
  progress,
  seed,
  height = 6,
  color = INK,
  trackColor = '#ececec',
  amp = 0.6,
}: {
  // 0…1.
  progress: number;
  seed?: string | number;
  height?: number;
  color?: string;
  trackColor?: string;
  amp?: number;
}) {
  const { ref, size } = useBoxSize();
  const [ownSeed] = useState(() => Math.floor(Math.random() * 1e9));
  const p = Math.max(0, Math.min(1, progress));
  let d = '';
  if (size.w > 1) {
    // Inset by half the stroke so the round caps sit inside the box
    // rather than hanging off both ends.
    const inset = height / 2;
    const run = Math.max(1, size.w - height);
    const pts = wobbleRun(run, seed ?? ownSeed, amp, height / 2).map((q) => ({
      x: q.x + inset,
      y: q.y,
    }));
    d = splinePath(pts, false);
  }
  return (
    <div ref={ref} style={{ position: 'relative', width: '100%', height }}>
      {d ? (
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${size.w} ${height}`}
          style={{ display: 'block', overflow: 'visible' }}
        >
          <path d={d} fill="none" stroke={trackColor} strokeWidth={height} strokeLinecap="round" />
          {p > 0 ? (
            <path
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={height}
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray={`${p} 1`}
            />
          ) : null}
        </svg>
      ) : null}
    </div>
  );
}

interface FrameProps {
  // Corner radius the frame should trace. Match whatever the element
  // itself is rounded to, or the ink and the fill disagree.
  radius: number;
  // A pet id, a spot id — anything stable that identifies the thing
  // being framed. Omit and the element gets its own on mount.
  seed?: string | number;
  color?: string;
  strokeWidth?: number;
  amp?: number;
  // An edge that runs off the screen and does not need drawing — see
  // sampleRoundRect. Sheets open at the top, the restack pill at the
  // right.
  open?: OpenEdge;
}

export function HandDrawnFrame({
  radius,
  seed,
  color = INK,
  strokeWidth = 2,
  amp,
  open,
}: FrameProps) {
  const { ref, size, hostBorder } = useBoxSize();
  // One seed per mount when the caller has nothing stable to offer. In
  // state, not a ref computed inline, so a re-render never re-rolls it.
  const [ownSeed] = useState(() => Math.floor(Math.random() * 1e9));
  // Where the line sits, measured from the paper's outer edge: PAPER_EDGE
  // of white, then the stroke. Same number on a card, a pill, a disc and
  // a close button — see the constant.
  const inset = PAPER_EDGE + strokeWidth / 2;
  const d =
    size.w > 0
      ? handDrawnRectPath(
          size.w - inset * 2,
          size.h - inset * 2,
          Math.max(0, radius - inset),
          seed ?? ownSeed,
          { ...(amp != null ? { amp } : {}), ...(open ? { open } : {}) },
        )
      : '';
  return (
    <div
      ref={ref}
      aria-hidden
      style={{
        position: 'absolute',
        // Out to the host's BORDER box, so the ink is measured from the
        // edge of the paper rather than from the inside of a border that
        // is only there to hold a size. See useBoxSize.
        inset: -hostBorder,
        pointerEvents: 'none',
        // Above the element's own content — this is its edge, and an
        // edge that a photo can paint over is not an edge.
        zIndex: 1,
      }}
    >
      {d ? (
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${size.w} ${size.h}`}
          style={{ display: 'block', overflow: 'visible' }}
        >
          <path
            d={d}
            transform={`translate(${inset},${inset})`}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </div>
  );
}
