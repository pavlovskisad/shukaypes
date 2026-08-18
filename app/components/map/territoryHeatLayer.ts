// Soft territory rendering — the server's polygons, drawn as scent.
//
// The data model does not change here, and that matters. Model 1 (the cell
// grid with a heatmap) died because ownership on a grid cannot make a
// shape; this is NOT that. The geometry drawn below is the exact partition
// the server stores — every hole, every bite — the ownership truth is
// still the polygon. What changes is the finish: instead of a hard-edged
// vector fill that reads as a boardgame diagram, the polygons are rendered
// offscreen, blurred, and re-thresholded, so a claim sits on the city like
// a cloud of scent with a soft, slightly wavy edge. Squint and it's a
// weather map; measure and it's still the hull.
//
// The pipeline, per frame:
//
//   1. POLYGONS  — triangulated server shapes, each vertex carrying its
//                  owner's colour, drawn crisp into a small offscreen
//                  buffer (quarter resolution: cheap, and the downsample
//                  is itself the first blur tap).
//   2. BLUR      — separable gaussian, radius tied to zoom so the soft
//                  edge is roughly a constant number of METRES: soft when
//                  you're standing on the border, near-crisp when the
//                  whole city is on screen and detail is what's wanted.
//   3. COMPOSITE — a fullscreen pass re-thresholds the blurred coverage
//                  into a shape (smoothstep centred on 0.5, so the edge
//                  stays where the server put it), wobbles the threshold
//                  with world-anchored noise so borders meander a little
//                  instead of being uniformly rounded, and un-premultiplies
//                  the blurred colours — which is what makes two owners'
//                  ground CROSSFADE through a gradient where they meet
//                  instead of butting at a hairline.
//
// Where one owner's ground meets another's, coverage stays ~1 (both sides
// are painted), so the rim glow and the wobble act only on the OUTER edge
// against unclaimed ground; the shared border just blends colour. Zones
// still can't fight for pixels: groups draw in order with no blending, so
// the caller putting your own ground last keeps "which bit is mine"
// authoritative, same as the old fill layer.
//
// Precision: mercator coords at city zoom don't survive float32, so the
// mesh stores offsets from an anchor and the anchor is folded into the
// matrix in float64 before upload — the same relative-to-origin trick the
// 3D buildings use.
//
// If anything in GL setup fails, the layer reports through onFail and the
// caller falls back to the classic flat fill — territory must never
// silently vanish on an odd device.

import { MercatorCoordinate } from 'maplibre-gl';
import type {
  CustomLayerInterface,
  CustomRenderMethodInput,
  Map as MlMap,
} from 'maplibre-gl';
import earcut from 'earcut';
import { publishTerritoryField, SEAM_FADE, urlTune } from './territoryField';
import type { TerritoryShape } from '../../services/api';

export const TERRITORY_HEAT_LAYER_ID = 'territory-heat';

export interface TerritoryHeatGroup {
  shapes: TerritoryShape[];
  // sRGB 0..1 — ownerColorRgb / OWN_COLOR_RGB from territoryColor.ts.
  color: [number, number, number];
}

export interface TerritoryHeatLayer extends CustomLayerInterface {
  setGroups(groups: TerritoryHeatGroup[]): void;
}

type GL = WebGLRenderingContext | WebGL2RenderingContext;

// Offscreen buffers at 1/4 of the canvas in CSS pixels — DOWNSCALE is
// multiplied by devicePixelRatio at target-creation time. In physical
// pixels the first cut of this undersampled on phones: a dpr-3 screen made
// the blur radius three times larger in texels than the 9-tap kernel could
// sample cleanly, and the soft edge came out banded and crunchy — the
// exact opposite of soft. Constant CSS-pixel resolution keeps the kernel
// in range on every screen (and makes the passes cheaper exactly where
// the GPU is weakest).
const DOWNSCALE = 4;

// The polygons are rasterised at TWICE the working resolution and boxed
// down into it. Without that, coverage in the working buffer is binary
// per texel — a shape's edge can only sit on a texel boundary — so a
// half-pixel pan flips whole texels and the blurred field jumps with
// them. That is the crawl: measured, a half-pixel pan at city zoom moved
// individual pixels by up to 63/255. Averaging 2×2 samples makes the
// stored coverage a fraction instead of a flag, and the edge slides
// between texels the way the map does.
const SUPERSAMPLE = 2;

// The offscreen buffers cover more ground than the screen does. The wide
// depth blur reaches hundreds of pixels, and at the edge of a buffer
// there is nothing to reach INTO — the sampler repeats the last texel,
// so the field near the screen edge was invented from whatever sat on
// the border, and it changed as you panned. The whole field breathed.
// This is the margin per side, as a fraction of the viewport.
const PAD = 0.3;
const PAD_F = 1 + 2 * PAD;

// The soft edge, in metres of ground. Constant metres — not constant
// pixels — is what keeps the look honest at both ends: standing at a
// border you see a ~25m gradient underfoot; zoomed out to the whole city
// the clamp takes over and shapes stay readable instead of dissolving
// into fog. The px clamps also protect the blur kernel's sampling range.
const EDGE_SOFT_M = 26;
// The floor is not cosmetic. Below about 2 buffer texels the field
// carries detail finer than the grid it is sampled on, and that aliases
// into a shimmer whenever the map moves — which is why the shaking was
// worst zoomed out, where this clamp is what sets the width. It only
// binds below about z14.6; nearer the ground the metres win.
const MIN_RADIUS_PX = 10; // CSS px
const MAX_RADIUS_PX = 32; // CSS px

