// Unified ground fog for the game render (experiment).
//
// The buildings (threeBuildingsLayer) get TRUE 3D distance + height fog. This
// layer gives the GROUND the exact same treatment, so the whole world
// dissolves into one consistent mist instead of a flat screen-space band on
// the ground + real fog on the buildings ("split brain").
//
// Trick: the ground is a flat plane at mercator altitude z = 0, so we don't
// need a depth buffer — for each pixel we unproject its camera ray and
// intersect the ground plane analytically, giving that ground point's TRUE
// world distance. Then we apply the identical exponential distance fog +
// ground-mist pool the buildings use (imported from threeBuildingsLayer, one
// source of truth). Above the horizon we draw the sky dome + sun glow.
//
// Layer order matters: this is added UNDER the Three buildings, so buildings
// paint over it with their own fog (no double-fogging) and the map's ground
// pixels get fogged here.

import * as THREE from 'three';
import { MercatorCoordinate } from 'maplibre-gl';
import type {
  CustomLayerInterface,
  CustomRenderMethodInput,
  Map as MlMap,
} from 'maplibre-gl';
import { useGameStore } from '../../stores/gameStore';
import {
  POOL_STRENGTH,
  clearBubbleForZoom,
  eyeFromMainMatrix,
} from './threeBuildingsLayer';
import { DAYLIGHT, type DaylightPhase, type DaylightProfile } from './daylight';

export const GROUND_FOG_LAYER_ID = 'ground-fog';

type GL = WebGLRenderingContext | WebGL2RenderingContext;
type RGB = [number, number, number];

const rgbNum = (h: number): RGB => [
  ((h >> 16) & 255) / 255,
  ((h >> 8) & 255) / 255,
  (h & 255) / 255,
];

// Precompute the RGB triples the sky/ground shader needs per phase (colour
// scalars like fogNear/glowStrength/sun position come straight off the
// shared DAYLIGHT profile at render time).
interface GroundRGB {
  fog: RGB;
  skyTop: RGB;
  skyHorizon: RGB;
  glow: RGB;
}
const toGround = (p: DaylightProfile): GroundRGB => ({
  fog: rgbNum(p.fog),
  skyTop: rgbNum(p.skyTop),
  skyHorizon: rgbNum(p.skyHorizon),
  glow: rgbNum(p.glow),
});
const GROUND: Record<DaylightPhase, GroundRGB> = {
  morning: toGround(DAYLIGHT.morning),
  day: toGround(DAYLIGHT.day),
  evening: toGround(DAYLIGHT.evening),
  night: toGround(DAYLIGHT.night),
};

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
uniform mat4 u_invVP;      // clip -> mercator
uniform vec3 u_camMerc;    // eye in mercator
uniform float u_mPerM;     // mercator units per metre
uniform float u_fogNear;
uniform float u_fogDensity;
uniform vec3 u_fogColor;
uniform float u_poolStrength;
uniform vec3 u_focusMerc;   // map centre (dog) in mercator; .xy horizontal
uniform float u_clearRadius;
uniform float u_clearBand;
uniform vec3 u_skyTop;
uniform vec3 u_skyHorizon;
uniform vec3 u_sunColor;
uniform float u_sunStrength;
uniform vec2 u_sunPos;
uniform float u_time;

