// A territory, small enough to sit next to a name.
//
// The board draws each owner's LARGEST piece in their colour — the same
// shape their claim has on the map, so a player who has walked past "the
// red blob by the fountain" recognises it in the standings. It is
// identity, not measurement: the miniature is normalised to fit its box,
// so a huge claim and a modest one draw at the same size and the area
// counter next to it stays the honest number.
//
// Raw DOM <svg>, the ProfileSceneBackdrop pattern — react-native-web
// passes it straight through, and the quests tab is already web-committed
// (it injects keyframes into document.head). No native path exists yet;
// the native map itself is a stub.
//
// A CLAIMED FIELD: PALE INSIDE, DASHED AT THE EDGE.
//
// Three constructions came before this one and all three were trying to
// reproduce the MAP's finish — a soft heat field, blurred at the border
// and hot in the core. The last of them got close (contour bands eroded
// inward, hard steps, density building toward the middle) and it is gone
// anyway, because reproducing the map's finish was never the job. What a
// row needs is a SHAPE you can recognise, and a blob with a soft edge is
// the one thing a shape cannot survive at 92px: the outline is where the
// identity lives, and every version so far spent its best pixels
// dissolving exactly that.
//
// So the outline is now the loudest thing in the chip — a dashed stroke
// at full strength — and the fill drops to a wash behind it. Dashed
// rather than solid because a claim is a boundary somebody walked, not a
// fence: the same reason a surveyor's plot and a national border are
// drawn broken on every map that isn't trying to say "wall".
//
// And the outline is SIMPLIFIED before it is drawn — see the
// Simplification block below. A real claim's edge is a staircase of
// metre-scale steps, which at 92px is finer than the dash period; drawn
// literally, the line spends its whole length turning and the chip
// reads as a scribble. Douglas–Peucker at a tolerance stated in
// rendered pixels drops exactly the detail that cannot be seen as
// shape, and moves no vertex that survives. Before and after that, the
// ring's fold-backs are unpicked — see the Slits block — because the
// board is sent outer rings with the holes dropped, and a pocket that
// reaches the edge comes back as a zero-width slit that stroking turns
// into a line straight through the claim.
//
// What is left is then drawn as a CURVE through those points rather than
// as a polygon — splinePath, the same centripetal Catmull-Rom every
// hand-drawn border in the app uses. A dozen hard corners at 92px read
// as a cut-out; the same dozen points on a smooth line read as a place.
// The curve passes through every one of them, so the corners stay where
// the ground turns — they are only no longer sharp. It is drawn at
// PART curvature (see ROUNDNESS): the full curve made pebbles of the
// claims, and ground has corners on it.
//
// KNOWN AND ACCEPTED: the chip no longer matches the map's finish. The
// map paints territory as a soft field with deliberately no borders (see
// TerritoryLayer's header, which argues that case at length and is still
// right — at city scale, over three hundred pixels of ground, an outline
// reads as a diagram). The SHAPE is what carries between the two, and
// that is unchanged: same hull, same proportions, north up.

import { useMemo } from 'react';
import { lineColorCss } from '../map/territoryColor';
import { splinePath } from './HandDrawn';

// Big enough that a 48-corner hull keeps its corners, small enough to
// stay cheap on a sheet holding a hundred of these. Rendered size is
// per-use.
const BOX = 64;
// Breathing room inside the box — the stroke is centred on the outline,
// so half of STROKE_W hangs outside the outline and has to fit — as
// does the little the smoothed curve bows past a corner.
const PAD = 5;

// In viewBox units. At the board's 92px the box scales by ~1.44, so
// these land at ~2.3px of ink with a ~5px dash and a ~4px gap.
//
// Finer than the first cut (2 / 5 / 3.5, i.e. ~3px of ink and a 7px
// dash). That weight was set against the board's biggest claims, where
// the outline has room; on a small one the dashes were nearly as thick
// as the shape's own features and the chip read as heavy. A shorter dash
// also takes a corner better — a long one spanning a turn draws it as a
// bent stick, and a claim's outline is mostly corners.
const STROKE_W = 1.6;
const DASH = '3.6 2.6';
// The wash behind the line. Low, because the line is doing the work: at
// anything denser the chip goes back to being a coloured blob with a
// decoration around it.
const FILL_ALPHA = 0.22;

// HOW MUCH OF A CURVE, on the scale splinePath takes: 1 is the full
// Catmull-Rom, 0 is the polygon it was fitted to.
//
// It went out at 1 and came back as too rounded, which is fair — a claim
// is ground with corners on it, and at full curvature the chips started
// to read as pebbles. This is the dial between the two complaints: at
// 0.55 a corner still turns rather than folds, but it turns over a short
// enough run that the straight between two corners is visibly straight.
// Nothing about which corners exist changes; only how sharply each one
// is taken.
const ROUNDNESS = 0.55;

