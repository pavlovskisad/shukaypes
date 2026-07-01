// Tier-2 "game render" buildings as a Three.js custom MapLibre layer.
//
// WHY THIS EXISTS
// ---------------
// The screen-space fog layer (fogLayer.ts) fakes depth by fogging the top
// of the screen — good for the sky/ground band, but it can't fog buildings
// by their TRUE distance (a tall near tower and a far one at the same
// screen height get the same haze). MapLibre's own depth buffer isn't
// reachable for a real post-process, so per-building distance fog was off
// the table with the 2D approach.
//
// A Three.js custom layer renders ITS OWN geometry into the shared GL
// context + depth buffer, so THREE.FogExp2 fogs every building by real
// camera distance for free. That's the whole point: extrude the city's
// footprints as low-poly meshes, light them with one directional "sun",
// and let exponential fog dissolve the distance the way a game would.
//
// HOW IT LINES UP WITH THE MAP
// ----------------------------
// The threebox/MapLibre-official pattern: a WebGLRenderer sharing the map's
// gl context; the scene lives in LOCAL METRES around a mercator origin; and
// each frame camera.projectionMatrix = mainMatrix ⊗ modelTransform maps
// that local metre space into MapLibre's clip space (so it tracks pan / zoom
// / pitch / bearing exactly and depth-tests against the base map).
//
// Geometry is rebuilt on `idle` from querySourceFeatures — as the user pans
// and new building tiles load, we re-extrude what's in view around a fresh
// origin (keeps float precision tight and the mesh count bounded).

import * as THREE from 'three';
import { MercatorCoordinate } from 'maplibre-gl';
import type {
  CustomLayerInterface,
  CustomRenderMethodInput,
  Map as MlMap,
} from 'maplibre-gl';
import { useGameStore } from '../../stores/gameStore';

export const THREE_BUILDINGS_LAYER_ID = 'three-buildings';

// OpenMapTiles (OpenFreeMap "liberty") schema — buildings live under the
// `openmaptiles` source, `building` source-layer, with render_height /
// render_min_height in metres.
const SOURCE_ID = 'openmaptiles';
const SOURCE_LAYER = 'building';

// Fallback height (m) for footprints with no render_height tag — a modest
// two-storey block so untagged buildings still read as volumes, not slabs.
const DEFAULT_HEIGHT = 6;

// Only rebuild when the camera has actually moved somewhere new — panning a
// couple of blocks re-queries; nudging the map or opening a modal doesn't.
const REBUILD_MOVE_M = 180;
const REBUILD_ZOOM_D = 0.6;

// Day / night (sniff) tones. Buildings are the same paper-white as the 2D
// map so the two building treatments would be interchangeable; fog + light
// colours match the sky/haze palette in crayonStyle so the Three fog blends
// seamlessly into the screen-space atmosphere at the horizon.
interface Tone {
  building: number; // mesh base colour
  fog: number; // mist colour (matches the 2D horizon haze)
  // "Mist wall" tied to TRUE distance from the camera (metres). Everything
  // nearer than fogNear is perfectly crisp; past it the mist thickens
  // EXPONENTIALLY (1 - e^(-density·d)) so it goes to (near-)full over a
  // short band — a concentrated wall. That density curve is what makes
  // far buildings sit fully hidden and then emerge one-by-one / in groups
  // as the camera moves them across the ramp.
  fogNear: number;
  fogDensity: number;
  ambient: number; // fill light colour
  ambientI: number;
  sun: number; // directional light colour
  sunI: number;
}
const DAY: Tone = {
  building: 0xf4f5f7,
  fog: 0xedf0f3,
  fogNear: 560,
  fogDensity: 0.009,
  ambient: 0xdfe6f0,
  ambientI: 2.1,
  sun: 0xfff3d8,
  sunI: 2.6,
};
const NIGHT: Tone = {
  building: 0x20242c,
  fog: 0x2c3646,
  fogNear: 470,
  fogDensity: 0.011,
  ambient: 0x2a3550,
  ambientI: 1.6,
  sun: 0x9fb4d8,
  sunI: 1.3,
};

