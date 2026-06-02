import { useEffect } from 'react';
import maplibregl from 'maplibre-gl';
import rough from 'roughjs';
import type { LatLng } from '@shukajpes/shared';
import { useMaplibreMap } from './MapContext';

// Hand-drawn "crayon" walking route — MapLibre port. Renders the route
// as a rough.js sketchy SVG attached to the map's canvas container,
// positioned each frame from map.project() so the route stays pinned
// to the geography under pan/zoom. The rough.js regenerate runs ONLY
// when zoom changes; pan just translates the cached SVG.

interface CrayonRouteProps {
  path: LatLng[];
  color?: string;
  weight?: number;
  opacity?: number;
  roughness?: number;
  bowing?: number;
}

const MIN_PX_GAP = 11;
const PAD = 18;

function seedFor(path: LatLng[]): number {
  const a = path[0]!;
  const b = path[path.length - 1]!;
  return Math.abs(Math.floor((a.lat + a.lng + b.lat + b.lng) * 1000)) % 100000;
}

function attachRoute(
  map: maplibregl.Map,
  path: LatLng[],
  color: string,
  weight: number,
  opacity: number,
  roughness: number,
  bowing: number,
): () => void {
  const seed = seedFor(path);
  const div = document.createElement('div');
  div.style.position = 'absolute';
  div.style.pointerEvents = 'none';
  div.style.left = '0px';
  div.style.top = '0px';

  // canvasContainer holds MapLibre's WebGL canvas + transforms with
  // pan/zoom. Absolute children inside it move with the map.
  const container = map.getCanvasContainer();
  container.appendChild(div);

  let lastZoom: number | null = null;
  let offX = 0;
  let offY = 0;

  const regenerate = () => {
    const pts: Array<[number, number]> = [];
    let prev: maplibregl.Point | null = null;
    let firstPx: maplibregl.Point | null = null;
    for (let i = 0; i < path.length; i++) {
      const p = path[i]!;
      const px = map.project([p.lng, p.lat]);
      if (i === 0) firstPx = px;
      const isEnd = i === 0 || i === path.length - 1;
      if (!isEnd && prev) {
        const dx = px.x - prev.x;
        const dy = px.y - prev.y;
        if (dx * dx + dy * dy < MIN_PX_GAP * MIN_PX_GAP) continue;
      }
      pts.push([px.x, px.y]);
      prev = px;
    }
    if (pts.length < 2 || !firstPx) {
      div.innerHTML = '';
      return;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of pts) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const w = maxX - minX + PAD * 2;
    const h = maxY - minY + PAD * 2;
    div.style.width = `${w}px`;
    div.style.height = `${h}px`;
    offX = minX - PAD - firstPx.x;
    offY = minY - PAD - firstPx.y;

    const local: Array<[number, number]> = pts.map(([x, y]) => [
      x - minX + PAD,
      y - minY + PAD,
    ]);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', `${w}`);
    svg.setAttribute('height', `${h}`);
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.style.opacity = `${opacity}`;
    svg.style.overflow = 'visible';

    const rc = rough.svg(svg);
    const node = rc.linearPath(local, {
      stroke: color,
      strokeWidth: weight,
      roughness,
      bowing,
      seed,
      preserveVertices: true,
      // Single-stroke pass — the second wobbly pass roughly doubles
      // the geometry and was a big contributor to the lag the user
      // saw on long routes. The crayon character still reads with
      // just rough.js's primary stroke.
      disableMultiStroke: true,
    });
    node.querySelectorAll('path').forEach((p) => {
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('stroke-linejoin', 'round');
    });
    // SVG filter (feTurbulence + feDisplacementMap) used to live here
    // for an extra paper-tooth feel. It re-paints on every frame of
    // pan/zoom because MapLibre repositions the div, and a long city
    // route inside it caused noticeable lag. The rough.js stroke alone
    // is hand-drawn enough — keep the route fast.
    svg.appendChild(node);
    div.innerHTML = '';
    div.appendChild(svg);
  };

  const reposition = () => {
    const a = map.project([path[0]!.lng, path[0]!.lat]);
    div.style.left = `${a.x + offX}px`;
    div.style.top = `${a.y + offY}px`;
  };

  const onMove = () => {
    const zoom = map.getZoom();
    if (zoom !== lastZoom) {
      lastZoom = zoom;
      regenerate();
    }
    reposition();
  };

  // Initial render — wait for style to be loaded so projection is
  // valid; if it already is, run immediately.
  if (map.isStyleLoaded()) {
    onMove();
  } else {
    map.once('load', onMove);
  }
  map.on('move', onMove);

  return () => {
    map.off('move', onMove);
    if (div.parentNode) div.parentNode.removeChild(div);
  };
}

export function CrayonRoute({
  path,
  color = '#2f6bff',
  weight = 10,
  opacity = 0.92,
  roughness = 1.8,
  bowing = 1.0,
}: CrayonRouteProps) {
  const map = useMaplibreMap();
  useEffect(() => {
    if (!map || path.length < 2) return;
    return attachRoute(map, path, color, weight, opacity, roughness, bowing);
  }, [map, path, color, weight, opacity, roughness, bowing]);
  return null;
}