// ── Simplification ──────────────────────────────────────────────────
// HOW MUCH DETAIL IS TOO SMALL TO BE DETAIL, in RENDERED pixels.
//
// A real claim does not arrive as the tidy hull the first test shapes
// were. The server partitions ground by nearest mark, so an outline
// comes back as a staircase of small steps with the odd deep inlet
// where a neighbour bit in — perfectly good geometry at map scale,
// where a step is metres across. Squeezed into 92px the steps land at
// under a pixel each, finer than the dash period, so the line spends
// its whole length turning and the chip reads as a scribble instead of
// a shape.
//
// Douglas–Peucker, with the tolerance stated in pixels ON SCREEN and
// converted into viewBox units per render. That is the honest way to
// say it: the rule is "drop what is smaller than the eye can resolve
// here", so it has to be measured where the eye is, not in the
// coordinate space. A chip drawn bigger keeps more detail for free.
//
// This step is a SIMPLIFIER and not a smoother: it only ever removes,
// and every vertex it keeps is a real corner of the real claim in its
// real place. A deep inlet survives (it is far from the chord that would
// replace it, which is exactly what the algorithm measures); a one-pixel
// stair does not. The rounding happens later and separately, as a curve
// drawn THROUGH these points — so what is decided here is which corners
// are real, and nothing here invents one.
//
// 4.2px, measured on hulls built to look like the real ones (a
// staircase blob, one with a neighbour's bite out of it, one nearly
// round). The ladder, on the noisiest of them:
//
//   raw   90 vertices, 2.6px mean edge — the scribble
//   2.2   27 vertices, 8.8px  — still rippling, edges under the dash
//   3.2   13 vertices, 16.9px — quiet
//   4.2    8 vertices, 26.9px — a form
//
// The last step is the owner's call and is deliberately an accuracy
// trade: at 4.2 a shallow lobe flattens into the body and a claim comes
// out as a form rather than a survey. What it may NOT cost is identity,
// and that is what the fixtures check: the bite still reads as a bite at
// 4.2, and the perimeter is within 8% of the original. Douglas–Peucker
// bounds the error at the tolerance itself — no drawn edge sits further
// than this from the outline it replaced, i.e. 4.6% of the chip.
const SIMPLIFY_PX = 4.2;
// Never simplify a shape down to a triangle. Below this the outline has
// stopped being recognisable as anywhere, so a claim that reduces that
// far keeps the last tolerance that keeps it above the floor.
const MIN_VERTS = 8;

// ── Slits ───────────────────────────────────────────────────────────
// THE RING WALKS INTO THE SHAPE AND BACK OUT, AND WE HAVE TO UNPICK IT.
//
// Simplification alone left the board with lines running through the
// middle of several claims — Найда, Марс and Рекс all had one. It is not
// noise and no tolerance removes it, because the vertices are real: the
// board is sent the OUTER RING ONLY (ground.ts:117 — "at thumbnail size
// a hole is noise"), and a pocket that reaches the piece's edge cannot
// be expressed as a hole in an outer ring. The clipper renders it as a
// zero-width slit instead: the boundary walks in along one side of the
// pocket and back out along the other. On the map that slit is invisible
// — it has no width. Stroked at 2px it is a line straight through the
// claim, and where two of them cross, the nonzero fill turns inside out.
//
// A slit's tip is a vertex whose two edges point in OPPOSITE directions
// — the path folds back on itself. So: drop those, and the two sides of
// the slit become adjacent; their tips now fold back too, and the next
// pass takes them. The slit unzips from the inside out in a handful of
// passes, and nothing that isn't a fold-back is touched.
//
// A genuine peninsula narrow enough to look like a fold-back goes with
// them, and that is the right trade at this size: it was one pixel wide
// and unreadable as ground either way.
//
// cos(160°) — the two edges have to be within 20° of a true reversal.
const SPIKE_COS = -0.94;
// AND THE ARMS THAT ARE NOT QUITE FOLD-BACKS.
//
// The angle test alone left thin arms standing on the live board — Молі
// and Тузік both had a couple. They are the same artefact as a slit,
// just not as tight: a pocket that reaches the edge at a slight angle
// leaves a wedge instead of a zero-width cut, and a wedge turns 140°
// where a slit turns 180°. Loosening the angle would take real corners
// with it, so the second test is about WIDTH instead: a vertex whose two
// neighbours are less than this far apart, and which sticks out further
// than that gap is wide, is the tip of something thinner than it is
// long. At the size this is drawn, that is a hair, not ground.
//
// In rendered pixels, like every other threshold here.
const NEEDLE_W_PX = 4.5;
// Passes. A slit is peeled a vertex at a time from each end, so the
// count bounds how deep a slit can be unpicked; measured against real
// claims, everything resolved inside four.
const SPIKE_PASSES = 12;
// The floor for the pass that runs AFTER simplification. Lower than
// MIN_VERTS on purpose — see the call site.
const SPIKE_FLOOR = 6;

