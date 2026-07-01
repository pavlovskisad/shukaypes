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
  fog: number; // FogExp2 colour (matches horizon haze)
  fogDensity: number; // exp2 density — higher = closer dissolve
  ambient: number; // fill light colour
  ambientI: number;
  sun: number; // directional light colour
  sunI: number;
}
const DAY: Tone = {
  building: 0xf4f5f7,
  fog: 0xe9ebed,
  fogDensity: 0.00042,
  ambient: 0xdfe6f0,
  ambientI: 2.1,
  sun: 0xfff3d8,
  sunI: 2.6,
};
const NIGHT: Tone = {
  building: 0x20242c,
  fog: 0x2c3646,
  fogDensity: 0.00055,
  ambient: 0x2a3550,
  ambientI: 1.6,
  sun: 0x9fb4d8,
  sunI: 1.3,
};

// Fixed world azimuth the sun comes from (deg from north, clockwise) —
// matches SUN_AZIMUTH in fogLayer so the 2D glow and the 3D shading agree
// on where the light is.
const SUN_AZIMUTH = 125;

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

export function createThreeBuildingsLayer(): CustomLayerInterface {
  let renderer: THREE.WebGLRenderer | null = null;
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const fog = new THREE.FogExp2(DAY.fog, DAY.fogDensity);
  scene.fog = fog;

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

      const positions: number[] = [];
      const normals: number[] = [];

      for (const f of feats) {
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
        // Day/night follows sniff mode — swap fog, light + material tones.
        const sniff = useGameStore.getState().sniffMode;
        const tone = sniff ? NIGHT : DAY;
        fog.color.setHex(tone.fog);
        fog.density = tone.fogDensity;
        ambient.color.setHex(tone.ambient);
        ambient.intensity = tone.ambientI;
        sun.color.setHex(tone.sun);
        sun.intensity = tone.sunI;
        material.color.setHex(tone.building);

        // mainMatrix maps mercator → clip; L places our local-metre,
        // Y-up scene into mercator (translate origin, flip Y for mercator's
        // south-positive axis, rotate Y-up → mercator Z-up).
        const m = new THREE.Matrix4().fromArray(
          Array.from(args.defaultProjectionData.mainMatrix),
        );
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