// ── How deep inside your own ground am I? ────────────────────────────
// The shape's edge is a 26m ramp, so coverage is a flat 1.0 two streets
// in: cutting more bands out of it can only ever decorate the border,
// never concentrate a claim's strength toward its middle. That needs a
// second, much wider field — the same coverage blurred until it stops
// being an edge and becomes a distance — which is what these extra
// iterations build. Gaussians compose, so re-running the kernel widens
// it by √n rather than needing a kernel nobody can sample cleanly.
const DEPTH_ITERS = 6;
// The wide field alone says "deep inside CLAIMED ground", not "deep
// inside YOURS" — where two owners meet, both sides are painted and it
// never dips, the same wall the contour experiment hit. The way past it
// without a pass per owner: the wide blur MIXES the neighbour's colour
// in, and the sharp field does not. How far the two colours have drifted
// apart is therefore a per-owner depth, free, from textures already
// bound. SEAM_FADE (in territoryField.ts, because the buildings read the
// field the same way) scales that drift into a 0..1 fade.

// EXPERIMENT — the board chip's construction, on the map. Off unless
// the URL says ?contours=1, so this costs nothing until somebody asks
// for it, and comparing the two is a page reload rather than a build.
//
// The chip draws its heat as CONTOURS: nested bands, each a hard step,
// stacked so the colour builds toward a hot core (see TerritoryMini).
// It gets its bands by eroding the silhouette, which a fragment shader
// has no cheap way to do — but it does not need one. Thresholding a
// blurred coverage field ABOVE 0.5 is an erosion: for a gaussian of
// width σ, threshold t pulls the edge in by about σ·Φ⁻¹(t). So the
// same wide blur this layer already computes, cut at four rising
// levels instead of ramped through two smooth ones, gives the chip's
// nested contours for the price of a few extra steps in the composite.
//
// The blur goes WIDER in this mode, not narrower, which sounds
// backwards for a look whose whole point is crispness: the bands are
// hard steps, so the blur is no longer visible AS blur — it is the
// distance field the thresholds carve up, and a wider one spreads the
// contours further inside the claim instead of crowding them at the
// rim.
//
// WHAT IT LOOKS LIKE, HAVING TRIED IT. On a claim that stands alone it
// is lovely, and it is the chip's picture at map scale: nested bands,
// hot core, crisp steps. On a district where claims TILE — which is
// most of a lived-in city — it collapses into a wash with no borders
// at all, and that is structural rather than a tuning problem. These
// contours are cut from COVERAGE, and coverage is what the field has,
// not who holds it: where two owners meet, both sides are painted, so
// coverage never dips and every threshold fires on both sides at once.
// A contour can only appear where a claim borders NOTHING. Checked at
// two blur widths to be sure it was not just colours smearing; the
// wash is there at both.
//
// Making it work everywhere needs a per-owner distance field — each
// owner's coverage eroded separately — which means a pass per owner,
// or an owner id encoded per pixel and the erosion done against that.
// Either is a real change to a layer whose whole design is ONE pass
// with a data-driven colour, so it is not a thing to slip in behind a
// flag. Hence: off by default, and not a candidate for default until
// that is solved.
const CONTOURS_ON =
  typeof window !== 'undefined' &&
  /[?&]contours=1/.test(window.location.search);
// Rising thresholds on the coverage field. The first is 0.5 — the
// claim's true outline, so the shape stays exactly where the server put
// it — and each one after erodes further in.
const CONTOUR_STEPS = [0.5, 0.72, 0.88, 0.965];
// Per band, not cumulative: four of these stack to ~0.55 in the core,
// matching the chip.
const CONTOUR_ALPHA = 0.18;
// Half-width of the antialiasing on each step, in coverage units. Small
// enough to read as a hard edge, wide enough not to crawl with pixels.
const CONTOUR_AA = 0.018;
// The distance field the steps carve up — see above for why it widens.
const CONTOUR_SOFT_M = 90;
const CONTOUR_MAX_RADIUS_PX = 60;
// The steps as one GLSL expression, built here so the thresholds above
// are the only place they are written down.
const CONTOUR_SUM = CONTOUR_STEPS.map(
  (t) => 'smoothstep(' + t.toFixed(3) + ' - CAA, ' + t.toFixed(3) + ' + CAA, c)',
).join(' + ');

// The noise lattice repeats every this many cells, so the world position
// of the viewport can be wrapped into one tile before it reaches the
// shader (see the composite's NPERIOD note). 64 cells is ~11k px for the
// meander and ~17k px for the grain — a dozen screens of walking before a
// repeat, and the repeat is seamless when it comes.
const NOISE_PERIOD = 64;

// The zoom whose pixels the noise measures itself in. Anchoring to the
// ground is not enough on its own: the first version measured in world
// pixels AT THE CURRENT ZOOM, which put 2^zoom inside the lattice
// origin, so a pinch swept the pattern through the noise hundreds of
// times and the field strobed. (A 0.02 zoom step — geometrically
// invisible — re-rolled the texture completely.) Measuring in the pixels
// of one fixed zoom takes zoom out of the origin entirely: the features
// are a size of GROUND, ~130m and ~200m across, and they scale with the
// streets like everything else on the map.
const NOISE_REF_ZOOM = 16;
// ...which means that zoomed out they shrink toward the pixel grid, so
// fade them out over the same window the buildings' fog uses. Nothing to
// see at city scale anyway: at that height a claim is a shape, not a
// texture.
const NOISE_FADE_LO = 13.2;
const NOISE_FADE_HI = 14.8;

// Peak stain strength, reached only in a claim's densest ground. The
// owner palette was scored composited at 42% over the map paper (see
// territoryColor.ts), and that is where this sat until a fully-claimed
// district turned out to read as too much colour at once — every hue at
// its scored strength, edge to edge, with the map underneath it. 0.38
// keeps the palette's separation (the hues are still distinguishable at
// this depth; it is the same tuning a shade lighter) while letting the
// city back through.
//
// It steps back again here, and this time for a reason about the whole
// picture rather than about the ground alone. The buildings standing on
// this field used to be tinted about as hard as the field itself, which
// left the screen with no figure and no background — every surface
// coloured, so none of it read as deliberate. Supersniff has always done
// the opposite (buildings hit hard, ground left plain) and that is why a
// lit district there looks like somewhere rather than a stain. So the
// buildings take over as the loud voice (TERRITORY_PAINT in
// threeBuildingsLayer) and the ground becomes the quiet one that says
// how far the claim reaches.
//
// 0.34 is as low as it goes: below about 0.32 the cousins in the palette
// start collapsing into each other, and telling whose ground you are on
// is the map's first job.
const FILL_ALPHA = urlTune('field', 0.34);