function dropSpikes(
  pts: [number, number][],
  floor: number,
  needleW: number,
): [number, number][] {
  let ring = pts;
  for (let pass = 0; pass < SPIKE_PASSES; pass++) {
    if (ring.length <= floor) return ring;
    const keep: [number, number][] = [];
    for (let i = 0; i < ring.length; i++) {
      const prev = ring[(i - 1 + ring.length) % ring.length]!;
      const cur = ring[i]!;
      const next = ring[(i + 1) % ring.length]!;
      const ax = cur[0] - prev[0];
      const ay = cur[1] - prev[1];
      const bx = next[0] - cur[0];
      const by = next[1] - cur[1];
      const la = Math.hypot(ax, ay);
      const lb = Math.hypot(bx, by);
      // A duplicated vertex has no direction to judge; drop it, since it
      // is exactly what a collapsed slit leaves behind.
      if (la === 0 || lb === 0) continue;
      if ((ax * bx + ay * by) / (la * lb) < SPIKE_COS) continue;
      // Thinner than it is long — see NEEDLE_W_PX. The height is measured
      // to the chord the neighbours span, which is what "sticks out" has
      // to mean on a shape with no notion of inside.
      const gap = Math.hypot(next[0] - prev[0], next[1] - prev[1]);
      if (gap < needleW && segDist2(cur, prev, next) > gap * gap) continue;
      keep.push(cur);
    }
    if (keep.length === ring.length) return ring;
    if (keep.length < floor) return ring;
    ring = keep;
  }
  return ring;
}

// ── Necks ───────────────────────────────────────────────────────────
// AN ARM IS NOT A VERTEX, SO STOP TESTING VERTICES.
//
// The fold-back test above cleared the slits, and a per-vertex width
// test was added after it for the arms that were merely thin rather than
// folded — and the arms survived anyway. They survived because they are
// not one vertex. An arm is a run of them: out along one side, round a
// tip, back along the other. No single vertex in it looks wrong. The
// per-vertex test could only ever catch the tip, and cutting the tip off
// an arm leaves a slightly shorter arm.
//
// What actually defines an arm is its NECK — two points that are close
// together on the page but far apart along the outline. Walk the ring
// from one to the other the short way and you have gone all the way out
// and back; walk it the long way and you have gone round the whole
// claim. So: find the closest such pair, and if the short way round is a
// small enough share of the whole outline, drop everything between them.
// The arm comes off at the neck in one cut, not a vertex at a time.
//
// THE SHARE IS THE SAFETY RAIL. A claim really can be two lobes joined
// by an isthmus — walk a park and then the street behind it and that is
// what you get — and that second lobe is not a hair, it is half of what
// somebody holds. Cutting is therefore refused once the piece being
// removed is more than about a third of the outline: below that it is a
// hair on a shape, above it, it is one of the shape's two halves.
//
// In rendered pixels, like every other threshold here.
const NECK_W_PX = 7;
// And the excursion has to be a real one — at least this many necks'
// worth of outline — so a merely dented edge is left alone.
const NECK_MIN_ARC = 2.2;
// Above this share of the perimeter it is not an arm, it is a lobe.
const NECK_MAX_FRAC = 0.34;
// One arm per pass; a claim with more than a few is already unreadable.
const NECK_PASSES = 6;

