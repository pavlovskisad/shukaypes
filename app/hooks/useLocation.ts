import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import type { LatLng } from '@shukajpes/shared';

const KYIV_FALLBACK: LatLng = { lat: 50.4501, lng: 30.5234 };

// Walk simulator — `?sim=1` on the URL replaces GPS with a synthetic
// walker that wanders the city from the Kyiv anchor (or `?simLat=&simLng=`).
// Everything downstream (path sweep, auto-collect, territory marking) reads
// the same position, so a simulated walk exercises the real server code —
// no faked responses, no test-only branches past this hook.
//
// Speed defaults to a brisk walk; `?simSpeed=<m/s>` covers ground faster
// when you want to see a long ribbon of territory without waiting.
// Deliberately dev-only ergonomics: no UI, no persistence, gone the moment
// you drop the query param.
const SIM_TICK_MS = 1000;

interface SimConfig {
  start: LatLng;
  speedMps: number;
}

function readSimConfig(): SimConfig | null {
  if (typeof window === 'undefined') return null;
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get('sim') !== '1') return null;
    const lat = Number(q.get('simLat'));
    const lng = Number(q.get('simLng'));
    const speed = Number(q.get('simSpeed'));
    return {
      start:
        Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : KYIV_FALLBACK,
      speedMps: Number.isFinite(speed) && speed > 0 ? Math.min(speed, 30) : 1.6,
    };
  } catch {
    return null;
  }
}

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
    // Simulated walk takes precedence over real GPS — the point is to test
    // movement-driven mechanics while sitting still.
    const sim = readSimConfig();
    if (sim) {
      let pos = { ...sim.start };
      // Heading drifts a little each tick so the walker wanders through
      // streets instead of marching in a dead-straight line off the map.
      let heading = Math.random() * Math.PI * 2;
      setState({ position: pos, error: null, granted: true, usingFallback: false });
      const id = setInterval(() => {
        heading += (Math.random() - 0.5) * 0.6;
        const step = sim.speedMps * (SIM_TICK_MS / 1000);
        pos = {
          lat: pos.lat + (step * Math.cos(heading)) / 110540,
          lng:
            pos.lng +
            (step * Math.sin(heading)) /
              (111320 * Math.cos((pos.lat * Math.PI) / 180)),
        };
        setState({ position: pos, error: null, granted: true, usingFallback: false });
      }, SIM_TICK_MS);
      return () => clearInterval(id);
    }

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