void main() {
  // Sky dome gradient.
  vec3 skyCol = mix(u_skyHorizon, u_skyTop, smoothstep(-0.1, 1.0, v_ndc.y));

  // Warm sun: a wide soft halo + a brighter core, tinted into the sky. The
  // vertical squash keeps it disc-like under the tilted camera.
  vec2 sv = (v_ndc - u_sunPos) * vec2(1.0, 0.78);
  float sd = length(sv);
  float glow = smoothstep(1.55, 0.0, sd); glow *= glow;
  float core = smoothstep(0.42, 0.0, sd); core *= core;
  float halo = clamp(glow + core * 0.95, 0.0, 1.0);
  // Gentle breathing so the sun feels alive even when the camera is still.
  float pulse = 0.94 + 0.06 * sin(u_time * 0.6);
  skyCol = mix(skyCol, u_sunColor, halo * u_sunStrength * pulse);

  // Gentle god rays: warm radial shafts fanning out from the sun, drifting
  // slowly (a few angular frequencies summed) and fading with distance.
  // Additive so they read as light, not paint; buildings (drawn on top)
  // occlude them, so they stream from behind the skyline.
  vec2 rv = v_ndc - u_sunPos;
  float ang = atan(rv.y, rv.x);
  float shafts =
      0.55 * sin(ang * 16.0 + u_time * 0.13) +
      0.30 * sin(ang * 30.0 - u_time * 0.09) +
      0.15 * sin(ang * 8.0  + u_time * 0.05);
  // Higher exponent = crisper, more distinct beams with darker gaps between.
  shafts = pow(0.5 + 0.5 * shafts, 4.5);
  // Tighter reach so the rays stay focused around the sun.
  float rayFall = smoothstep(1.35, 0.04, length(rv));
  skyCol += u_sunColor * shafts * rayFall * u_sunStrength * 0.24;

  // Camera ray for this pixel → intersect ground plane (mercator z = 0).
  vec4 pn = u_invVP * vec4(v_ndc, -1.0, 1.0);
  vec4 pf = u_invVP * vec4(v_ndc,  1.0, 1.0);
  vec3 ro = pn.xyz / pn.w;
  vec3 rd = (pf.xyz / pf.w) - ro;
  float t = (abs(rd.z) > 1e-12) ? (-ro.z / rd.z) : -1.0;

  if (t <= 0.0) {
    gl_FragColor = vec4(skyCol, 1.0); // above horizon: pure sky
    return;
  }

  vec3 hit = ro + t * rd;
  float distM = length(hit - u_camMerc) / u_mPerM;
  // Identical distance fog to the buildings.
  float distFog = 1.0 - exp(-u_fogDensity * max(0.0, distM - u_fogNear));
  // The ground is the floor of the mist pool (thickest), ramped in with
  // distance so the near foreground stays crisp.
  float pool = smoothstep(u_fogNear * 0.55, u_fogNear * 1.05, distM) * u_poolStrength;
  float f = clamp(max(distFog, pool), 0.0, 1.0);
  // Clear bubble around the focus (dog) — keeps its neighbourhood crisp at
  // any zoom (horizontal ground distance to the map centre).
  float dFocus = length(hit.xy - u_focusMerc.xy) / u_mPerM;
  f *= smoothstep(u_clearRadius, u_clearRadius + u_clearBand, dFocus);
  // As it saturates, the ground melts into the sky colour so the far ground
  // meets the sky with no seam.
  vec3 col = mix(u_fogColor, skyCol, smoothstep(0.85, 1.0, f));
  float a = f;
  if (a <= 0.002) discard;
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
    console.error('[ground-fog] shader compile failed:', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export function createGroundFogLayer(): CustomLayerInterface {
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let aPos = -1;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let mapRef: MlMap | null = null;
  const invMat = new THREE.Matrix4();
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  // Self-driven repaint for the god-ray / sun-pulse animation. Throttled to
  // ~20fps and only kept alive while the sun is actually in view, so a
  // camera facing away lets the map go idle (no battery drain, and building
  // rebuilds still fire on idle in the gaps).
  let repaintScheduled = false;

  return {
    id: GROUND_FOG_LAYER_ID,
    type: 'custom',
    renderingMode: '2d',

    onAdd(map: MlMap, gl: GL) {
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
        console.error('[ground-fog] link failed:', gl.getProgramInfoLog(prog));
        return;
      }
      program = prog;
      aPos = gl.getAttribLocation(prog, 'a_pos');
      for (const name of [
        'u_invVP', 'u_camMerc', 'u_mPerM', 'u_fogNear', 'u_fogDensity',
        'u_fogColor', 'u_poolStrength', 'u_focusMerc', 'u_clearRadius',
        'u_clearBand', 'u_skyTop', 'u_skyHorizon',
        'u_sunColor', 'u_sunStrength', 'u_sunPos', 'u_time',
      ]) {
        u[name] = gl.getUniformLocation(prog, name);
      }
      buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW,
      );
    },

    onRemove(_map, gl: GL) {
      if (program) gl.deleteProgram(program);
      if (buffer) gl.deleteBuffer(buffer);
      program = null;
      buffer = null;
      mapRef = null;
    },

    render(gl: GL, args: CustomRenderMethodInput) {
      try {
        if (!program || !buffer || !mapRef) return;
        const map = mapRef;
        // Time-of-day drives the tones; sniff (search) mode forces night.
        const gs = useGameStore.getState();
        const phase: DaylightPhase = gs.sniffMode ? 'night' : gs.daylightPhase;
        const prof = DAYLIGHT[phase];
        const grgb = GROUND[phase];

        const mmArr = Array.from(args.defaultProjectionData.mainMatrix);
        invMat.fromArray(mmArr).invert();
        const eye = eyeFromMainMatrix(mmArr);
        if (!eye) return;

        const c = map.getCenter();
        const focus = MercatorCoordinate.fromLngLat([c.lng, c.lat], 0);
        const mPerM = focus.meterInMercatorCoordinateUnits();

        // On-screen sun position from the phase azimuth + bearing/pitch, so
        // the glow sits where that phase's sun/moon is and slides with the
        // camera. sunScreenY baseline is low at dawn/dusk, high at midday.
        const bearing = map.getBearing();
        const pitch = map.getPitch();
        const rel = ((((prof.lightAzimuth - bearing) % 360) + 540) % 360) - 180;
        const relRad = (rel * Math.PI) / 180;
        const front = Math.cos(relRad);
        const vis = Math.max(0, Math.min(1, (front + 0.25) / 0.9));
        const sunX = 0.62 * Math.sin(relRad);
        const sunY = prof.sunScreenY + Math.max(0, Math.min(0.14, (pitch - 50) * 0.003));

        gl.useProgram(program);
        gl.uniformMatrix4fv(u.u_invVP, false, invMat.elements);
        gl.uniform3f(u.u_camMerc, eye[0], eye[1], eye[2]);
        gl.uniform1f(u.u_mPerM, mPerM);
        gl.uniform1f(u.u_fogNear, prof.fogNear);
        gl.uniform1f(u.u_fogDensity, prof.fogDensity);
        gl.uniform3f(u.u_fogColor, grgb.fog[0], grgb.fog[1], grgb.fog[2]);
        gl.uniform1f(u.u_poolStrength, POOL_STRENGTH);
        gl.uniform3f(u.u_focusMerc, focus.x, focus.y, focus.z);
        const bubble = clearBubbleForZoom(map.getZoom());
        gl.uniform1f(u.u_clearRadius, bubble.radius);
        gl.uniform1f(u.u_clearBand, bubble.band);
        gl.uniform3f(u.u_skyTop, grgb.skyTop[0], grgb.skyTop[1], grgb.skyTop[2]);
        gl.uniform3f(
          u.u_skyHorizon,
          grgb.skyHorizon[0], grgb.skyHorizon[1], grgb.skyHorizon[2],
        );
        gl.uniform3f(u.u_sunColor, grgb.glow[0], grgb.glow[1], grgb.glow[2]);
        gl.uniform1f(u.u_sunStrength, prof.glowStrength * vis);
        gl.uniform2f(u.u_sunPos, sunX, sunY);
        const now = typeof performance !== 'undefined' ? performance.now() : 0;
        gl.uniform1f(u.u_time, (now - t0) / 1000);

        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

        gl.disable(gl.DEPTH_TEST);
        // Critical: this quad is drawn UNDER the 3D buildings, so it must not
        // write depth — otherwise it would overwrite the ground depth the
        // buildings depth-test against and mis-cull them.
        gl.depthMask(false);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // Keep the sun/rays animating only while the sun is in view. Throttled
        // to ~20fps; idle still fires in the gaps so building rebuilds run.
        if (vis > 0.02 && !repaintScheduled) {
          repaintScheduled = true;
          setTimeout(() => {
            repaintScheduled = false;
            try {
              mapRef?.triggerRepaint();
            } catch {
              /* ignore */
            }
          }, 50);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[ground-fog] render error', e);
      }
    },
  };
}
