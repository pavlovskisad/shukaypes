// Stylised "game" fog as a MapLibre custom WebGL layer.
//
// An earlier version fogged by reconstructed ground distance (true depth),
// but without access to MapLibre's depth buffer that paints a hard fog
// stripe across tall near buildings at the horizon row (the ground BEHIND
// them is at infinite distance). So this is a screen-space TOP-DOWN fog:
// dense at the top (the far/horizon part of a pitched view) fading to
// clear at the bottom (the near foreground) — no stripe, reads as "fog
// from the top down". A world-/screen-anchored value-noise gives it big,
// strong particles, and the whole thing fades in with pitch so a flat map
// is untouched.
//
// Drawn on top of the canvas (DOM markers/HUD sit above it). Grey, not
// blue, for a game feel; the colour matches the sky's horizon colour so
// the top of the fog meets the sky dome seamlessly.

import type {
  CustomLayerInterface,
  CustomRenderMethodInput,
} from 'maplibre-gl';
import { useGameStore } from '../../stores/gameStore';

export const DEPTH_FOG_LAYER_ID = 'depth-fog';

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
uniform vec3 u_fogColor;
uniform float u_yStart;     // ndc.y where fog begins (lower)
uniform float u_yEnd;       // ndc.y where fog reaches full (upper)
uniform float u_maxAlpha;
uniform float u_particle;    // particle size in (physical) px
uniform float u_noiseAmt;    // 0..1 cloudiness
uniform vec2 u_offset;       // world-ish anchor offset (px) so particles
                             // drift with the map instead of sticking to glass
uniform float u_time;        // seconds — animates the cloud body

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
  // Top-down gradient: 0 at the bottom (near) → 1 at the top (far).
  float g = smoothstep(u_yStart, u_yEnd, v_ndc.y);
  // Big, strong, LIVING particles. Base coords travel with the world as
  // you pan (offset), then a slow drift + a domain-warp make the cloud
  // forms churn and roll over time instead of sitting like a frozen
  // overlay.
  vec2 base = (gl_FragCoord.xy + u_offset) / u_particle;
  vec2 drift = vec2(u_time * 0.021, u_time * -0.013);
  float wx = vnoise(base * 0.6 + vec2(0.0, u_time * 0.016));
  float wy = vnoise(base * 0.6 + vec2(5.2, -u_time * 0.012));
  vec2 warp = (vec2(wx, wy) - 0.5) * 0.9;
  float n = fbm(base + drift + warp);
  float cloud = mix(1.0, 0.25 + 1.3 * n, u_noiseAmt);
  float a = clamp(g * cloud, 0.0, 1.0) * u_maxAlpha;
  if (a <= 0.002) discard;
  gl_FragColor = vec4(u_fogColor * a, a);   // premultiplied
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

// Grey "game" fog tones (RGB 0..1). Day: near-white grey. Sniff: dark grey.
const DAY_FOG: [number, number, number] = [0.913, 0.925, 0.933];
const NIGHT_FOG: [number, number, number] = [0.16, 0.18, 0.21];

interface FogOpts {
  // ndc.y band over which fog ramps (−1 bottom … +1 top). Lower yStart and
  // yEnd = fog covers more of the screen / denser further down.
  yStart?: number;
  yEnd?: number;
  // Peak fog opacity at the top (far). Higher = denser distance.
  maxAlpha?: number;
  // Particle size in CSS px (scaled by DPR internally). Bigger = bigger.
  particle?: number;
  // Cloudiness 0..1 — particle strength.
  noiseAmt?: number;
  // Fade the whole effect in with pitch (no fog on a flat map).
  minPitch?: number;
  fullPitch?: number;
}

export function createDepthFogLayer(opts: FogOpts = {}): CustomLayerInterface {
  const yStart = opts.yStart ?? -0.35;
  const yEnd = opts.yEnd ?? 0.62;
  const maxAlpha = opts.maxAlpha ?? 0.92;
  const particle = opts.particle ?? 120;
  const noiseAmt = opts.noiseAmt ?? 0.8;
  const minPitch = opts.minPitch ?? 42;
  const fullPitch = opts.fullPitch ?? 60;

  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let aPos = -1;
  let uColor: WebGLUniformLocation | null = null;
  let uYStart: WebGLUniformLocation | null = null;
  let uYEnd: WebGLUniformLocation | null = null;
  let uMaxAlpha: WebGLUniformLocation | null = null;
  let uParticle: WebGLUniformLocation | null = null;
  let uNoiseAmt: WebGLUniformLocation | null = null;
  let uOffset: WebGLUniformLocation | null = null;
  let uTime: WebGLUniformLocation | null = null;
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  // Throttle the self-driven animation to ~22fps — the clouds drift slowly,
  // so there's no need to force a full 60fps map repaint (battery).
  let repaintScheduled = false;
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
      uColor = gl.getUniformLocation(prog, 'u_fogColor');
      uYStart = gl.getUniformLocation(prog, 'u_yStart');
      uYEnd = gl.getUniformLocation(prog, 'u_yEnd');
      uMaxAlpha = gl.getUniformLocation(prog, 'u_maxAlpha');
      uParticle = gl.getUniformLocation(prog, 'u_particle');
      uNoiseAmt = gl.getUniformLocation(prog, 'u_noiseAmt');
      uOffset = gl.getUniformLocation(prog, 'u_offset');
      uTime = gl.getUniformLocation(prog, 'u_time');
      buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW,
      );
    },

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    render(gl: GL, _args: CustomRenderMethodInput) {
      try {
        if (!program || !buffer || !mapRef) return;
        const pitch: number = mapRef.getPitch();
        const pitchT = Math.max(0, Math.min(1, (pitch - minPitch) / (fullPitch - minPitch)));
        if (pitchT <= 0) return;

        const sniff = useGameStore.getState().sniffMode;
        const tones = sniff ? NIGHT_FOG : DAY_FOG;

        // Anchor particles to the map so they drift with panning rather than
        // sticking to the screen. Project the map centre to pixels.
        const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
        let offX = 0, offY = 0;
        try {
          const c = mapRef.getCenter();
          const p = mapRef.project(c);
          offX = -p.x * dpr;
          offY = p.y * dpr;
        } catch {
          /* ignore */
        }

        gl.useProgram(program);
        gl.uniform3f(uColor, tones[0], tones[1], tones[2]);
        gl.uniform1f(uYStart, yStart);
        gl.uniform1f(uYEnd, yEnd);
        gl.uniform1f(uMaxAlpha, maxAlpha * pitchT);
        gl.uniform1f(uParticle, particle * dpr);
        gl.uniform1f(uNoiseAmt, noiseAmt);
        gl.uniform2f(uOffset, offX, offY);
        const now = typeof performance !== 'undefined' ? performance.now() : 0;
        gl.uniform1f(uTime, (now - t0) / 1000);

        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

        gl.disable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // Keep animating while the fog is visible (pitched), throttled to
        // ~22fps via setTimeout. setTimeout is itself throttled when the tab
        // is hidden, so this idles in the background.
        if (!repaintScheduled) {
          repaintScheduled = true;
          setTimeout(() => {
            repaintScheduled = false;
            try {
              mapRef?.triggerRepaint();
            } catch {
              /* ignore */
            }
          }, 45);
        }
      } catch (e) {
        // Never let a fog hiccup break the map's frame.
        // eslint-disable-next-line no-console
        console.error('[fog] render error', e);
      }
    },
  };
}
