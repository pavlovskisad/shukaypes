import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import maplibregl from 'maplibre-gl';
import type { LatLng } from '@shukajpes/shared';
import { useMaplibreMap } from './MapContext';
import { playPop } from '../../utils/popOnTap';

type AnchorOption =
  | 'center'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

interface Props {
  position: LatLng;
  // Anchor of the element relative to the lat/lng point. 'bottom'
  // makes the element's bottom edge sit on the point (pin-style).
  // 'center' is MapLibre's default.
  anchor?: AnchorOption;
  // Pixel offset applied on top of the anchor. [x, y] — positive y =
  // down, positive x = right.
  offset?: [number, number];
  // CSS z-index passed through to the wrapper div.
  zIndex?: number;
  // Optional click handler on the marker wrapper.
  onClick?: () => void;
  // Hide this marker while it projects into the top "sky" band at steep
  // pitch. At the game-camera tilt, distant markers compress toward the
  // horizon and pile up at the top of the screen; culling them keeps the
  // near field clean. Pitch-gated (no cull on a flat-ish map) and the
  // band widens with pitch. Opt-in — only the markers that actually pile
  // (dogs, clusters, paws, bones, POIs) set it; the companion / user /
  // waypoints / sniff bubbles stay always-visible.
  cullNearHorizon?: boolean;
  // Extra px above the anchor that the marker's artwork occupies (e.g. a tall
  // dog sprite + name tag sit ~130px above their ground point). The horizon
  // cull treats the marker as entering the sky band when its TOP does, not
  // just its anchor — so tall markers don't "fly" above the skyline.
  cullSkyMarginPx?: number;
  children: ReactNode;
}

// Below this pitch there's effectively no horizon in view, so nothing is
// culled (a flat map's "top of screen" is just north, not the sky).
const CULL_MIN_PITCH = 60;

// Renders `children` into a div managed by a maplibregl.Marker
// attached to the ambient map (from MapContext). Position + lifecycle
// is handled here; the JSX is whatever the parent passes.
export function MapLibreMarker({
  position,
  anchor,
  offset,
  zIndex,
  onClick,
  cullNearHorizon,
  cullSkyMarginPx = 0,
  children,
}: Props) {
  const map = useMaplibreMap();
  const markerRef = useRef<maplibregl.Marker | null>(null);

  // Lazy-create the DOM container once. Stable across renders so the
  // React portal stays mounted in the same node.
  const el = useMemo(() => {
    if (typeof document === 'undefined') return null;
    return document.createElement('div');
  }, []);

  // Attach the marker once map + el are available.
  useEffect(() => {
    if (!map || !el) return;
    const marker = new maplibregl.Marker({
      element: el,
      anchor: anchor ?? 'center',
      offset: offset ?? [0, 0],
    })
      .setLngLat([position.lng, position.lat])
      .addTo(map);
    markerRef.current = marker;
    return () => {
      marker.remove();
      markerRef.current = null;
    };
    // anchor/offset/position intentionally NOT in deps — see notes
    // below. Position has its own sync effect; anchor/offset are
    // set-once at construction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, el]);

  // Sync position changes onto the existing marker.
  useEffect(() => {
    markerRef.current?.setLngLat([position.lng, position.lat]);
  }, [position.lat, position.lng]);

  // Apply z-index / cursor styling on the wrapper element.
  useEffect(() => {
    if (!el) return;
    el.style.zIndex = zIndex != null ? String(zIndex) : '';
    el.style.cursor = onClick ? 'pointer' : '';
  }, [el, zIndex, onClick]);

  // Horizon cull. While pitched steeply, hide the marker if it projects
  // into the top sky band (or off the top entirely). The band grows with
  // pitch — the steeper the tilt, the more of the far field compresses up
  // top. rAF-coalesced so a continuous pan does at most one project()
  // per frame. Static markers (dogs/tokens/POIs) have a stable position,
  // so this re-subscribes only when the marker actually moves.
  useEffect(() => {
    if (!map || !el || !cullNearHorizon) return;
    let raf = 0;
    const apply = () => {
      raf = 0;
      const pitch = map.getPitch();
      if (pitch < CULL_MIN_PITCH) {
        el.style.visibility = '';
        return;
      }
      const h = map.getContainer().clientHeight || 1;
      // 60° → top 16%, ramping to ~32% by 80°.
      const frac = Math.min(0.32, 0.16 + (pitch - CULL_MIN_PITCH) * 0.008);
      const { y } = map.project([position.lng, position.lat]);
      // Cull when the marker's TOP (anchor minus its artwork height) enters
      // the sky band — so tall sprites hide before they float over the skyline.
      el.style.visibility = y - cullSkyMarginPx < h * frac ? 'hidden' : '';
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    apply();
    map.on('move', schedule);
    map.on('zoom', schedule);
    map.on('pitch', schedule);
    map.on('rotate', schedule);
    return () => {
      map.off('move', schedule);
      map.off('zoom', schedule);
      map.off('pitch', schedule);
      map.off('rotate', schedule);
      if (raf) cancelAnimationFrame(raf);
      el.style.visibility = '';
    };
  }, [map, el, cullNearHorizon, cullSkyMarginPx, position.lat, position.lng]);

  // Click handler wiring. Every tappable marker fires the
  // shared pop animation on tap — one change here gives
  // tap-feedback to EVERY marker (POIs, dog markers,
  // waypoints, food, tokens, clusters) without each component
  // having to wire it individually.
  //
  // Pop the FIRST CHILD of el (the React-rendered content),
  // not el itself: MapLibre writes `transform: translate(...)`
  // on el to position the marker, and our pop's `transform:
  // scale(...)` would override it — the marker would teleport
  // to the map's origin on every tap.
  useEffect(() => {
    if (!el || !onClick) return;
    const handler = () => {
      playPop(el.firstElementChild as HTMLElement | null);
      onClick();
    };
    el.addEventListener('click', handler);
    return () => el.removeEventListener('click', handler);
  }, [el, onClick]);

  if (!el) return null;
  return createPortal(children, el);
}
