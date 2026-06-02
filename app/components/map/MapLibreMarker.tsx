import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import maplibregl from 'maplibre-gl';
import type { LatLng } from '@shukajpes/shared';
import { useMaplibreMap } from './MapContext';

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
  children: ReactNode;
}

// Renders `children` into a div managed by a maplibregl.Marker
// attached to the ambient map (from MapContext). Position + lifecycle
// is handled here; the JSX is whatever the parent passes.
export function MapLibreMarker({
  position,
  anchor,
  offset,
  zIndex,
  onClick,
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

  // Click handler wiring.
  useEffect(() => {
    if (!el || !onClick) return;
    const handler = () => onClick();
    el.addEventListener('click', handler);
    return () => el.removeEventListener('click', handler);
  }, [el, onClick]);

  if (!el) return null;
  return createPortal(children, el);
}
