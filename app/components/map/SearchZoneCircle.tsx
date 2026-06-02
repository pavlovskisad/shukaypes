import { useEffect, useId, useMemo } from 'react';
import type maplibregl from 'maplibre-gl';
import type { LatLng, UrgencyLevel } from '@shukajpes/shared';
import { useMaplibreMap } from './MapContext';

const URGENCY_COLOR: Record<UrgencyLevel, string> = {
  urgent: '#e84040',
  medium: '#d9a030',
  resolved: '#aaa',
};

interface SearchZoneCircleProps {
  center: LatLng;
  radiusM: number;
  urgency: UrgencyLevel;
}

// MapLibre has no native "geographic circle" primitive. We approximate
// with a 64-segment polygon ring computed via the standard
// destination-point formula. The ring is added as a GeoJSON source +
// two layers (subtle fill + thin stroke) so the visual matches the
// prior Google CircleF: very low fill alpha, thin stroke in the
// urgency colour.
const SEGMENTS = 64;
const EARTH_R = 6371000;

function circlePolygon(center: LatLng, radiusM: number): GeoJSON.Feature {
  const ring: [number, number][] = [];
  const latR = (center.lat * Math.PI) / 180;
  const lngR = (center.lng * Math.PI) / 180;
  const dR = radiusM / EARTH_R;
  for (let i = 0; i <= SEGMENTS; i++) {
    const bearing = (i / SEGMENTS) * 2 * Math.PI;
    const newLatR = Math.asin(
      Math.sin(latR) * Math.cos(dR) +
        Math.cos(latR) * Math.sin(dR) * Math.cos(bearing),
    );
    const newLngR =
      lngR +
      Math.atan2(
        Math.sin(bearing) * Math.sin(dR) * Math.cos(latR),
        Math.cos(dR) - Math.sin(latR) * Math.sin(newLatR),
      );
    ring.push([(newLngR * 180) / Math.PI, (newLatR * 180) / Math.PI]);
  }
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: {},
  };
}

export function SearchZoneCircle({
  center,
  radiusM,
  urgency,
}: SearchZoneCircleProps) {
  const map = useMaplibreMap();
  const uid = useId();
  // Strip any colons React might inject so the id is a valid layer
  // name across MapLibre versions.
  const sourceId = useMemo(() => `szone-${uid.replace(/[:]/g, '')}`, [uid]);
  const fillId = `${sourceId}-fill`;
  const strokeId = `${sourceId}-stroke`;

  useEffect(() => {
    if (!map) return;
    const data = circlePolygon(center, radiusM) as unknown as GeoJSON.Feature;
    const color = URGENCY_COLOR[urgency];
    const addOrUpdate = () => {
      const existing = map.getSource(sourceId) as
        | maplibregl.GeoJSONSource
        | undefined;
      if (existing) {
        existing.setData(data);
        map.setPaintProperty(fillId, 'fill-color', color);
        map.setPaintProperty(strokeId, 'line-color', color);
        return;
      }
      map.addSource(sourceId, { type: 'geojson', data });
      map.addLayer({
        id: fillId,
        type: 'fill',
        source: sourceId,
        paint: { 'fill-color': color, 'fill-opacity': 0.04 },
      });
      map.addLayer({
        id: strokeId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': color,
          'line-opacity': 0.35,
          'line-width': 1,
        },
      });
    };
    // Style may not be loaded yet when we mount; queue if so.
    if (map.isStyleLoaded()) {
      addOrUpdate();
    } else {
      const onLoad = () => addOrUpdate();
      map.once('style.load', onLoad);
    }
    return () => {
      if (map.getLayer(strokeId)) map.removeLayer(strokeId);
      if (map.getLayer(fillId)) map.removeLayer(fillId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    };
  }, [map, center.lat, center.lng, radiusM, urgency, sourceId, fillId, strokeId]);

  return null;
}