function cutNecks(
  pts: [number, number][],
  neckW: number,
  floor: number,
): [number, number][] {
  let ring = pts;
  for (let pass = 0; pass < NECK_PASSES; pass++) {
    const n = ring.length;
    if (n <= floor) return ring;
    const seg: number[] = [];
    let total = 0;
    for (let i = 0; i < n; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % n]!;
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      seg.push(d);
      total += d;
    }
    if (total <= 0) return ring;
    // Forward arc length from i to j, wrapping.
    const arc = (i: number, j: number) => {
      let s = 0;
      for (let k = i; k !== j; k = (k + 1) % n) s += seg[k]!;
      return s;
    };
    // The tightest neck worth cutting. Tightest rather than first, so a
    // shape with two arms loses the more egregious one first and the
    // next pass re-measures against what is left.
    let best: { from: number; to: number; gap: number } | null = null;
    for (let i = 0; i < n; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const a = ring[i]!;
        const b = ring[j]!;
        const gap = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (gap >= neckW) continue;
        const fwd = arc(i, j);
        const back = total - fwd;
        // Cut whichever side is the excursion: the shorter one.
        const [from, to, cut] = fwd <= back ? [i, j, fwd] : [j, i, back];
        if (cut < neckW * NECK_MIN_ARC) continue;
        if (cut > total * NECK_MAX_FRAC) continue;
        // Removing the interior must leave a ring, not a line.
        const removed = (to - from + n) % n;
        if (n - (removed - 1) < floor) continue;
        if (!best || gap < best.gap) best = { from, to, gap };
      }
    }
    if (!best) return ring;
    const kept: [number, number][] = [];
    for (let k = best.to; ; k = (k + 1) % n) {
      kept.push(ring[k]!);
      if (k === best.from) break;
    }
    ring = kept;
  }
  return ring;
}

// Perpendicular distance from p to the segment ab, squared.
function segDist2(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return (p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2;
  // Clamped, so a point past either end measures to the endpoint rather
  // than to the infinite line — otherwise a spike hanging off the end of
  // a chord scores as if it were beside it.
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)),
  );
  return (p[0] - (a[0] + t * dx)) ** 2 + (p[1] - (a[1] + t * dy)) ** 2;
}

// Douglas–Peucker over an open chain, endpoints always kept.
function rdp(pts: [number, number][], tol2: number): [number, number][] {
  if (pts.length < 3) return pts;
  let worst = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist2(pts[i]!, pts[0]!, pts[pts.length - 1]!);
    if (d > worst) {
      worst = d;
      idx = i;
    }
  }
  if (worst <= tol2) return [pts[0]!, pts[pts.length - 1]!];
  return [
    ...rdp(pts.slice(0, idx + 1), tol2).slice(0, -1),
    ...rdp(pts.slice(idx), tol2),
  ];
}

// The same, for a CLOSED ring. A ring has no endpoints to anchor, and
// anchoring an arbitrary one (whichever vertex the server happened to
// list first) puts a permanent kink there and simplifies the rest
// around it. So the two anchors are chosen from the shape itself — the
// extreme point and the point furthest from it, i.e. its longest
// diagonal — and each half is simplified as its own chain.
function simplifyRing(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length < 5) return pts;
  let a = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i]![0] < pts[a]![0] || (pts[i]![0] === pts[a]![0] && pts[i]![1] < pts[a]![1])) a = i;
  }
  let b = a;
  let far = -1;
  for (let i = 0; i < pts.length; i++) {
    const d = (pts[i]![0] - pts[a]![0]) ** 2 + (pts[i]![1] - pts[a]![1]) ** 2;
    if (d > far) {
      far = d;
      b = i;
    }
  }
  const rot = [...pts.slice(a), ...pts.slice(0, a)];
  const cut = (b - a + pts.length) % pts.length;
  const tol2 = tol * tol;
  const half1 = rdp(rot.slice(0, cut + 1), tol2);
  const half2 = rdp([...rot.slice(cut), rot[0]!], tol2);
  // Both halves carry the anchors; drop the duplicates at the seams.
  return [...half1.slice(0, -1), ...half2.slice(0, -1)];
}

