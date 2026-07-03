// Client-side building avoidance for the game render.
//
// Dogs, paws and bones are placed from GPS / spawn data that doesn't know
// about buildings, so they can land *inside* a building footprint — which
// looks wrong once the city is 3D. This nudges a DISPLAY position out of any
// building polygon to the nearest open ground. It's display-only: the real
// positions (used for collect distance, presence, etc.) are untouched.
//
// Uses the same footprints the 3D buildings do (querySourceFeatures on the
// OpenMapTiles `building` source-layer), indexed into a coarse grid so the
// per-marker test only checks nearby polygons. Rebuilt on `idle` as tiles
// stream in; `version()` bumps so React memos can recompute nudged positions.

import type { Map as MlMap } from 'maplibre-gl';

interface LatLng {
  lat: number;
  lng: number;
}
type Ring = [number, number][]; // [lng, lat]
interface Poly {
  rings: Ring[]; // rings[0] outer, rest holes
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const SOURCE_ID = 'openmaptiles';
const SOURCE_LAYER = 'building';
// Grid cell in degrees (~85m lng / ~55m lat in Kyiv) — a footprint touches a
// handful of cells; a lookup checks its cell + 8 neighbours.
const CELL = 0.0008;

export interface BuildingAvoider {
  rebuild(): void;
  nudge(pos: LatLng, marginM?: number): LatLng;
  version(): number;
}

function pointInRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0];
    const yi = ring[i]![1];
    const xj = ring[j]![0];
    const yj = ring[j]![1];
    const hit = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

export function createBuildingAvoider(map: MlMap): BuildingAvoider {
  let polys: Poly[] = [];
  let grid = new Map<string, number[]>();
  let ver = 0;

  const rebuild = () => {
    try {
      const feats = map.querySourceFeatures(SOURCE_ID, {
        sourceLayer: SOURCE_LAYER,
      });
      const next: Poly[] = [];
      for (const f of feats) {
        const g = f.geometry;
        if (!g) continue;
        const polygons: Ring[][] =
          g.type === 'Polygon'
            ? [g.coordinates as unknown as Ring[]]
            : g.type === 'MultiPolygon'
              ? (g.coordinates as unknown as Ring[][])
              : [];
        for (const rings of polygons) {
          const outer = rings[0];
          if (!outer || outer.length < 3) continue;
          let minX = Infinity;
          let minY = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          for (const p of outer) {
            if (p[0] < minX) minX = p[0];
            if (p[0] > maxX) maxX = p[0];
            if (p[1] < minY) minY = p[1];
            if (p[1] > maxY) maxY = p[1];
          }
          next.push({ rings, minX, minY, maxX, maxY });
        }
      }
      const nextGrid = new Map<string, number[]>();
      next.forEach((p, idx) => {
        const cx0 = Math.floor(p.minX / CELL);
        const cx1 = Math.floor(p.maxX / CELL);
        const cy0 = Math.floor(p.minY / CELL);
        const cy1 = Math.floor(p.maxY / CELL);
        for (let cx = cx0; cx <= cx1; cx++) {
          for (let cy = cy0; cy <= cy1; cy++) {
            const k = `${cx},${cy}`;
            const arr = nextGrid.get(k);
            if (arr) arr.push(idx);
            else nextGrid.set(k, [idx]);
          }
        }
      });
      polys = next;
      grid = nextGrid;
      ver++;
    } catch {
      /* keep the previous index on any query hiccup */
    }
  };

  const insidePoly = (x: number, y: number, p: Poly): boolean => {
    if (x < p.minX || x > p.maxX || y < p.minY || y > p.maxY) return false;
    if (!pointInRing(x, y, p.rings[0]!)) return false;
    for (let h = 1; h < p.rings.length; h++) {
      if (pointInRing(x, y, p.rings[h]!)) return false; // in a hole → outside
    }
    return true;
  };

  // Push (px,py) — known inside `p` — to just outside the nearest outer edge.
  const pushOut = (px: number, py: number, p: Poly, marginM: number, lat: number): LatLng => {
    const ring = p.rings[0]!;
    let bx = px;
    let by = py;
    let best = Infinity;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const ax = ring[j]![0];
      const ay = ring[j]![1];
      const cx = ring[i]![0];
      const cy = ring[i]![1];
      const dx = cx - ax;
      const dy = cy - ay;
      const len2 = dx * dx + dy * dy || 1e-12;
      let t = ((px - ax) * dx + (py - ay) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx;
      const ey = ay + t * dy;
      const ddx = px - ex;
      const ddy = py - ey;
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 < best) {
        best = d2;
        bx = ex;
        by = ey;
      }
    }
    // Direction from the interior point toward the nearest edge = outward.
    const vx = bx - px;
    const vy = by - py;
    const vlen = Math.hypot(vx, vy) || 1e-9;
    const mLng = marginM / (111320 * Math.cos((lat * Math.PI) / 180));
    const mLat = marginM / 110540;
    return { lng: bx + (vx / vlen) * mLng, lat: by + (vy / vlen) * mLat };
  };

  const nudge = (pos: LatLng, marginM = 4): LatLng => {
    if (!polys.length) return pos;
    const cx = Math.floor(pos.lng / CELL);
    const cy = Math.floor(pos.lat / CELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const arr = grid.get(`${cx + dx},${cy + dy}`);
        if (!arr) continue;
        for (const i of arr) {
          const p = polys[i]!;
          if (insidePoly(pos.lng, pos.lat, p)) {
            return pushOut(pos.lng, pos.lat, p, marginM, pos.lat);
          }
        }
      }
    }
    return pos;
  };

  return { rebuild, nudge, version: () => ver };
}