// Fixed world azimuth the sun comes from (deg from north, clockwise) —
// matches SUN_AZIMUTH in fogLayer so the 2D glow and the 3D shading agree
// on where the light is.
const SUN_AZIMUTH = 125;

// Ground-mist "pool" that gives the fog SUBSTANCE (vs a flat distance
// cutout): the haze is thickest at ground level and thins out by MIST_TOP
// metres up, so buildings rise out of it — their bases sink into mist while
// their tops stay clear, like the reference. POOL_STRENGTH caps how opaque
// the pool gets. It ramps in with distance (see shader) so the immediate
// foreground bases stay crisp.
const MIST_TOP = 42;
const POOL_STRENGTH = 0.9;

type LngLat = [number, number];

// Project a lng/lat to local metres (x=east, y=north) around an origin.
function toLocal(
  lng: number,
  lat: number,
  originX: number,
  originY: number,
  mPerUnit: number,
): [number, number] {
  const m = MercatorCoordinate.fromLngLat([lng, lat], 0);
  // mercator y grows southward; flip so +y is north in the shape plane.
  return [(m.x - originX) / mPerUnit, (originY - m.y) / mPerUnit];
}

// Build a THREE.Shape (outer ring + holes) from a GeoJSON polygon ring set,
// in local metres. rings[0] is the outer boundary; rings[1..] are holes.
function shapeFromRings(
  rings: LngLat[][],
  originX: number,
  originY: number,
  mPerUnit: number,
): THREE.Shape | null {
  const outer = rings[0];
  if (!outer || outer.length < 3) return null;
  const shape = new THREE.Shape();
  outer.forEach(([lng, lat], i) => {
    const [x, y] = toLocal(lng, lat, originX, originY, mPerUnit);
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  for (let h = 1; h < rings.length; h++) {
    const ring = rings[h];
    if (!ring || ring.length < 3) continue;
    const path = new THREE.Path();
    ring.forEach(([lng, lat], i) => {
      const [x, y] = toLocal(lng, lat, originX, originY, mPerUnit);
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    });
    shape.holes.push(path);
  }
  return shape;
}

// Recover the camera's world (mercator) position from a view-projection
// matrix. The four *side* frustum planes (left/right/top/bottom) all pass
// through the camera apex, so solving any three of them for their common
// point gives the eye — no dependence on MapLibre's internal transform.
// `m` is column-major (WebGL/gl-matrix): element (row r, col c) = m[c*4+r].
function eyeFromMainMatrix(m: ArrayLike<number>): [number, number, number] | null {
  // rows of M
  const r0 = [m[0], m[4], m[8], m[12]];
  const r1 = [m[1], m[5], m[9], m[13]];
  const r3 = [m[3], m[7], m[11], m[15]];
  // side planes = r3 ± r0 (left/right), r3 ± r1 (top/bottom)
  const left = [r3[0] + r0[0], r3[1] + r0[1], r3[2] + r0[2], r3[3] + r0[3]];
  const right = [r3[0] - r0[0], r3[1] - r0[1], r3[2] - r0[2], r3[3] - r0[3]];
  const top = [r3[0] - r1[0], r3[1] - r1[1], r3[2] - r1[2], r3[3] - r1[3]];
  // Solve [n1;n2;n3]·X = -d  (Cramer's rule on the 3×3 of plane normals).
  const a = [
    [left[0], left[1], left[2]],
    [right[0], right[1], right[2]],
    [top[0], top[1], top[2]],
  ];
  const b = [-left[3], -right[3], -top[3]];
  const det =
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
    a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
    a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-20) return null;
  const inv = 1 / det;
  const det3 = (
    c0: number[], c1: number[], c2: number[],
  ): number =>
    c0[0] * (c1[1] * c2[2] - c1[2] * c2[1]) -
    c0[1] * (c1[0] * c2[2] - c1[2] * c2[0]) +
    c0[2] * (c1[0] * c2[1] - c1[1] * c2[0]);
  const col0 = [a[0][0], a[1][0], a[2][0]];
  const col1 = [a[0][1], a[1][1], a[2][1]];
  const col2 = [a[0][2], a[1][2], a[2][2]];
  const x = det3(b, col1, col2) * inv;
  const y = det3(col0, b, col2) * inv;
  const z = det3(col0, col1, b) * inv;
  return [x, y, z];
}

export function createThreeBuildingsLayer(): CustomLayerInterface {
  let renderer: THREE.WebGLRenderer | null = null;
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();

  const ambient = new THREE.AmbientLight(DAY.ambient, DAY.ambientI);
  const sun = new THREE.DirectionalLight(DAY.sun, DAY.sunI);
  // Light position defines the direction it shines FROM (toward origin).
  // Azimuth 125° → east sin, north cos; put it high in the sky.
  {
    const az = (SUN_AZIMUTH * Math.PI) / 180;
    sun.position.set(Math.sin(az), 0.85, Math.cos(az)).normalize();
  }
  scene.add(ambient);
  scene.add(sun);

  const material = new THREE.MeshLambertMaterial({
    color: DAY.building,
    // Slight self-lighting so shadowed walls never crush to pure black —
    // reads as ambient sky bounce, keeps the low-poly city airy.
    emissive: 0x0b0d12,
    emissiveIntensity: 0.15,
  });
  // We don't use scene.fog — its factor is view-space depth, but we drive
  // the whole placement through camera.projectionMatrix with no real view
  // matrix, so that depth would be the local N/S axis, not distance from the
  // eye. Instead inject a TRUE-distance linear fog: distance from the real
  // camera position (fed in as u_camLocal each frame) to each fragment, then
  // mix toward the mist colour between fogNear and fogFar. RGB-only mix keeps
  // the mesh opaque, so far buildings become the mist colour (silhouettes
  // dissolving into the horizon haze) with no transparency-sorting issues.
  material.fog = false;
  const fogUniforms = {
    u_camLocal: { value: new THREE.Vector3() },
    u_fogColor: { value: new THREE.Color(DAY.fog) },
    u_fogNear: { value: DAY.fogNear },
    u_fogDensity: { value: DAY.fogDensity },
  };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.u_camLocal = fogUniforms.u_camLocal;
    shader.uniforms.u_fogColor = fogUniforms.u_fogColor;
    shader.uniforms.u_fogNear = fogUniforms.u_fogNear;
    shader.uniforms.u_fogDensity = fogUniforms.u_fogDensity;
    shader.vertexShader =
      'varying vec3 vLocalPos;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vLocalPos = position;',
      );
    shader.fragmentShader =
      'uniform vec3 u_camLocal;\nuniform vec3 u_fogColor;\nuniform float u_fogNear;\nuniform float u_fogDensity;\nvarying vec3 vLocalPos;\n' +
      shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        [
          '#include <dithering_fragment>',
          '  float _dist = length(vLocalPos - u_camLocal);',
          // Exponential distance fog — the "wall" that swallows the far.
          '  float _distFog = 1.0 - exp(-u_fogDensity * max(0.0, _dist - u_fogNear));',
          // Ground-mist pool — thick at y=0, gone by MIST_TOP; ramps in with
          // distance so foreground bases stay crisp. This is the height
          // component that makes buildings RISE OUT of the mist (substance).
          `  float _pool = 1.0 - smoothstep(0.0, ${MIST_TOP.toFixed(1)}, vLocalPos.y);`,
          '  _pool *= smoothstep(u_fogNear * 0.55, u_fogNear * 1.05, _dist);',
          `  float _f = clamp(max(_distFog, _pool * ${POOL_STRENGTH.toFixed(2)}), 0.0, 1.0);`,
          '  gl_FragColor.rgb = mix(gl_FragColor.rgb, u_fogColor, _f);',
        ].join('\n'),
      );
  };

  let mesh: THREE.Mesh | null = null;
  let mapRef: MlMap | null = null;

  // Mercator origin of the current mesh + the metre scale at that origin.
  let originX = 0;
  let originY = 0;
  let originZ = 0;
  let mPerUnit = 1;

  // Signature of the last build so idle ticks don't rebuild needlessly.
  let builtLng = NaN;
  let builtLat = NaN;
  let builtZoom = NaN;
  let building = false;

  const rebuild = () => {
    const map = mapRef;
    if (!map || building) return;
    building = true;
    try {
      const center = map.getCenter();
      const zoom = map.getZoom();

      const feats = map.querySourceFeatures(SOURCE_ID, {
        sourceLayer: SOURCE_LAYER,
      });
      if (!feats.length) {
        building = false;
        return;
      }

      // Fresh origin at the current centre — keeps vertex magnitudes small.
      const origin = MercatorCoordinate.fromLngLat(
        [center.lng, center.lat],
        0,
      );
      originX = origin.x;
      originY = origin.y;
      originZ = origin.z;
      mPerUnit = origin.meterInMercatorCoordinateUnits();

      // Vector tiles buffer + clip features at tile edges, so
      // querySourceFeatures returns the same building several times — a full
      // copy from its home tile plus clipped/buffered copies from
      // neighbours. Those coincident roofs z-fight and their walls double up
      // along tile seams. Dedup by feature id, keeping the copy with the
      // largest footprint bbox (the most complete, least-clipped one).
      const dedup = new Map<string, { f: (typeof feats)[number]; area: number }>();
      for (const f of feats) {
        const g = f.geometry;
        if (!g) continue;
        let key: string;
        if (f.id != null) {
          key = 'i' + f.id;
        } else {
          const c0 =
            g.type === 'Polygon'
              ? (g.coordinates[0]?.[0] as number[] | undefined)
              : g.type === 'MultiPolygon'
                ? (g.coordinates[0]?.[0]?.[0] as number[] | undefined)
                : undefined;
          key = c0 ? `c${c0[0].toFixed(5)},${c0[1].toFixed(5)}` : `n${dedup.size}`;
        }
        const rings: number[][][] =
          g.type === 'Polygon'
            ? (g.coordinates as unknown as number[][][])
            : g.type === 'MultiPolygon'
              ? (g.coordinates as unknown as number[][][][]).flat()
              : [];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const ring of rings)
          for (const p of ring) {
            if (p[0] < minX) minX = p[0];
            if (p[0] > maxX) maxX = p[0];
            if (p[1] < minY) minY = p[1];
            if (p[1] > maxY) maxY = p[1];
          }
        const area = Number.isFinite(minX) ? (maxX - minX) * (maxY - minY) : 0;
        const prev = dedup.get(key);
        if (!prev || area > prev.area) dedup.set(key, { f, area });
      }

      const positions: number[] = [];
      const normals: number[] = [];

      for (const { f } of dedup.values()) {
        const geom = f.geometry;
        if (!geom) continue;
        const props = (f.properties ?? {}) as Record<string, unknown>;
        const height =
          Number(props.render_height ?? props.height ?? DEFAULT_HEIGHT) ||
          DEFAULT_HEIGHT;
        const minH = Number(props.render_min_height ?? 0) || 0;
        const depth = Math.max(1, height - minH);

        const polys: LngLat[][][] =
          geom.type === 'Polygon'
            ? [geom.coordinates as unknown as LngLat[][]]
            : geom.type === 'MultiPolygon'
              ? (geom.coordinates as unknown as LngLat[][][])
              : [];

        for (const rings of polys) {
          const shape = shapeFromRings(rings, originX, originY, mPerUnit);
          if (!shape) continue;
          let geo: THREE.ExtrudeGeometry;
          try {
            geo = new THREE.ExtrudeGeometry(shape, {
              depth,
              bevelEnabled: false,
              steps: 1,
            });
          } catch {
            continue; // degenerate footprint — skip
          }
          // Shape lives in XY (x=east, y=north), extruded along +Z. Rotate
          // so the extrusion points up (+Y) in a Y-up world (x=east, y=up,
          // z=south), then lift onto its min-height base.
          geo.rotateX(-Math.PI / 2);
          if (minH) geo.translate(0, minH, 0);
          const ni = geo.toNonIndexed();
          const pos = ni.getAttribute('position');
          const nor = ni.getAttribute('normal');
          for (let i = 0; i < pos.count; i++) {
            positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
            normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
          }
          geo.dispose();
          ni.dispose();
        }
      }

      if (!positions.length) {
        building = false;
        return;
      }

      const merged = new THREE.BufferGeometry();
      merged.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(positions, 3),
      );
      merged.setAttribute(
        'normal',
        new THREE.Float32BufferAttribute(normals, 3),
      );

      if (mesh) {
        scene.remove(mesh);
        mesh.geometry.dispose();
      }
      mesh = new THREE.Mesh(merged, material);
      // We drive placement entirely through camera.projectionMatrix, so the
      // mesh stays at the identity origin. Frustum culling would use its
      // (untransformed) local bounds and wrongly cull it — turn it off.
      mesh.frustumCulled = false;
      scene.add(mesh);

      builtLng = center.lng;
      builtLat = center.lat;
      builtZoom = zoom;
    } catch (e) {
      // Never let a rebuild hiccup take down the map.
      // eslint-disable-next-line no-console
      console.error('[three-buildings] rebuild failed', e);
    } finally {
      building = false;
    }
  };

  const maybeRebuild = () => {
    const map = mapRef;
    if (!map) return;
    if (Number.isNaN(builtLng)) {
      rebuild();
      return;
    }
    const c = map.getCenter();
    const dz = Math.abs(map.getZoom() - builtZoom);
    // cheap great-circle-ish metre delta from the last build centre
    const dLat = (c.lat - builtLat) * 110540;
    const dLng =
      (c.lng - builtLng) * 111320 * Math.cos((c.lat * Math.PI) / 180);
    const moved = Math.sqrt(dLat * dLat + dLng * dLng);
    if (moved > REBUILD_MOVE_M || dz > REBUILD_ZOOM_D) rebuild();
  };

  return {
    id: THREE_BUILDINGS_LAYER_ID,
    type: 'custom',
    renderingMode: '3d',

    onAdd(map: MlMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
      mapRef = map;
      renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl as WebGLRenderingContext,
        antialias: true,
      });
      renderer.autoClear = false;
      // Rebuild the extruded city whenever the map settles somewhere new.
      map.on('idle', maybeRebuild);
    },

    onRemove() {
      const map = mapRef;
      if (map) map.off('idle', maybeRebuild);
      if (mesh) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        mesh = null;
      }
      material.dispose();
      renderer?.dispose();
      renderer = null;
      mapRef = null;
    },

    render(
      _gl: WebGLRenderingContext | WebGL2RenderingContext,
      args: CustomRenderMethodInput,
    ) {
      if (!renderer || !mesh) return;
      try {
        // Day/night follows sniff mode — swap mist, light + material tones.
        const sniff = useGameStore.getState().sniffMode;
        const tone = sniff ? NIGHT : DAY;
        fogUniforms.u_fogColor.value.setHex(tone.fog);
        fogUniforms.u_fogNear.value = tone.fogNear;
        fogUniforms.u_fogDensity.value = tone.fogDensity;
        ambient.color.setHex(tone.ambient);
        ambient.intensity = tone.ambientI;
        sun.color.setHex(tone.sun);
        sun.intensity = tone.sunI;
        material.color.setHex(tone.building);

        const mmArr = Array.from(args.defaultProjectionData.mainMatrix);

        // Feed the TRUE camera position (mercator → local metres, matching
        // the mesh's frame) so the distance-fog wall is measured from the
        // eye — it then reveals/hides buildings correctly as you pan AND
        // rotate, not just when facing north.
        const eye = eyeFromMainMatrix(mmArr);
        if (eye) {
          fogUniforms.u_camLocal.value.set(
            (eye[0] - originX) / mPerUnit, // east
            (eye[2] - originZ) / mPerUnit, // up
            (eye[1] - originY) / mPerUnit, // south
          );
        }

        // mainMatrix maps mercator → clip; L places our local-metre,
        // Y-up scene into mercator (translate origin, flip Y for mercator's
        // south-positive axis, rotate Y-up → mercator Z-up).
        const m = new THREE.Matrix4().fromArray(mmArr);
        const l = new THREE.Matrix4()
          .makeTranslation(originX, originY, originZ)
          .multiply(
            new THREE.Matrix4().makeScale(mPerUnit, -mPerUnit, mPerUnit),
          )
          .multiply(
            new THREE.Matrix4().makeRotationAxis(
              new THREE.Vector3(1, 0, 0),
              Math.PI / 2,
            ),
          );
        camera.projectionMatrix = m.multiply(l);

        renderer.resetState();
        renderer.render(scene, camera);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[three-buildings] render error', e);
      }
    },
  };
}
