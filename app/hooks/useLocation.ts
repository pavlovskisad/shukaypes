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
          // Only fall back if we don't already have a fix — a transient error
          // (e.g. a momentary timeout) shouldn't yank a working position.
          setState((s) =>
            s.position && !s.usingFallback
              ? s
              : {
                  position: KYIV_FALLBACK,
                  error: err.message,
                  granted: false,
                  usingFallback: true,
                },
          );
        },
        // `timeout` is essential: without it watchPosition can hang forever
        // (neither callback fires) while the browser waits on a slow/pending
        // permission — which left the app stuck on the "locating…" screen,
        // notably in Chrome.
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 2000 },
      );

      // Belt-and-braces: some browsers never fire EITHER callback when
      // geolocation stalls. If nothing has arrived after a few seconds, drop to
      // the Kyiv fallback so the app renders; a real fix still upgrades it later
      // (the watch keeps running).
      const fallbackTimer = setTimeout(() => {
        setState((s) =>
          s.position
            ? s
            : {
                position: KYIV_FALLBACK,
                error: 'location timed out',
                granted: false,
                usingFallback: true,
              },
        );
      }, 6000);

      return () => {
        navigator.geolocation.clearWatch(watchId);
        clearTimeout(fallbackTimer);
      };
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
