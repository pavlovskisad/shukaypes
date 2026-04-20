import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import type { LatLng } from '@shukajpes/shared';

const KYIV_FALLBACK: LatLng = { lat: 50.4501, lng: 30.5234 };

export interface LocationState {
  position: LatLng | null;
  error: string | null;
  granted: boolean;
  usingFallback: boolean;
}

export function useLocation(): LocationState {
  const [state, setState] = useState<LocationState>({
    position: null,
    error: null,
    granted: false,
    usingFallback: false,
  });

  useEffect(() => {
    if (Platform.OS === 'web') {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        setState({
          position: KYIV_FALLBACK,
          error: 'geolocation unavailable',
          granted: false,
          usingFallback: true,
        });
        return;
      }

      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          setState({
            position: { lat: pos.coords.latitude, lng: pos.coords.longitude },
            error: null,
            granted: true,
            usingFallback: false,
          });
        },
        (err) => {
          setState({
            position: KYIV_FALLBACK,
            error: err.message,
            granted: false,
            usingFallback: true,
          });
        },
        { enableHighAccuracy: true, maximumAge: 2000 }
      );

      return () => navigator.geolocation.clearWatch(watchId);
    }

    // Native: wired in Phase 2.5 via expo-location.
    setState({
      position: KYIV_FALLBACK,
      error: null,
      granted: false,
      usingFallback: true,
    });
    return;
  }, []);

  return state;
}
