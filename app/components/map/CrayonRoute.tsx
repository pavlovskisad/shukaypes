import { useEffect } from 'react';
import { useGoogleMap } from '@react-google-maps/api';
import rough from 'roughjs';
import type { LatLng } from '@shukajpes/shared';

// Hand-drawn "crayon" walking route. Google's PolylineF can only draw
// a clean vector line — no wobble — so we render the route ourselves
// with rough.js inside a custom OverlayView (CrayonRoute).
//
// Anchoring + perf split (this is the important bit):
//   - The div's screen position is recomputed on EVERY draw() —
//     that's the proven Google custom-overlay pattern. fromLatLngTo
//     DivPixel changes as the map pans, so skipping this makes the
//     overlay stick to the screen instead of the geography (the pan
//     bug). It's one projection + two style writes, basically free.
//   - The expensive part (rough.js regenerating the wobbly SVG) runs
//     ONLY when the zoom level changes — at constant zoom the route's
//     pixel SHAPE is unchanged, just translated, so we reuse the SVG
//     and only move the div. No per-frame rough.js cost.

interface CrayonRouteProps {
  path: LatLng[];
  color?: string;
  weight?: number;
  opacity?: number;
  // Wobble tuning. Lower = more continuous / less sketchy.
  roughness?: number;
  bowing?: number;
}

// Drop points closer than this many screen pixels to the previously
// kept point — a Directions route can carry hundreds of vertices;
// thinning keeps the SVG small without changing the visible shape.
const MIN_PX_GAP = 7;
// Room around the bbox so the wobble + stroke width aren't clipped.
const PAD = 18;

// Stable per-route seed so the wobble doesn't re-randomise on every
// zoom redraw (which would make the line shimmer).
function seedFor(path: LatLng[]): number {
  const a = path[0]!;
  const b = path[path.length - 1]!;
  return Math.abs(Math.floor((a.lat + a.lng + b.lat + b.lng) * 1000)) % 100000;
}

// Unique-id source so each overlay's SVG filter doesn't collide.
let FILTER_UID = 0;

// Crayon-grain SVG filter. rough.js only wobbles the path GEOMETRY —
// the stroke fill is still a clean, solid "marker ink" shape. This
// filter adds the actual crayon TEXTURE:
//   1. feTurbulence (coarse) + feDisplacementMap roughens the stroke
//      EDGES so they're irregular, not the crisp edge of a marker.
//   2. feTurbulence (fine) shaped into an alpha mask + feComposite
//      "in" speckles the fill — paper grain showing through, like
//      crayon dragged over a textured page (alpha floored at ~0.5 so
//      it textures without breaking the line apart).
// Rasterised once per zoom (when the SVG is rebuilt); pan just
// translates the cached result, so no per-frame filter cost.
function crayonFilterMarkup(id: string, seed: number): string {
  return `
    <filter id="${id}" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="${seed % 1000}" result="warp"/>
      <feDisplacementMap in="SourceGraphic" in2="warp" scale="4.5" xChannelSelector="R" yChannelSelector="G" result="rough"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.32" numOctaves="2" seed="${(seed + 17) % 1000}" result="speck"/>
      <feComponentTransfer in="speck" result="grain">
        <feFuncA type="linear" slope="1.1" intercept="0.35"/>
      </feComponentTransfer>
      <feComposite in="rough" in2="grain" operator="in"/>
    </filter>`;
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
  const filterId = `crayon-tex-${++FILTER_UID}`;

  class CrayonOverlay extends google.maps.OverlayView {
    private div: HTMLDivElement | null = null;
    private lastZoom: number | null = null;
    // Offset from path[0]'s pane pixel to the div's top-left corner,
    // captured at regen time. Stable under pan (uniform translation),
    // only changes with zoom — lets us reposition every frame from a
    // single projection.
    private offX = 0;
    private offY = 0;

    onAdd() {
      const div = document.createElement('div');
      div.style.position = 'absolute';
      div.style.pointerEvents = 'none'; // never steal taps (clickable:false)
      this.div = div;
      // overlayLayer = non-interactive layer below the marker panes,
      // so the route sits under the pins (same as the old PolylineF).
      this.getPanes()!.overlayLayer.appendChild(div);
    }

    private regenerate(proj: google.maps.MapCanvasProjection) {
      if (!this.div) return;
      // Project to pane pixels + thin in screen space.
      const pts: Array<[number, number]> = [];
      let prev: google.maps.Point | null = null;
      let firstPx: google.maps.Point | null = null;
      for (let i = 0; i < path.length; i++) {
        const p = path[i]!;
        const px = proj.fromLatLngToDivPixel(new google.maps.LatLng(p.lat, p.lng));
        if (!px) continue;
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
        this.div.innerHTML = '';
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
      this.div.style.width = `${w}px`;
      this.div.style.height = `${h}px`;
      // Capture div-top-left relative to path[0] so pan can reposition
      // from one projection.
      this.offX = minX - PAD - firstPx.x;
      this.offY = minY - PAD - firstPx.y;

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
        // Multi-stroke back ON for a hand-drawn "discontinued" feel —
        // the overlapping passes break the line up here and there.
        // Kept at a lower roughness than the original brushy version
        // so the breaks read as occasional crayon character, not a
        // busy scribble.
        disableMultiStroke: false,
      });
      node.querySelectorAll('path').forEach((p) => {
        p.setAttribute('stroke-linecap', 'round');
        p.setAttribute('stroke-linejoin', 'round');
      });

      // Crayon-grain filter lives in <defs>; apply it to the whole
      // rough path group so the texture covers every stroke pass.
      const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      defs.innerHTML = crayonFilterMarkup(filterId, seed);
      svg.appendChild(defs);
      node.setAttribute('filter', `url(#${filterId})`);

      svg.appendChild(node);
      this.div.innerHTML = '';
      this.div.appendChild(svg);
    }

    draw() {
      const proj = this.getProjection();
      if (!proj || !this.div) return;
      const zoom = map.getZoom() ?? null;
      if (zoom !== this.lastZoom) {
        this.lastZoom = zoom;
        this.regenerate(proj);
      }
      // Reposition EVERY frame (pan + zoom) from path[0]'s current
      // pane pixel + the captured offset. This is what keeps the route
      // pinned to the geography as the map moves.
      const a = proj.fromLatLngToDivPixel(
        new google.maps.LatLng(path[0]!.lat, path[0]!.lng),
      );
      if (a) {
        this.div.style.left = `${a.x + this.offX}px`;
        this.div.style.top = `${a.y + this.offY}px`;
      }
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
  weight = 10,
  opacity = 0.92,
  roughness = 1.8,
  bowing = 1.0,
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