const POLY_VERT = `
attribute vec2 a_pos;
attribute vec3 a_color;
uniform mat4 u_matrix;
varying vec3 v_color;
void main() {
  v_color = a_color;
  gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
}
`;

const POLY_FRAG = `
precision mediump float;
varying vec3 v_color;
void main() {
  gl_FragColor = vec4(v_color, 1.0);
}
`;

const QUAD_VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// Classic 9-tap gaussian via 5 linear-filtered samples; u_dir carries the
// per-pass direction pre-scaled into uv units.
const BLUR_FRAG = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_dir;
void main() {
  vec4 c = texture2D(u_tex, v_uv) * 0.2270270;
  c += texture2D(u_tex, v_uv + u_dir * 1.3846154) * 0.3162162;
  c += texture2D(u_tex, v_uv - u_dir * 1.3846154) * 0.3162162;
  c += texture2D(u_tex, v_uv + u_dir * 3.2307692) * 0.0702703;
  c += texture2D(u_tex, v_uv - u_dir * 3.2307692) * 0.0702703;
  gl_FragColor = c;
}
`;

// The look lives here. Coverage (blurred alpha) is a field: ~1 deep inside
// someone's ground, 0 on unclaimed street, a smooth ramp across every
// outer edge. The smoothstep is centred on 0.5 so the drawn border sits on
// the true polygon edge; the noise wobbles WHERE within the ramp the
// threshold falls, which bends the border without moving its average.
// Noise coords are world-anchored — each pixel's offset from the viewport
// centre is pushed back through the map's own screen transform, so the
// pattern pans and rotates with the streets instead of sticking to the
// glass. See the render() comment for how, and for the version of this
// that only claimed to.
const COMP_FRAG = `
#define CAA ${CONTOUR_AA.toFixed(4)}
#define CBAND ${CONTOUR_ALPHA.toFixed(4)}

precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;
// The same field blurred much wider — a distance rather than an edge.
uniform sampler2D u_depth;
uniform float u_alpha;
uniform float u_contour; // 1 = the board chip's contour bands
uniform float u_dpr;
// Screen → world, for the noise below. u_half is the viewport centre in
// CSS px; u_toWorld turns a pixel's offset from it into world pixels
// (north up, at the current zoom); u_nOrigin is where the viewport centre
// sits in each noise lattice, already wrapped into one tile by the caller.
uniform vec2 u_half;
uniform mat2 u_toWorld;
uniform vec4 u_nOrigin; // xy: meander lattice, zw: grain lattice
uniform float u_noiseFade; // 0 at city zoom, 1 at street zoom
// Offset for the seam probes below, in uv — the blur radius scaled into
// the low-res texture, so the probe spans a constant FRACTION of the
// crossfade at every zoom instead of a constant number of pixels.
uniform vec2 u_probe;

// TILEABLE value noise. The lattice repeats every NPERIOD cells, which is
// what lets the caller keep the world coordinate small: a claim's position
// in the world is tens of millions of pixels at street zoom, far past what
// a float32 sin() can hash, so the caller wraps it into one tile before
// upload. Wrapping is only invisible because the noise repeats exactly at
// the tile edge — hence the mod here, and hence the octave scales below
// being whole numbers (a 2.03 octave would not close on itself).
#define NPERIOD ${NOISE_PERIOD.toFixed(1)}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 i0 = mod(i, NPERIOD);
  vec2 i1 = mod(i + 1.0, NPERIOD);
  return mix(mix(hash(i0), hash(vec2(i1.x, i0.y)), u.x),
             mix(hash(vec2(i0.x, i1.y)), hash(i1), u.x), u.y);
}
float fbm(vec2 p) {
  return 0.58 * vnoise(p) + 0.30 * vnoise(p * 2.0 + 9.1) + 0.12 * vnoise(p * 4.0 + 23.7);
}
// Two octaves only, for the edge meander — the third octave that the body
// grain uses put ~25px ripples on every border and the edges read as
// torn paper rather than drifting scent.
float fbm2(vec2 p) {
  return 0.66 * vnoise(p) + 0.34 * vnoise(p * 2.0 + 9.1);
}

// The blur leaves rgb premultiplied by coverage; dividing it back out
// recovers the blended owner colour — mid-border between two owners this
// IS the crossfade.
vec3 fieldColor(vec4 s) { return s.rgb / max(s.a, 0.004); }