export function TerritoryMini({
  points,
  color,
  size,
}: {
  points: { lat: number; lng: number }[] | undefined;
  color: string;
  size: number;
}) {
  // The finished outline as an SVG path `d`, or null when there is no
  // geometry to draw.
  const d = useMemo(() => {
    if (!points || points.length < 3) return null;
    // Locally flat projection: metres east vs metres north (scaled by
    // cos(lat) so a shape drawn here has the same proportions it has on
    // the map), then fit into the box preserving aspect, centred, with
    // north up.
    const midLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
    const kx = Math.cos((midLat * Math.PI) / 180);
    const xs = points.map((p) => p.lng * kx);
    const ys = points.map((p) => -p.lat);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const span = Math.max(maxX - minX, maxY - minY) || 1;
    const scale = (BOX - PAD * 2) / span;
    const offX = (BOX - (maxX - minX) * scale) / 2;
    const offY = (BOX - (maxY - minY) * scale) / 2;
    const fitted: [number, number][] = points.map((_, i) => [
      (xs[i]! - minX) * scale + offX,
      (ys[i]! - minY) * scale + offY,
    ]);

    // Simplified AFTER the fit, so the tolerance is in the same space the
    // chip is drawn in and one number means the same thing for a claim of
    // any real size. SIMPLIFY_PX is rendered pixels; the viewBox is BOX
    // units wide and drawn `size` across, hence the conversion.
    const px = BOX / Math.max(1, size);
    const tol = SIMPLIFY_PX * px;
    const needleW = NEEDLE_W_PX * px;
    const neckW = NECK_W_PX * px;
    // Slits first, THEN simplify. The other order fails: a slit's two
    // sides are a matched pair of near-identical chains, and
    // Douglas–Peucker thins each of them independently, so they stop
    // lining up and what was a clean fold-back becomes a thin wedge no
    // angle test recognises.
    // Fold-backs, then arms, THEN simplify. Order matters twice over: a
    // slit's two sides are a matched pair of near-identical chains, and
    // Douglas–Peucker thins each of them independently, so simplifying
    // first turns a clean fold-back into a wedge no angle test
    // recognises — and the neck search wants the dense ring, where the
    // two sides of a neck still have points opposite each other to be
    // found by.
    const clean = cutNecks(dropSpikes(fitted, MIN_VERTS, needleW), neckW, MIN_VERTS);
    let simple = simplifyRing(clean, tol);
    // Backing off rather than giving up: a shape that simplifies below
    // the floor gets progressively gentler tolerances until it clears it,
    // and keeps its full outline if even that can't.
    for (let t = tol; simple.length < MIN_VERTS && t > tol / 8; t /= 2) {
      simple = simplifyRing(clean, t / 2);
    }
    if (simple.length < 3) simple = clean.length >= 3 ? clean : fitted;

    // AND AGAIN, AFTER. Measured: cleaning slits before simplification
    // got self-crossings to zero but left 173° fold-backs behind, because
    // simplification MAKES needles as readily as it removes them — the
    // two sides of a narrow neck get thinned independently and no longer
    // cancel. So the same test runs over the finished ring, on a dozen
    // vertices rather than a hundred, with a lower floor: by this point
    // every vertex left is load-bearing, and a spike among them is worth
    // more than the count.
    const cut = cutNecks(dropSpikes(simple, SPIKE_FLOOR, needleW), neckW, SPIKE_FLOOR);

    // LAST GATE, AND IT IS NOT DECORATION.
    //
    // Every stage above can remove points, each has its own floor, and
    // the floors are per-stage — so a pathological ring can walk down
    // through all of them and arrive with two points, which splinePath
    // correctly refuses to make a shape out of. A probe caught exactly
    // that and the chip rendered an EMPTY path: no outline, no wash, a
    // blank square where a claim should be. Whatever else the cleanup
    // decides, the answer has to be a shape.
    const drawn =
      cut.length >= 3
        ? cut
        : simple.length >= 3
          ? simple
          : clean.length >= 3
            ? clean
            : fitted;

    // DRAWN AS A CURVE, NOT A POLYGON.
    //
    // Everything above earns its shape by removing things; this is the
    // one step that adds. A simplified ring is a dozen straight runs
    // meeting at hard corners, and a dozen hard corners at 92px read as
    // a cut-out rather than a place. splinePath is the app's one answer
    // to "draw a smooth line through these points" — the same
    // centripetal Catmull-Rom every hand-drawn border uses, chosen there
    // precisely because it does not overshoot or pinch when the points
    // are unevenly spaced, which after simplification they always are.
    //
    // The curve passes THROUGH every vertex, so nothing moves: the
    // corners are where the ground turns, they are just no longer sharp.
    return splinePath(
      drawn.map(([x, y]) => ({ x, y })),
      true,
      ROUNDNESS,
    );
  }, [points, size]);

  // One shape, one wash, one dashed edge — the same paint whether we have
  // a real hull or the placeholder. No piece to draw (an older server, or
  // ground lost mid-read) falls back to a circle: a claim we cannot draw,
  // drawn as the most neutral shape there is, rather than a gap in the
  // column where every other row has something.
  // The wash is the owner's colour as the map paints it; the line is the
  // same colour taken down far enough to BE a line on a white card — see
  // lineColorCss, which measures the case the palette was never scored
  // for. Your own blue passes through unchanged.
  const paint = {
    fill: color,
    fillOpacity: FILL_ALPHA,
    stroke: lineColorCss(color),
    strokeWidth: STROKE_W,
    strokeDasharray: DASH,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
  };

  return (
    <svg viewBox={`0 0 ${BOX} ${BOX}`} width={size} height={size} aria-hidden>
      {d ? (
        <path d={d} {...paint} />
      ) : (
        <circle cx={BOX / 2} cy={BOX / 2} r={BOX / 2 - PAD} {...paint} />
      )}
    </svg>
  );
}
