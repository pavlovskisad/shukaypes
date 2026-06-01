import { useEffect } from 'react';
import { useGoogleMap } from '@react-google-maps/api';
import rough from 'roughjs';
import type { LatLng } from '@shukajpes/shared';

// Hand-drawn "crayon" walking route. Google's PolylineF can only draw
// a clean vector line — no stroke texture, no wobble — so to get a
// sketchy hand-drawn look we render the route ourselves with rough.js
// inside a custom OverlayView.
//
// Perf: the expensive part (rough.js generating a multi-stroke wobbly
// path) runs ONLY when the zoom level changes. Under pan, Google
// translates the overlay pane for us and the pane-relative pixel
// coords are unchanged, so draw() early-returns and does no work.
// That keeps this as cheap as the PolylineF it replaces — no
// per-frame cost, which matters given how marker-heavy the map is.

interface CrayonRouteProps {
  path: LatLng[];
  color?: string;
  weight?: number;
  opacity?: number;
  // roughness/bowing tune the wobble. Higher = more hand-drawn.
  roughness?: number;
  bowing?: number;
}

// Drop points closer than this many screen pixels to the previously
// kept point. A Directions route can carry hundreds of vertices;
// thinning to a screen-space minimum keeps the generated SVG small
// (and the crayon wobble legible) without changing the visible shape.
const MIN_PX_GAP = 7;
// Extra room around the bbox so the wobble + stroke width don't get
// clipped at the SVG edge.
const PAD = 16;

// Stable per-route seed so the wobble doesn't re-randomise on every
// zoom redraw (which would make the line shimmer). Derived from the
// endpoints so different routes still look different.
function seedFor(path: LatLng[]): number {
  const a = path[0]!;
  const b = path[path.length - 1]!;
  return Math.abs(Math.floor((a.lat + a.lng + b.lat + b.lng) * 1000)) % 100000;
}

function makeOverlay(
  map: google.maps.Map,
  path: LatLng[],
  color: string,
  weight: number,
  opacity: number,
  roughness: number,
  bowing: number,
): google.maps.OverlayView {
  const seed = seedFor(path);

  class CrayonOverlay extends google.maps.OverlayView {
    private div: HTMLDivElement | null = null;
    private lastZoom: number | null = null;

    onAdd() {
      const div = document.createElement('div');
      div.style.position = 'absolute';
      div.style.pointerEvents = 'none'; // never steal taps (clickable:false)
      div.style.willChange = 'transform';
      this.div = div;
      // overlayLayer = non-interactive layer below the marker panes,
      // so the route sits under the pins (same as the old PolylineF).
      this.getPanes()!.overlayLayer.appendChild(div);
    }

    draw() {
      const proj = this.getProjection();
      if (!proj || !this.div) return;
      const zoom = map.getZoom() ?? null;
      // Pan keeps pane-relative coords constant — only zoom changes
      // them. So skip the (relatively) costly rough.js regen unless
      // the zoom actually changed.
      if (zoom === this.lastZoom) return;
      this.lastZoom = zoom;

      // Project to pane pixels + thin in screen space.
      const pts: Array<[number, number]> = [];
      let prev: google.maps.Point | null = null;
      for (let i = 0; i < path.length; i++) {
        const p = path[i]!;
        const px = proj.fromLatLngToDivPixel(
          new google.maps.LatLng(p.lat, p.lng),
        );
        if (!px) continue;
        const isEnd = i === 0 || i === path.length - 1;
        if (!isEnd && prev) {
          const dx = px.x - prev.x;
          const dy = px.y - prev.y;
          if (dx * dx + dy * dy < MIN_PX_GAP * MIN_PX_GAP) continue;
        }
        pts.push([px.x, px.y]);
        prev = px;
      }
      if (pts.length < 2) {
        this.div.innerHTML = '';
        return;
      }

      // Bounding box → position the div, draw points in local coords.
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
      this.div.style.left = `${minX - PAD}px`;
      this.div.style.top = `${minY - PAD}px`;
      this.div.style.width = `${w}px`;
      this.div.style.height = `${h}px`;

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
        preserveVertices: false,
      });
      // Round caps/joins read more like a crayon than the default butt.
      node.querySelectorAll('path').forEach((p) => {
        p.setAttribute('stroke-linecap', 'round');
        p.setAttribute('stroke-linejoin', 'round');
      });
      svg.appendChild(node);

      this.div.innerHTML = '';
      this.div.appendChild(svg);
    }

    onRemove() {
      if (this.div?.parentNode) this.div.parentNode.removeChild(this.div);
      this.div = null;
    }
  }

  return new CrayonOverlay();
}

export function CrayonRoute({
  path,
  color = '#2f6bff',
  weight = 5,
  opacity = 0.9,
  roughness = 2.2,
  bowing = 1.2,
}: CrayonRouteProps) {
  const map = useGoogleMap();
  useEffect(() => {
    if (!map || path.length < 2) return;
    const overlay = makeOverlay(map, path, color, weight, opacity, roughness, bowing);
    overlay.setMap(map);
    return () => overlay.setMap(null);
  }, [map, path, color, weight, opacity, roughness, bowing]);
  return null;
}
