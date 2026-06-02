import { createContext, useContext } from 'react';
import type maplibregl from 'maplibre-gl';

// Map instance provided by MapView so descendant markers / layers can
// reach the map without explicit prop drilling.
export const MapContext = createContext<maplibregl.Map | null>(null);

export function useMaplibreMap(): maplibregl.Map | null {
  return useContext(MapContext);
}
