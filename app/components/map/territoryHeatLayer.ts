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

// Offscreen buffers at 1/4 canvas resolution. Big enough that a near-crisp
// low-zoom edge doesn't pixelate (the linear upsample smooths ~4px), small
// enough that three fullscreen-ish passes cost a fraction of a frame.
const DOWNSCALE = 4;

// The soft edge, in metres of ground. Constant metres — not constant
// pixels — is what keeps the look honest at both ends: standing at a
// border you see a ~20m gradient underfoot; zoomed out to the whole city
// the clamp takes over and shapes stay readable instead of dissolving
// into fog. The px clamps also protect the blur kernel's sampling range.
const EDGE_SOFT_M = 22;
const MIN_RADIUS_PX = 2; // CSS px
const MAX_RADIUS_PX = 26; // CSS px

// Peak fill opacity. 0.42 is a load-bearing number: the owner palette was
// scored composited at 42% over the map paper (see territoryColor.ts) —
// change this and every colour-distance argument there is stale.
const FILL_ALPHA = 0.42;

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
// Noise coords are world-anchored via u_offset (same trick as the fog) so
// the pattern pans with the streets instead of sticking to the glass.
const COMP_FRAG = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_alpha;
uniform vec2 u_offset;
uniform float u_dpr;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  return 0.58 * vnoise(p) + 0.30 * vnoise(p * 2.03 + 9.1) + 0.12 * vnoise(p * 4.11 + 23.7);
}

