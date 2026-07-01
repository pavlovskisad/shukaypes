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
import { MercatorCoordinate } from 'maplibre-gl';
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
uniform vec3 u_fogColor;    // grey haze (horizon)
uniform vec3 u_skyColor;    // very light blue (toward the top)
uniform vec3 u_sunColor;    // soft warm light
uniform float u_sunStrength;
uniform vec2 u_sunPos;      // sun centre in ndc (from camera bearing/pitch)
uniform float u_yStart;     // ndc.y where fog begins (lower)
uniform float u_yEnd;       // ndc.y where fog reaches full (upper)
uniform float u_maxAlpha;
uniform float u_particle;    // particle size in (physical) px
uniform float u_noiseAmt;    // 0..1 cloudiness
uniform vec2 u_offset;       // world-ish anchor offset (px) so particles
                             // drift with the map instead of sticking to glass
uniform float u_time;        // seconds — animates the cloud body

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
float cellHash(vec2 c) { return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
// Flat-shaded Voronoi: every pixel takes the single value of its nearest
// cell → hard polygonal facets (no smooth blur), echoing the low-poly map.
// Cell centres orbit over time so the polygons morph/drift = a living,
// granular fog rather than a frozen pattern.
float voronoiFlat(vec2 x, float t) {
  vec2 n = floor(x);
  vec2 f = fract(x);
  float md = 8.0;
  vec2 mc = n;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash2(n + g);
      o = 0.5 + 0.5 * sin(t + 6.2831853 * o);   // orbit the cell centre
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < md) { md = d; mc = n + g; }
    }
  }
  return cellHash(mc);
}