void main() {
  // The buffers hold a margin of ground beyond the screen, so the screen
  // maps to their middle rather than their whole extent.
  vec2 uv = 0.5 + (v_uv - 0.5) / ${PAD_F.toFixed(4)};
  vec4 s = texture2D(u_tex, uv);
  float cov = s.a;
  if (cov < 0.01) discard;
  // This pixel's offset from the viewport centre in CSS px (y south, so
  // it matches the world's axes), turned into world pixels and then into
  // each noise lattice. Doing it here rather than from gl_FragCoord alone
  // is the whole point: the pattern belongs to the ground, so panning
  // slides it under the glass instead of dragging it along.
  vec2 d = vec2(gl_FragCoord.x / u_dpr - u_half.x, u_half.y - gl_FragCoord.y / u_dpr);
  vec2 wpx = u_toWorld * d;
  // Edge meander, ~170 reference px (~130m of ground). Gated by coverage
  // so noise can never conjure a floating speck of paint out on bare
  // street, and faded out at city zoom with everything else.
  float wob = (fbm2(wpx / 170.0 + u_nOrigin.xy) - 0.5) * 0.34
            * min(1.0, cov * 4.0) * u_noiseFade;
  float c = cov + wob;
  // THREE soft steps — a pale fringe, a body, and a dense core. This is
  // most of what makes a claim read as a heat field with depth (the
  // contour-band look) rather than a blurred sticker, and the third step
  // is what pulls the strength inward: the top third of the weight now
  // waits until coverage is past 0.80, so a claim's hottest ground is a
  // smaller patch nearer its middle and the approach to it is a longer
  // climb. Two steps put more than half the weight on at 0.55, which
  // made the strong part broad and the whole field heavier than it
  // needed to be.
  //
  // Coverage saturates across the interior of one big polygon, so on a
  // solid claim these steps land in its border. The concentration shows
  // where real ground is: a claim is a hull of walks, dozens of pieces
  // with gaps, and the blur turns that into a genuine density field —
  // dense where somebody walks daily, thin at the edges of their range.
  float halo = smoothstep(0.26, 0.40, c);
  float body = smoothstep(0.55, 0.72, c);
  // The third step reads the WIDE field, not this one, and that is what
  // makes it a core rather than one more ring around the edge: it asks
  // how far inside the claim this pixel is, over hundreds of metres,
  // where the sharp field has been saturated since the second street.
  vec4 dp = texture2D(u_depth, uv);
  // ...and how much of the neighbour has bled into the wide colour,
  // which is what tells one owner's middle from a shared border. Deep in
  // your own ground the two colours agree and this is 1; approaching
  // somebody else's it falls away before the seam arrives.
  float mine = 1.0 - clamp(length(fieldColor(dp) - fieldColor(s)) * ${SEAM_FADE.toFixed(2)}, 0.0, 1.0);
  float deep = dp.a * mine;
  float core = smoothstep(0.30, 0.80, deep);
  float shaped = 0.32 * halo + 0.38 * body + 0.30 * core;
  if (u_contour > 0.5) {
    // Four hard steps instead of two soft ramps — the chip's contours.
    // Each smoothstep spans a couple of hundredths of coverage, which
    // is antialiasing, not a gradient.
    shaped = (${CONTOUR_SUM}) * CBAND / u_alpha;
  }
  if (shaped < 0.01) discard;
  vec3 col = fieldColor(s);
  // Bright rims where each band is born — the hot outline of a heat blob.
  // They live in the coverage ramp, so they trace only OUTER edges
  // against unclaimed ground; interior coverage is ~1 throughout. The
  // third is deliberately the faintest: it draws the new core's outline
  // without lighting up the middle of every claim.
  float rim = smoothstep(0.26, 0.36, c) * (1.0 - smoothstep(0.38, 0.50, c)) * 0.34
            + smoothstep(0.55, 0.63, c) * (1.0 - smoothstep(0.65, 0.76, c)) * 0.22
            + smoothstep(0.28, 0.38, deep) * (1.0 - smoothstep(0.42, 0.60, deep)) * 0.14;
  // Where two OWNERS meet, coverage never dips, so the rims above can't
  // fire — probe the field a blur-radius out on each axis and lighten
  // where the colour is changing fast. That puts a soft bright seam down
  // every shared border (strong between contrasting hues, faint between
  // cousins), which is what keeps a fully-claimed city reading as many
  // fields rather than one quilt. Masked to fully-painted ground so it
  // can't double up on the outer rim.
  vec4 sl = texture2D(u_tex, uv - vec2(u_probe.x, 0.0));
  vec4 sr = texture2D(u_tex, uv + vec2(u_probe.x, 0.0));
  vec4 sb = texture2D(u_tex, uv - vec2(0.0, u_probe.y));
  vec4 st = texture2D(u_tex, uv + vec2(0.0, u_probe.y));
  // Soft mask — a hard step() here drew visible stair-lines wherever the
  // probe ring crossed a shape edge, the on/off of the lighten tracing
  // axis-offset copies of every boundary.
  float inner = smoothstep(0.4, 0.85, min(min(sl.a, sr.a), min(sb.a, st.a)));
  float dc = length(fieldColor(sr) - fieldColor(sl)) + length(fieldColor(st) - fieldColor(sb));
  float seam = smoothstep(0.10, 0.34, dc) * inner * 0.20;
  // Both highlights are thin bright lines, exactly the detail that
  // flickers once a claim is a few pixels across, so they come down with
  // the noise at overview zoom. The outer rim goes out entirely; the
  // seam between two owners only halves, because at city zoom it is the
  // only thing still saying where one person's ground ends. At street
  // zoom u_noiseFade is 1 and nothing here changes.
  col = mix(col, vec3(1.0), min(1.0, rim * u_noiseFade + seam * mix(0.5, 1.0, u_noiseFade)));
  // PUFF — pseudo-relief from the coverage gradient the probes already
  // measured for free: the slope facing the light lifts, the far side
  // settles, and a flat sticker of colour becomes a cushion of scent.
  // Interiors have no gradient, so the body stays calm; all the relief
  // lives where the field actually rises and falls.
  float gx = sr.a - sl.a;
  float gy = st.a - sb.a;
  // Light from the top-left, and it LIFTS ONLY — the clamp floor is 1.0,
  // not the 0.8 it started at.
  //
  // The shadow half had to go. A claim's strength should fall off toward
  // its edge and nothing else: the alpha ramp already does that, so the
  // field gets paler the further out you look, which is the whole idea.
  // Multiplying the south-facing slope down by up to 20% fought that —
  // it drew a band DARKER than the claim's own body just inside every
  // bottom edge, and a dark outline is the one thing a field of scent
  // should never have. Measured across an edge at street zoom, the
  // luminance ran 164 → 158 → paper: a dark line, plainly visible, right
  // where the eye expects the claim to be fading out. With the floor at
  // 1.0 the same walk is 164 → 166 → paper, monotonic.
  //
  // The lit side is untouched, so the cushion is still there; it is now
  // made of highlight alone, the way light on a pale surface actually
  // reads.
  col *= clamp(1.0 + (0.4 * gx - 0.65 * gy), 1.0, 1.22);
  // Hot core: RICHER, not darker — saturation climbs toward the middle
  // of a claim, so deeply-held ground reads as deeply dyed. The earlier
  // darkening pass read as dirt on the palette.
  float coreT = smoothstep(0.80, 0.97, c);
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, mix(vec3(luma), col, 1.45), coreT * 0.6);
  // ...and the body carries large, soft density variation on top.
  float grain = fbm(wpx / 260.0 + u_nOrigin.zw);
  float a = shaped * u_alpha * (1.0 + (0.24 * grain - 0.12) * u_noiseFade);
  // STAIN, not film. The output is a multiply tint (1 where the field
  // is empty), composited with DST_COLOR blending: the field dyes the
  // map instead of floating over it, so streets, blocks and parks keep
  // their linework INSIDE a claim instead of being fogged by it. Over
  // the pale paper this lands within a hair of the old 42% alpha film —
  // the palette's contrast tuning carries over — but everywhere the map
  // has detail, the detail now shows through the colour.
  gl_FragColor = vec4(mix(vec3(1.0), col, a), 1.0);
}
`;

function compile(gl: GL, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    // eslint-disable-next-line no-console
    console.error('[territory-heat] shader compile failed:', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function makeProgram(gl: GL, vertSrc: string, fragSrc: string): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    // eslint-disable-next-line no-console
    console.error('[territory-heat] program link failed:', gl.getProgramInfoLog(prog));
    return null;
  }
  return prog;
}

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}

function makeTarget(gl: GL, w: number, h: number): Target | null {
  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  if (!tex || !fbo) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!ok) {
    gl.deleteTexture(tex);
    gl.deleteFramebuffer(fbo);
    return null;
  }
  return { tex, fbo, w, h };
}

// mainMatrix maps absolute mercator → clip. The mesh stores offsets from
// an anchor, so fold the anchor's translation into the matrix — in float64
// (plain JS numbers), which is the entire point: done in float32 the city
// jitters at street zoom.
function anchoredMatrix(m: ArrayLike<number>, ox: number, oy: number): Float32Array {
  const out = new Float32Array(16);
  for (let i = 0; i < 12; i++) out[i] = m[i]!;
  out[12] = m[0]! * ox + m[4]! * oy + m[12]!;
  out[13] = m[1]! * ox + m[5]! * oy + m[13]!;
  out[14] = m[2]! * ox + m[6]! * oy + m[14]!;
  out[15] = m[3]! * ox + m[7]! * oy + m[15]!;
  return out;
}

interface Mesh {
  // Interleaved [x, y, r, g, b] — anchor-relative mercator + owner colour.
  data: Float32Array;
  count: number;
  ax: number;
  ay: number;
}

function buildMesh(groups: TerritoryHeatGroup[]): Mesh {
  const out: number[] = [];
  let ax = 0;
  let ay = 0;
  let anchored = false;
  for (const g of groups) {
    const [cr, cg, cb] = g.color;
    for (const s of g.shapes) {
      if (s.kind !== 'area' || s.points.length < 3) continue;
      const rings = [s.points, ...(s.holes ?? []).filter((h) => h.length >= 3)];
      const flat: number[] = [];
      const holeStarts: number[] = [];
      for (let ri = 0; ri < rings.length; ri++) {
        if (ri > 0) holeStarts.push(flat.length / 2);
        for (const p of rings[ri]!) {
          const m = MercatorCoordinate.fromLngLat([p.lng, p.lat], 0);
          if (!anchored) {
            ax = m.x;
            ay = m.y;
            anchored = true;
          }
          flat.push(m.x - ax, m.y - ay);
        }
      }
      const idx = earcut(flat, holeStarts);
      for (const i of idx) {
        out.push(flat[i * 2]!, flat[i * 2 + 1]!, cr, cg, cb);
      }
    }
  }
  return { data: new Float32Array(out), count: out.length / 5, ax, ay };
}

export function createTerritoryHeatLayer(onFail?: () => void): TerritoryHeatLayer {
  let mapRef: MlMap | null = null;
  let failed = false;

  let polyProg: WebGLProgram | null = null;
  let blurProg: WebGLProgram | null = null;
  let compProg: WebGLProgram | null = null;
  let aPolyPos = -1;
  let aPolyColor = -1;
  let uPolyMatrix: WebGLUniformLocation | null = null;
  let aBlurPos = -1;
  let uBlurTex: WebGLUniformLocation | null = null;
  let uBlurDir: WebGLUniformLocation | null = null;
  let aCompPos = -1;
  let uCompTex: WebGLUniformLocation | null = null;
  let uCompAlpha: WebGLUniformLocation | null = null;
  let uCompHalf: WebGLUniformLocation | null = null;
  let uCompToWorld: WebGLUniformLocation | null = null;
  let uCompNOrigin: WebGLUniformLocation | null = null;
  let uCompNoiseFade: WebGLUniformLocation | null = null;
  let uCompDepth: WebGLUniformLocation | null = null;
  let uCompDpr: WebGLUniformLocation | null = null;
  let uCompProbe: WebGLUniformLocation | null = null;
  let uCompContour: WebGLUniformLocation | null = null;
  // Blur radius in low-res texels, written by prerender each frame and
  // read back when render sets the seam-probe offsets.
  let radiusTex = 0;

  let quadBuf: WebGLBuffer | null = null;
  let meshBuf: WebGLBuffer | null = null;
  // [sharp field, scratch, wide depth field, supersampled polygons]
  let targets: [Target, Target, Target, Target] | null = null;

  let mesh: Mesh = { data: new Float32Array(0), count: 0, ax: 0, ay: 0 };
  let dirty = false;
  let hasContent = false;

  // Structural failure (compile/link/fbo) — tell the caller once so it can
  // fall back to the flat fill. Per-frame hiccups just skip the frame.
  const fail = (where: string, e?: unknown) => {
    if (failed) return;
    failed = true;
    publishTerritoryField(null);
    // eslint-disable-next-line no-console
    console.error(`[territory-heat] ${where} — falling back to flat fill`, e ?? '');
    try {
      onFail?.();
    } catch {
      /* caller's problem, not the frame's */
    }
  };

  const dropTargets = (gl: GL) => {
    if (!targets) return;
    publishTerritoryField(null);
    for (const t of targets) {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    }
    targets = null;
  };

  const ensureTargets = (gl: GL): boolean => {
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    // Padded, and rounded to an even size so the 2× polygon buffer boxes
    // down onto exact 2×2 blocks.
    const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
    const w = even((gl.drawingBufferWidth * PAD_F) / (DOWNSCALE * dpr));
    const h = even((gl.drawingBufferHeight * PAD_F) / (DOWNSCALE * dpr));
    if (targets && targets[0].w === w && targets[0].h === h) return true;
    dropTargets(gl);
    const a = makeTarget(gl, w, h);
    const b = makeTarget(gl, w, h);
    // C holds the wide "how deep inside" field; A the sharp one, B the
    // scratch both blurs bounce through.
    const c = makeTarget(gl, w, h);
    // P: where the polygons land, at SUPERSAMPLE× — see the constant.
    const pp = makeTarget(gl, w * SUPERSAMPLE, h * SUPERSAMPLE);
    if (!a || !b || !c || !pp) {
      for (const t of [a, b, c, pp]) {
        if (t) {
          gl.deleteTexture(t.tex);
          gl.deleteFramebuffer(t.fbo);
        }
      }
      fail('offscreen framebuffer unavailable');
      return false;
    }
    targets = [a, b, c, pp];
    return true;
  };

  return {
    id: TERRITORY_HEAT_LAYER_ID,
    type: 'custom',
    renderingMode: '2d',

    setGroups(groups: TerritoryHeatGroup[]) {
      mesh = buildMesh(groups);
      dirty = true;
      try {
        mapRef?.triggerRepaint();
      } catch {
        /* map tearing down */
      }
    },

    onAdd(map: MlMap, gl: GL) {
      mapRef = map;
      // A style reload re-adds the layer with a fresh GL context; rebuild
      // everything rather than trusting handles from the old one.
      failed = false;
      targets = null;
      dirty = true;
      polyProg = makeProgram(gl, POLY_VERT, POLY_FRAG);
      blurProg = makeProgram(gl, QUAD_VERT, BLUR_FRAG);
      compProg = makeProgram(gl, QUAD_VERT, COMP_FRAG);
      quadBuf = gl.createBuffer();
      meshBuf = gl.createBuffer();
      if (!polyProg || !blurProg || !compProg || !quadBuf || !meshBuf) {
        fail('GL setup failed');
        return;
      }
      aPolyPos = gl.getAttribLocation(polyProg, 'a_pos');
      aPolyColor = gl.getAttribLocation(polyProg, 'a_color');
      uPolyMatrix = gl.getUniformLocation(polyProg, 'u_matrix');
      aBlurPos = gl.getAttribLocation(blurProg, 'a_pos');
      uBlurTex = gl.getUniformLocation(blurProg, 'u_tex');
      uBlurDir = gl.getUniformLocation(blurProg, 'u_dir');
      aCompPos = gl.getAttribLocation(compProg, 'a_pos');
      uCompTex = gl.getUniformLocation(compProg, 'u_tex');
      uCompAlpha = gl.getUniformLocation(compProg, 'u_alpha');
      uCompHalf = gl.getUniformLocation(compProg, 'u_half');
      uCompToWorld = gl.getUniformLocation(compProg, 'u_toWorld');
      uCompNOrigin = gl.getUniformLocation(compProg, 'u_nOrigin');
      uCompNoiseFade = gl.getUniformLocation(compProg, 'u_noiseFade');
      uCompDepth = gl.getUniformLocation(compProg, 'u_depth');
      uCompDpr = gl.getUniformLocation(compProg, 'u_dpr');
      uCompProbe = gl.getUniformLocation(compProg, 'u_probe');
      uCompContour = gl.getUniformLocation(compProg, 'u_contour');
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW,
      );
    },

    onRemove(_map: MlMap, gl: GL) {
      mapRef = null;
      hasContent = false;
      publishTerritoryField(null);
      try {
        dropTargets(gl);
        if (polyProg) gl.deleteProgram(polyProg);
        if (blurProg) gl.deleteProgram(blurProg);
        if (compProg) gl.deleteProgram(compProg);
        if (quadBuf) gl.deleteBuffer(quadBuf);
        if (meshBuf) gl.deleteBuffer(meshBuf);
      } catch {
        /* context already lost */
      }
      polyProg = blurProg = compProg = null;
      quadBuf = meshBuf = null;
    },

    // All the offscreen work happens here, before MapLibre starts its own
    // frame — the painter re-bases GL state around pre-render, so the only
    // contract is to put the framebuffer and viewport back.
    prerender(gl: GL, args: CustomRenderMethodInput) {
      if (failed || !polyProg || !blurProg || !compProg || !meshBuf || !mapRef) return;
      hasContent = false;
      try {
        if (dirty) {
          gl.bindBuffer(gl.ARRAY_BUFFER, meshBuf);
          gl.bufferData(gl.ARRAY_BUFFER, mesh.data, gl.DYNAMIC_DRAW);
          dirty = false;
        }
        if (mesh.count === 0) return;
        if (!ensureTargets(gl) || !targets) return;
        const [A, B, C, P] = targets;

        const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
        const prevVp = gl.getParameter(gl.VIEWPORT) as Int32Array;
        const scissorOn = gl.isEnabled(gl.SCISSOR_TEST);
        const blendOn = gl.isEnabled(gl.BLEND);
        const depthOn = gl.isEnabled(gl.DEPTH_TEST);
        const stencilOn = gl.isEnabled(gl.STENCIL_TEST);
        const cullOn = gl.isEnabled(gl.CULL_FACE);
        gl.disable(gl.SCISSOR_TEST);
        gl.disable(gl.BLEND);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.STENCIL_TEST);
        gl.disable(gl.CULL_FACE);

        // 1. Polygons, crisp, owner-coloured. No blending: draw order is
        // priority, later groups overwrite earlier ones where they touch.
        gl.bindFramebuffer(gl.FRAMEBUFFER, P.fbo);
        gl.viewport(0, 0, P.w, P.h);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(polyProg);
        // Shrink clip space by the padding factor, so the buffer holds a
        // margin of ground beyond the screen on every side — what the
        // wide blur needs to reach into.
        const pm = anchoredMatrix(args.defaultProjectionData.mainMatrix, mesh.ax, mesh.ay);
        for (let i = 0; i < 16; i += 4) {
          pm[i] = pm[i]! / PAD_F;
          pm[i + 1] = pm[i + 1]! / PAD_F;
        }
        gl.uniformMatrix4fv(uPolyMatrix, false, pm);
        gl.bindBuffer(gl.ARRAY_BUFFER, meshBuf);
        gl.enableVertexAttribArray(aPolyPos);
        gl.vertexAttribPointer(aPolyPos, 2, gl.FLOAT, false, 20, 0);
        gl.enableVertexAttribArray(aPolyColor);
        gl.vertexAttribPointer(aPolyColor, 3, gl.FLOAT, false, 20, 8);
        gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
        gl.disableVertexAttribArray(aPolyColor);

        // 1b. Box the supersampled polygons down into the working buffer.
        // The blur program with a zero direction is a plain copy — all
        // nine taps land on one point — and because A's texel centres
        // fall exactly between P's, the LINEAR sampler returns the mean
        // of each 2×2 block. That mean is the whole point: coverage
        // stops being a flag and becomes a fraction.
        gl.useProgram(blurProg);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        gl.enableVertexAttribArray(aBlurPos);
        gl.vertexAttribPointer(aBlurPos, 2, gl.FLOAT, false, 0, 0);
        gl.uniform1i(uBlurTex, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, A.fbo);
        gl.viewport(0, 0, A.w, A.h);
        gl.bindTexture(gl.TEXTURE_2D, P.tex);
        gl.uniform2f(uBlurDir, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // 2. Blur. Radius: EDGE_SOFT_M of ground converted to CSS pixels
        // at the current zoom, clamped, then into texels — the buffer is
        // sized in CSS pixels too, so dpr cancels out and the kernel sees
        // the same texel radius on every screen. When that radius outruns
        // what 9 taps can sample cleanly, run the kernel twice at
        // radius/√2 — gaussians compose.
        const zoom = mapRef.getZoom();
        const lat = mapRef.getCenter().lat;
        const mpp = (78271.517 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
        const softM = CONTOURS_ON ? CONTOUR_SOFT_M : EDGE_SOFT_M;
        const maxR = CONTOURS_ON ? CONTOUR_MAX_RADIUS_PX : MAX_RADIUS_PX;
        const cssR = Math.min(maxR, Math.max(MIN_RADIUS_PX, softM / mpp));
        const rTex = cssR / DOWNSCALE;
        radiusTex = rTex;
        const iters = rTex > 5 ? 2 : 1;
        const r = rTex / Math.sqrt(iters);
        for (let i = 0; i < iters; i++) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, B.fbo);
          gl.bindTexture(gl.TEXTURE_2D, A.tex);
          gl.uniform2f(uBlurDir, r / 4 / A.w, 0);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
          gl.bindFramebuffer(gl.FRAMEBUFFER, A.fbo);
          gl.bindTexture(gl.TEXTURE_2D, B.tex);
          gl.uniform2f(uBlurDir, 0, r / 4 / A.h);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        }

        // 2b. Keep going, into C — the same kernel run again and again
        // until the edge ramp has spread into a distance field. A is left
        // alone; the composite needs both.
        for (let i = 0; i < DEPTH_ITERS; i++) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, B.fbo);
          gl.bindTexture(gl.TEXTURE_2D, i === 0 ? A.tex : C.tex);
          gl.uniform2f(uBlurDir, r / 4 / A.w, 0);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
          gl.bindFramebuffer(gl.FRAMEBUFFER, C.fbo);
          gl.bindTexture(gl.TEXTURE_2D, B.tex);
          gl.uniform2f(uBlurDir, 0, r / 4 / A.h);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
        gl.viewport(prevVp[0]!, prevVp[1]!, prevVp[2]!, prevVp[3]!);
        if (scissorOn) gl.enable(gl.SCISSOR_TEST);
        if (blendOn) gl.enable(gl.BLEND);
        if (depthOn) gl.enable(gl.DEPTH_TEST);
        if (stencilOn) gl.enable(gl.STENCIL_TEST);
        if (cullOn) gl.enable(gl.CULL_FACE);
        hasContent = true;
        // Hand this frame's field to whoever else draws on this ground —
        // the buildings read it so their paint fades the way the ground
        // under them does. See territoryField.ts for why the ordering is
        // safe.
        publishTerritoryField({ sharp: A.tex, depth: C.tex, pad: PAD_F });
      } catch (e) {
        // Skip the frame, keep the map alive. Structural failures already
        // came through fail(); anything here is transient.
        // eslint-disable-next-line no-console
        console.error('[territory-heat] prerender error', e);
      }
    },

    // 3. Composite the blurred field onto the map, under the buildings.
    render(gl: GL) {
      if (failed || !compProg || !quadBuf || !hasContent || !targets || !mapRef) return;
      try {
        const A = targets[0];
        const C = targets[2];
        gl.useProgram(compProg);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, A.tex);
        gl.uniform1i(uCompTex, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, C.tex);
        gl.uniform1i(uCompDepth, 1);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1f(uCompAlpha, FILL_ALPHA);
        gl.uniform1f(uCompContour, CONTOURS_ON ? 1 : 0);
        const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
        // ── Anchor the meander and grain to the ground ──────────────────
        // The first version of this projected the map CENTRE and offset
        // gl_FragCoord by it, which anchors nothing: the centre projects to
        // the middle of the canvas by definition, so the offset was the
        // same every frame and the noise was welded to the glass. Panning
        // dragged a cloud of grain along with the phone. (Measured, not
        // guessed: two frames 440m apart came out byte-identical.)
        //
        // What actually anchors it is the inverse of the map's own screen
        // transform, measured rather than rebuilt from zoom and bearing —
        // project the centre and two neighbours a hair to the east and
        // south, and the differences ARE the matrix, whatever conventions
        // MapLibre uses internally. Under pitch this is the linearisation
        // at the centre, so the far distance parallaxes a little; the
        // pattern is a texture, not a landmark, and that is invisible.
        let half = [0, 0];
        // Column-major mat2: screen px → world px. Identity means "no
        // anchor this frame", which is the old screen-locked behaviour.
        const toWorld = [1, 0, 0, 1];
        const nOrigin = [0, 0, 0, 0];
        let noiseFade = 1;
        try {
          half = [gl.drawingBufferWidth / dpr / 2, gl.drawingBufferHeight / dpr / 2];
          const c = mapRef.getCenter();
          const zoom = mapRef.getZoom();
          // World pixels at this zoom — MapLibre's own units: mercator
          // scaled by tile size × 2^zoom — and the pixels of the fixed
          // reference zoom the noise actually lives in.
          const ws = 512 * Math.pow(2, zoom);
          const refWs = 512 * Math.pow(2, NOISE_REF_ZOOM);
          // Screen px → reference px, so zoom cancels out of everything
          // below and the pattern stays put through a pinch.
          const k = refWs / ws;
          const EPS = 1e-4; // degrees; ~10m, small enough to stay linear
          const mc = MercatorCoordinate.fromLngLat([c.lng, c.lat], 0);
          const me = MercatorCoordinate.fromLngLat([c.lng + EPS, c.lat], 0);
          const ms = MercatorCoordinate.fromLngLat([c.lng, c.lat - EPS], 0);
          const p0 = mapRef.project(c);
          const pe = mapRef.project([c.lng + EPS, c.lat]);
          const ps = mapRef.project([c.lng, c.lat - EPS]);
          const ex = (me.x - mc.x) * ws; // world px per EPS east
          const sy = (ms.y - mc.y) * ws; // world px per EPS south
          // Forward matrix: world px → screen px, one column per world axis.
          const a = (pe.x - p0.x) / ex;
          const b = (pe.y - p0.y) / ex;
          const cc = (ps.x - p0.x) / sy;
          const d = (ps.y - p0.y) / sy;
          const det = a * d - b * cc;
          if (Number.isFinite(det) && Math.abs(det) > 1e-9) {
            toWorld[0] = (k * d) / det;
            toWorld[1] = (-k * b) / det;
            toWorld[2] = (-k * cc) / det;
            toWorld[3] = (k * a) / det;
            // Where the viewport centre sits in each lattice — in
            // REFERENCE pixels, so this number does not move when the zoom
            // does. Divide first, wrap second, both in float64: that is
            // what keeps a twenty-million-pixel world coordinate inside
            // one noise tile. The +17 keeps the grain from sampling the
            // same corner of the lattice the meander does.
            const wrap = (v: number) => ((v % NOISE_PERIOD) + NOISE_PERIOD) % NOISE_PERIOD;
            nOrigin[0] = wrap((mc.x * refWs) / 170);
            nOrigin[1] = wrap((mc.y * refWs) / 170);
            nOrigin[2] = wrap((mc.x * refWs) / 260 + 17);
            nOrigin[3] = wrap((mc.y * refWs) / 260 + 17);
          }
          // Features shrink toward the pixel grid as you pull back; fade
          // them rather than let them shimmer.
          noiseFade = Math.min(
            1,
            Math.max(0, (zoom - NOISE_FADE_LO) / (NOISE_FADE_HI - NOISE_FADE_LO)),
          );
        } catch {
          /* mid-teardown; screen-anchored for a frame is fine */
        }
        gl.uniform2f(uCompHalf, half[0]!, half[1]!);
        gl.uniformMatrix2fv(uCompToWorld, false, toWorld);
        gl.uniform4f(uCompNOrigin, nOrigin[0]!, nOrigin[1]!, nOrigin[2]!, nOrigin[3]!);
        gl.uniform1f(uCompNoiseFade, noiseFade);
        gl.uniform1f(uCompDpr, dpr);
        // Seam probes reach one blur radius out — the crossfade between
        // two owners spans ~2 radii, so this samples a constant fraction
        // of it at every zoom and the seam strength stays steady.
        gl.uniform2f(uCompProbe, (radiusTex * 0.9) / A.w, (radiusTex * 0.9) / A.h);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        gl.enableVertexAttribArray(aCompPos);
        gl.vertexAttribPointer(aCompPos, 2, gl.FLOAT, false, 0, 0);
        gl.disable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        // Multiply blending — the shader outputs a tint (1.0 where the
        // field is empty) and the map underneath is dyed by it. See the
        // STAIN note at the end of COMP_FRAG.
        gl.blendFunc(gl.DST_COLOR, gl.ZERO);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[territory-heat] render error', e);
      }
    },
  };
}
