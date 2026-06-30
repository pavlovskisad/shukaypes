// Real depth fog as a MapLibre custom WebGL layer.
//
// MapLibre 5 has no setFog, and its setSky atmosphere only paints the sky
// dome — it doesn't fog the 3D geometry at city zoom. So instead of a flat
// screen-space overlay (which can't tell near from far), this layer
// reconstructs, for every screen pixel, the world ground point beneath it
// (via the inverse of the projection matrix) and fogs by how far along the
// view ray that ground sits. Result: a genuine perspective/depth fog —
// foreground stays crisp, the distance dissolves into haze, the bare
// "no-building" far ground is always swallowed, and the ground→sky seam
// melts away — at any pitch or zoom, no manual gradients.
//
// Drawn on top of the map canvas (under the DOM markers/HUD, which sit
// above the canvas anyway). Sky pixels are left untouched so MapLibre's
// own sky dome shows; the fog colour matches the sky's horizon colour so
// the far ground fades seamlessly into it.

import type {
  CustomLayerInterface,
  CustomRenderMethodInput,
} from 'maplibre-gl';
import { LIGHT_PALETTE, DARK_PALETTE } from './crayonStyle';
import { useGameStore } from '../../stores/gameStore';

export const DEPTH_FOG_LAYER_ID = 'depth-fog';

function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

// Column-major 4x4 inverse (gl-matrix layout). Returns null if singular.
function invert16(a: ArrayLike<number>, out: Float32Array): Float32Array | null {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  det = 1.0 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

const VERT = `
attribute vec2 a_pos;
varying vec2 v_ndc;
void main() {
  v_ndc = a_pos;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// For each pixel: shoot the view ray (near→far plane, reconstructed from the
// inverse VP matrix), intersect the ground plane z=0, and fog by the ray
// parameter `s` (0 at the near plane, 1 at the far plane) — which grows
// monotonically with real distance, peaking at the horizon. Sky pixels
// (ray never meets the ground ahead) are left transparent.
const FRAG = `
precision highp float;
varying vec2 v_ndc;
uniform mat4 u_invMatrix;
uniform vec3 u_fogColor;
uniform float u_start;
uniform float u_end;
uniform float u_maxAlpha;
void main() {
  vec4 nh = u_invMatrix * vec4(v_ndc, -1.0, 1.0);
  vec3 nearP = nh.xyz / nh.w;
  vec4 fh = u_invMatrix * vec4(v_ndc, 1.0, 1.0);
  vec3 farP = fh.xyz / fh.w;
  float denom = nearP.z - farP.z;
  // Ray (nearly) parallel to ground, or pointing up → sky.
  if (abs(denom) < 1e-9) { discard; }
  float s = nearP.z / denom;            // ground hit at near + s*(far-near)
  if (s < 0.0) { discard; }             // ray points up → sky, leave it
  float fog = (s > 1.0) ? 1.0 : smoothstep(u_start, u_end, s);
  float a = fog * u_maxAlpha;
  if (a <= 0.001) { discard; }
  // Premultiplied alpha (MapLibre's canvas blend expects it).
  gl_FragColor = vec4(u_fogColor * a, a);
}
`;

type GL = WebGLRenderingContext | WebGL2RenderingContext;

function compile(gl: GL, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    // eslint-disable-next-line no-console
    console.error('[fog] shader compile failed:', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

interface FogOpts {
  // How far along the view ray (0..1, near→far) the fog starts / reaches
  // full. Higher = clearer foreground, fog hugs the horizon. Tunable feel.
  start?: number;
  end?: number;
  // Peak fog opacity (kept < 1 so the far city stays as silhouettes).
  maxAlpha?: number;
  // Only fog once the camera is pitched enough that there's real depth to
  // fog; ramps the peak alpha in with pitch.
  minPitch?: number;
  fullPitch?: number;
}

export function createDepthFogLayer(opts: FogOpts = {}): CustomLayerInterface {
  const start = opts.start ?? 0.7;
  const end = opts.end ?? 0.985;
  const maxAlpha = opts.maxAlpha ?? 0.92;
  const minPitch = opts.minPitch ?? 48;
  const fullPitch = opts.fullPitch ?? 64;

  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let aPos = -1;
  let uInv: WebGLUniformLocation | null = null;
  let uColor: WebGLUniformLocation | null = null;
  let uStart: WebGLUniformLocation | null = null;
  let uEnd: WebGLUniformLocation | null = null;
  let uMaxAlpha: WebGLUniformLocation | null = null;
  const invOut = new Float32Array(16);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mapRef: any = null;

  return {
    id: DEPTH_FOG_LAYER_ID,
    type: 'custom',
    renderingMode: '2d',

    onAdd(map: unknown, gl: GL) {
      mapRef = map;
      const vs = compile(gl, gl.VERTEX_SHADER, VERT);
      const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) return;
      const prog = gl.createProgram();
      if (!prog) return;
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        // eslint-disable-next-line no-console
        console.error('[fog] program link failed:', gl.getProgramInfoLog(prog));
        return;
      }
      program = prog;
      aPos = gl.getAttribLocation(prog, 'a_pos');
      uInv = gl.getUniformLocation(prog, 'u_invMatrix');
      uColor = gl.getUniformLocation(prog, 'u_fogColor');
      uStart = gl.getUniformLocation(prog, 'u_start');
      uEnd = gl.getUniformLocation(prog, 'u_end');
      uMaxAlpha = gl.getUniformLocation(prog, 'u_maxAlpha');
      buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      // Two triangles covering NDC [-1,1].
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW,
      );
    },

    render(gl: GL, args: CustomRenderMethodInput) {
      try {
      if (!program || !buffer || !mapRef) return;
      const pitch: number = mapRef.getPitch();
      // Depth fog only reads as fog when the camera is tilted; fade it in.
      const pitchT = Math.max(0, Math.min(1, (pitch - minPitch) / (fullPitch - minPitch)));
      if (pitchT <= 0) return;

      const matrix = args.defaultProjectionData?.mainMatrix;
      if (!matrix) return;
      if (!invert16(matrix as unknown as ArrayLike<number>, invOut)) return;

      const sniff = useGameStore.getState().sniffMode;
      const sky = (sniff ? DARK_PALETTE : LIGHT_PALETTE).sky;
      const [r, g, b] = hexToRgb01(sky.horizonColor);

      gl.useProgram(program);
      gl.uniformMatrix4fv(uInv, false, invOut);
      gl.uniform3f(uColor, r, g, b);
      gl.uniform1f(uStart, start);
      gl.uniform1f(uEnd, end);
      gl.uniform1f(uMaxAlpha, maxAlpha * pitchT);

      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      // Premultiplied-alpha over the existing scene.
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      } catch (e) {
        // Never let a fog hiccup break the map's frame.
        // eslint-disable-next-line no-console
        console.error('[fog] render error', e);
      }
    },
  };
}