void main() {
  // Top-down gradient: 0 at the bottom (near) → 1 at the top (far).
  float g = smoothstep(u_yStart, u_yEnd, v_ndc.y);
  // Polygonal granular particles. Coords ride the world offset (pan) plus a
  // slow drift; each Voronoi cell is a flat density chunk → faceted fog
  // that matches the 3D map's low-poly look.
  // Coords are anchored to the WORLD (u_offset is the mercator position in
  // px) so the polygons travel with the map as you pan/zoom — parallax,
  // not self-drift. Only a very slow cell morph keeps it alive.
  vec2 base = (gl_FragCoord.xy + u_offset) / u_particle;
  vec2 drift = vec2(u_time * 0.002, u_time * -0.0015);
  float cell = voronoiFlat(base + drift, u_time * 0.04);
  float cloud = mix(1.0, 0.18 + 1.5 * cell, u_noiseAmt);
  // Colour: grey haze at the horizon transitioning to a very light blue
  // sky toward the very top.
  float skyMix = smoothstep(0.35, 0.98, v_ndc.y);
  vec3 col = mix(u_fogColor, u_skyColor, skyMix);
  // Soft directional sunlight — a wide, gentle warm glow whose centre
  // moves with the camera (u_sunPos). Slightly elongated vertically so it
  // reads as light coming in at an angle, not a flat blob.
  vec2 sv = (v_ndc - u_sunPos) * vec2(1.0, 0.78);
  float sd = length(sv);
  float sun = smoothstep(1.35, 0.0, sd);
  sun *= sun;
  col = mix(col, u_sunColor, sun * u_sunStrength);
  float a = clamp(g * cloud, 0.0, 1.0) * u_maxAlpha;
  if (a <= 0.002) discard;
  gl_FragColor = vec4(col * a, a);   // premultiplied
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

// "Game" tones (RGB 0..1): grey haze at the horizon, a light-blue sky
// toward the top, and a soft sun-glow colour. Day vs sniff (night).
interface FogTones {
  fog: [number, number, number];
  sky: [number, number, number];
  sun: [number, number, number];
  sunStrength: number;
}
const DAY: FogTones = {
  // Clean near-white (was a dirtier grey) so the haze brightens rather
  // than muddies the city.
  fog: [0.965, 0.97, 0.975],
  sky: [0.85, 0.91, 0.99],
  sun: [1.0, 0.96, 0.85],
  sunStrength: 0.55,
};
const NIGHT: FogTones = {
  fog: [0.17, 0.19, 0.22],
  sky: [0.09, 0.12, 0.19],
  sun: [0.55, 0.66, 0.82],
  sunStrength: 0.2,
};

// Fixed world azimuth the sun "comes from" (deg, from north, clockwise).
// The on-screen sun position is derived from this vs the camera bearing,
// so the light slides as you rotate/tilt — feels like a real light.
const SUN_AZIMUTH = 125;

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
  const yStart = opts.yStart ?? 0.12;
  const yEnd = opts.yEnd ?? 0.72;
  const maxAlpha = opts.maxAlpha ?? 0.34;
  const particle = opts.particle ?? 20;
  const noiseAmt = opts.noiseAmt ?? 0.85;
  const minPitch = opts.minPitch ?? 42;
  const fullPitch = opts.fullPitch ?? 60;

  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let aPos = -1;
  let uColor: WebGLUniformLocation | null = null;
  let uSky: WebGLUniformLocation | null = null;
  let uSun: WebGLUniformLocation | null = null;
  let uSunStrength: WebGLUniformLocation | null = null;
  let uSunPos: WebGLUniformLocation | null = null;
  let uYStart: WebGLUniformLocation | null = null;
  let uYEnd: WebGLUniformLocation | null = null;
  let uMaxAlpha: WebGLUniformLocation | null = null;
  let uParticle: WebGLUniformLocation | null = null;
  let uNoiseAmt: WebGLUniformLocation | null = null;
  let uOffset: WebGLUniformLocation | null = null;
  let uTime: WebGLUniformLocation | null = null;
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  // Throttle the self-driven animation to ~30fps — smooth enough for the
  // drifting clouds without forcing a full 60fps map repaint (battery).
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
      uSky = gl.getUniformLocation(prog, 'u_skyColor');
      uSun = gl.getUniformLocation(prog, 'u_sunColor');
      uSunStrength = gl.getUniformLocation(prog, 'u_sunStrength');
      uSunPos = gl.getUniformLocation(prog, 'u_sunPos');
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
        const tones = sniff ? NIGHT : DAY;

        // Anchor particles to the map so they drift with panning rather than
        // sticking to the screen. Project the map centre to pixels.
        const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
        // World anchor: the map centre's mercator position expressed in
        // device px (worldSize = 512·2^zoom). As you pan, this tracks the
        // ground 1:1 so the polygons travel WITH the world (parallax) and
        // scale with zoom. Kept modulo a cell-aligned period so the value
        // stays small enough for float precision (the rare wrap is far off).
        let offX = 0, offY = 0;
        try {
          const m = MercatorCoordinate.fromLngLat(mapRef.getCenter());
          const zoom = mapRef.getZoom();
          // Parallax at a FRACTION of world speed — the "air" drifts gently
          // as you pan, like a distant atmospheric layer, instead of racing
          // 1:1 with the ground.
          const PARALLAX = 0.22;
          const worldPx = 512 * Math.pow(2, zoom) * dpr * PARALLAX;
          const period = particle * dpr * 512;
          offX = (((m.x * worldPx) % period) + period) % period;
          offY = (((m.y * worldPx) % period) + period) % period;
        } catch {
          /* ignore */
        }

        gl.useProgram(program);
        gl.uniform3f(uColor, tones.fog[0], tones.fog[1], tones.fog[2]);
        gl.uniform3f(uSky, tones.sky[0], tones.sky[1], tones.sky[2]);
        gl.uniform3f(uSun, tones.sun[0], tones.sun[1], tones.sun[2]);
        // Directional sun: derive its on-screen spot from the camera so it
        // slides as you rotate and rises/falls as you tilt — and fades when
        // you turn away from it.
        const bearing = typeof mapRef.getBearing === 'function' ? mapRef.getBearing() : 0;
        let rel = (((SUN_AZIMUTH - bearing) % 360) + 540) % 360 - 180; // [-180,180]
        const relRad = (rel * Math.PI) / 180;
        const front = Math.cos(relRad);
        const vis = Math.max(0, Math.min(1, (front + 0.25) / 0.9));
        const sunX = 0.62 * Math.sin(relRad);
        const sunY = 0.7 + Math.max(0, Math.min(0.18, (pitch - 50) * 0.004));
        gl.uniform2f(uSunPos, sunX, sunY);
        gl.uniform1f(uSunStrength, tones.sunStrength * vis);
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
          }, 33);
        }
      } catch (e) {
        // Never let a fog hiccup break the map's frame.
        // eslint-disable-next-line no-console
        console.error('[fog] render error', e);
      }
    },
  };
}
