// Real depth fog as a MapLibre custom WebGL layer.
//
// MapLibre 5 has no setFog, and its setSky atmosphere only paints the sky
// dome — it doesn't fog the 3D geometry at city zoom. So this layer
// reconstructs, for every screen pixel, the world ground point beneath it
// (via the inverse projection matrix) and applies EXPONENTIAL fog by that
// point's true distance from the camera. Exponential-over-distance is the
// classic natural-fog model: it spreads gradually across the screen
// (never a hard band), thickens with distance, swallows the bare
// no-building far ground at any pitch/zoom, and melts the ground→sky seam
// into the horizon colour. Foreground stays crisp; the distance dissolves.
//
// Drawn on top of the map canvas (DOM markers/HUD sit above the canvas, so
// they're unaffected). Sky pixels are discarded so MapLibre's sky dome
// shows; the fog colour = the sky's horizon colour for a seamless join.

import type {
  CustomLayerInterface,
  CustomRenderMethodInput,
} from 'maplibre-gl';
import { MercatorCoordinate } from 'maplibre-gl';
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

// inv (column-major) · (x,y,z,1), perspective-divided → out3.
function unproject(inv: Float32Array, x: number, y: number, z: number, out: number[]): void {
  const cx = inv[0] * x + inv[4] * y + inv[8] * z + inv[12];
  const cy = inv[1] * x + inv[5] * y + inv[9] * z + inv[13];
  const cz = inv[2] * x + inv[6] * y + inv[10] * z + inv[14];
  const cw = inv[3] * x + inv[7] * y + inv[11] * z + inv[15];
  out[0] = cx / cw;
  out[1] = cy / cw;
  out[2] = cz / cw;
}

// Camera world (mercator) position = where two view rays converge. Solve
// the near/far rays for NDC A and B and intersect them (using x,y). Falls
// back to null if degenerate.
const _nA: number[] = [], _fA: number[] = [], _nB: number[] = [], _fB: number[] = [];
function extractCamera(inv: Float32Array, out: number[]): number[] | null {
  unproject(inv, -0.5, -0.5, -1, _nA);
  unproject(inv, -0.5, -0.5, 1, _fA);
  unproject(inv, 0.5, 0.5, -1, _nB);
  unproject(inv, 0.5, 0.5, 1, _fB);
  const dAx = _fA[0] - _nA[0], dAy = _fA[1] - _nA[1], dAz = _fA[2] - _nA[2];
  const dBx = _fB[0] - _nB[0], dBy = _fB[1] - _nB[1];
  const det = dAx * -dBy - -dBx * dAy;
  if (Math.abs(det) < 1e-20) return null;
  const rx = _nB[0] - _nA[0], ry = _nB[1] - _nA[1];
  const tA = (rx * -dBy - -dBx * ry) / det;
  out[0] = _nA[0] + tA * dAx;
  out[1] = _nA[1] + tA * dAy;
  out[2] = _nA[2] + tA * dAz;
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

const FRAG = `
precision highp float;
varying vec2 v_ndc;
uniform mat4 u_invMatrix;
uniform vec3 u_camera;   // camera position, mercator
uniform float u_invK;    // metres per mercator unit
uniform vec3 u_fogColor;
uniform float u_density;  // fog density per metre
uniform float u_maxAlpha;
void main() {
  vec4 nh = u_invMatrix * vec4(v_ndc, -1.0, 1.0);
  vec3 nearP = nh.xyz / nh.w;
  vec4 fh = u_invMatrix * vec4(v_ndc, 1.0, 1.0);
  vec3 farP = fh.xyz / fh.w;
  float denom = nearP.z - farP.z;
  if (abs(denom) < 1e-9) discard;
  float s = nearP.z / denom;          // ground (z=0) hit param
  if (s < 0.0) discard;               // ray points up → sky
  vec3 ground = nearP + s * (farP - nearP);
  float distM = length(ground - u_camera) * u_invK;   // metres from camera
  float fog = 1.0 - exp(-u_density * distM);           // exponential falloff
  float a = clamp(fog, 0.0, 1.0) * u_maxAlpha;
  if (a <= 0.002) discard;
  gl_FragColor = vec4(u_fogColor * a, a);              // premultiplied
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
  // Fog density per metre. Higher = thicker / reaches closer (covers more
  // of the screen). ~0.0004 → ~halfway by ~1.7km, near-full by ~7km.
  density?: number;
  // Peak fog opacity (kept < 1 so the far city stays as silhouettes).
  maxAlpha?: number;
  // Fade the whole effect in with pitch (no fog on a flat map).
  minPitch?: number;
  fullPitch?: number;
}

export function createDepthFogLayer(opts: FogOpts = {}): CustomLayerInterface {
  const density = opts.density ?? 0.0004;
  const maxAlpha = opts.maxAlpha ?? 0.88;
  const minPitch = opts.minPitch ?? 42;
  const fullPitch = opts.fullPitch ?? 60;

  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let aPos = -1;
  let uInv: WebGLUniformLocation | null = null;
  let uCamera: WebGLUniformLocation | null = null;
  let uInvK: WebGLUniformLocation | null = null;
  let uColor: WebGLUniformLocation | null = null;
  let uDensity: WebGLUniformLocation | null = null;
  let uMaxAlpha: WebGLUniformLocation | null = null;
  const invOut = new Float32Array(16);
  const cam: number[] = [0, 0, 0];
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
      uCamera = gl.getUniformLocation(prog, 'u_camera');
      uInvK = gl.getUniformLocation(prog, 'u_invK');
      uColor = gl.getUniformLocation(prog, 'u_fogColor');
      uDensity = gl.getUniformLocation(prog, 'u_density');
      uMaxAlpha = gl.getUniformLocation(prog, 'u_maxAlpha');
      buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
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
        const pitchT = Math.max(0, Math.min(1, (pitch - minPitch) / (fullPitch - minPitch)));
        if (pitchT <= 0) return;

        const matrix = args.defaultProjectionData?.mainMatrix;
        if (!matrix) return;
        if (!invert16(matrix as unknown as ArrayLike<number>, invOut)) return;
        if (!extractCamera(invOut, cam)) return;

        const center = mapRef.getCenter();
        const k = MercatorCoordinate.fromLngLat(center).meterInMercatorCoordinateUnits();
        const invK = k > 0 ? 1 / k : 1;

        const sniff = useGameStore.getState().sniffMode;
        const sky = (sniff ? DARK_PALETTE : LIGHT_PALETTE).sky;
        const [r, g, b] = hexToRgb01(sky.horizonColor);

        gl.useProgram(program);
        gl.uniformMatrix4fv(uInv, false, invOut);
        gl.uniform3f(uCamera, cam[0], cam[1], cam[2]);
        gl.uniform1f(uInvK, invK);
        gl.uniform3f(uColor, r, g, b);
        gl.uniform1f(uDensity, density);
        gl.uniform1f(uMaxAlpha, maxAlpha * pitchT);

        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

        gl.disable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
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