void main() {
  vec4 s = texture2D(u_tex, v_uv);
  float cov = s.a;
  if (cov < 0.01) discard;
  vec2 wp = (gl_FragCoord.xy + u_offset) / u_dpr;
  // Edge meander, ~110px features. Gated by coverage so noise can never
  // conjure a floating speck of paint out on bare street.
  float wob = (fbm(wp / 110.0) - 0.5) * 0.32 * min(1.0, cov * 4.0);
  float c = cov + wob;
  float shaped = smoothstep(0.34, 0.66, c);
  if (shaped < 0.01) discard;
  // The blur left rgb premultiplied by coverage; dividing it back out
  // recovers the blended owner colour — mid-border between two owners
  // this IS the crossfade.
  vec3 col = s.rgb / max(cov, 0.004);
  // A light rim where the field crosses the edge — the "hot" outline of a
  // heat blob. Interior coverage is ~1 so this never tints the body, and
  // owner-vs-owner borders (coverage ~1 throughout) never get it either.
  float rim = smoothstep(0.34, 0.5, c) * (1.0 - smoothstep(0.5, 0.78, c));
  col = mix(col, vec3(1.0), rim * 0.18);
  // Faint large-scale unevenness inside the body, so a big claim reads as
  // a field with density to it rather than a flat sticker.
  float grain = fbm(wp / 300.0 + 17.0);
  float a = shaped * u_alpha * (0.92 + 0.16 * grain);
  gl_FragColor = vec4(col * a, a); // premultiplied
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
  let uCompOffset: WebGLUniformLocation | null = null;
  let uCompDpr: WebGLUniformLocation | null = null;

  let quadBuf: WebGLBuffer | null = null;
  let meshBuf: WebGLBuffer | null = null;
  let targets: [Target, Target] | null = null;

  let mesh: Mesh = { data: new Float32Array(0), count: 0, ax: 0, ay: 0 };
  let dirty = false;
  let hasContent = false;

  // Structural failure (compile/link/fbo) — tell the caller once so it can
  // fall back to the flat fill. Per-frame hiccups just skip the frame.
  const fail = (where: string, e?: unknown) => {
    if (failed) return;
    failed = true;
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
    for (const t of targets) {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    }
    targets = null;
  };

  const ensureTargets = (gl: GL): boolean => {
    const w = Math.max(1, Math.round(gl.drawingBufferWidth / DOWNSCALE));
    const h = Math.max(1, Math.round(gl.drawingBufferHeight / DOWNSCALE));
    if (targets && targets[0].w === w && targets[0].h === h) return true;
    dropTargets(gl);
    const a = makeTarget(gl, w, h);
    const b = makeTarget(gl, w, h);
    if (!a || !b) {
      if (a) {
        gl.deleteTexture(a.tex);
        gl.deleteFramebuffer(a.fbo);
      }
      fail('offscreen framebuffer unavailable');
      return false;
    }
    targets = [a, b];
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
      uCompOffset = gl.getUniformLocation(compProg, 'u_offset');
      uCompDpr = gl.getUniformLocation(compProg, 'u_dpr');
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
        const [A, B] = targets;

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
        gl.bindFramebuffer(gl.FRAMEBUFFER, A.fbo);
        gl.viewport(0, 0, A.w, A.h);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(polyProg);
        gl.uniformMatrix4fv(
          uPolyMatrix,
          false,
          anchoredMatrix(args.defaultProjectionData.mainMatrix, mesh.ax, mesh.ay),
        );
        gl.bindBuffer(gl.ARRAY_BUFFER, meshBuf);
        gl.enableVertexAttribArray(aPolyPos);
        gl.vertexAttribPointer(aPolyPos, 2, gl.FLOAT, false, 20, 0);
        gl.enableVertexAttribArray(aPolyColor);
        gl.vertexAttribPointer(aPolyColor, 3, gl.FLOAT, false, 20, 8);
        gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
        gl.disableVertexAttribArray(aPolyColor);

        // 2. Blur. Radius: EDGE_SOFT_M of ground converted to pixels at
        // the current zoom, clamped, then into quarter-res texels. When
        // the texel radius outruns what 9 taps can sample cleanly, run the
        // kernel twice at radius/√2 — gaussians compose.
        const zoom = mapRef.getZoom();
        const lat = mapRef.getCenter().lat;
        const mpp = (78271.517 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
        const cssR = Math.min(MAX_RADIUS_PX, Math.max(MIN_RADIUS_PX, EDGE_SOFT_M / mpp));
        const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
        const rTex = (cssR * dpr) / DOWNSCALE;
        const iters = rTex > 5 ? 2 : 1;
        const r = rTex / Math.sqrt(iters);
        gl.useProgram(blurProg);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        gl.enableVertexAttribArray(aBlurPos);
        gl.vertexAttribPointer(aBlurPos, 2, gl.FLOAT, false, 0, 0);
        gl.uniform1i(uBlurTex, 0);
        gl.activeTexture(gl.TEXTURE0);
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

        gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
        gl.viewport(prevVp[0]!, prevVp[1]!, prevVp[2]!, prevVp[3]!);
        if (scissorOn) gl.enable(gl.SCISSOR_TEST);
        if (blendOn) gl.enable(gl.BLEND);
        if (depthOn) gl.enable(gl.DEPTH_TEST);
        if (stencilOn) gl.enable(gl.STENCIL_TEST);
        if (cullOn) gl.enable(gl.CULL_FACE);
        hasContent = true;
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
        gl.useProgram(compProg);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, A.tex);
        gl.uniform1i(uCompTex, 0);
        gl.uniform1f(uCompAlpha, FILL_ALPHA);
        const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
        // Anchor the edge/grain noise to the world: project the map centre
        // to screen px and offset gl_FragCoord by it, exactly as the fog
        // does — pan and the pattern travels with the streets.
        let offX = 0;
        let offY = 0;
        try {
          const p = mapRef.project(mapRef.getCenter());
          offX = -p.x * dpr;
          offY = p.y * dpr;
        } catch {
          /* mid-teardown; screen-anchored for a frame is fine */
        }
        gl.uniform2f(uCompOffset, offX, offY);
        gl.uniform1f(uCompDpr, dpr);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        gl.enableVertexAttribArray(aCompPos);
        gl.vertexAttribPointer(aCompPos, 2, gl.FLOAT, false, 0, 0);
        gl.disable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[territory-heat] render error', e);
      }
    },
  };
}
