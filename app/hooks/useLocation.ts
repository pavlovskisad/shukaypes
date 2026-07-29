import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import type { LatLng } from '@shukajpes/shared';

const KYIV_FALLBACK: LatLng = { lat: 50.4501, lng: 30.5234 };

// Walk simulator — `?sim=1` on the URL replaces GPS with a synthetic
// walker, so movement-driven mechanics (path sweep, auto-collect,
// territory marking) can be exercised from a desk. Everything downstream
// reads the same position, so a simulated walk hits the real server code —
// no faked responses, no test-only branches past this hook.
//
// It walks a LOOP around the anchor rather than wandering off in a line.
// The map doesn't chase the user (you pan it yourself, or tap the dog's
// bookmark to recentre), so a straight-line walker leaves the camera
// behind within a couple of minutes and you end up staring at empty map
// with the dog off-screen. A loop keeps the walker in frame indefinitely
// while still covering real ground between marks.
//
// Radius is chosen so successive marks clear the server's minimum
// spacing: at 150 m and a brisk pace the walker travels ~300 m of chord
// between marks, comfortably past the 140 m rule. Very slow speeds
// (< ~1 m/s) shrink that chord enough to starve marking — bump
// `?simSpeed=` if you want a crawl.
//
// Params: `?sim=1&simSpeed=<m/s>&simRadius=<m>&simLat=&simLng=`.
// Dev-only ergonomics: no UI, no persistence, gone with the query param.
const SIM_TICK_MS = 1000;

interface SimConfig {
  start: LatLng;
  speedMps: number;
  radiusM: number;
}

function readSimConfig(): SimConfig | null {
  if (typeof window === 'undefined') return null;
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get('sim') !== '1') return null;
    const lat = Number(q.get('simLat'));
    const lng = Number(q.get('simLng'));
    const speed = Number(q.get('simSpeed'));
    const radius = Number(q.get('simRadius'));
    return {
      start:
        Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : KYIV_FALLBACK,
      speedMps: Number.isFinite(speed) && speed > 0 ? Math.min(speed, 30) : 2.5,
      radiusM:
        Number.isFinite(radius) && radius > 20 ? Math.min(radius, 2000) : 120,
    };
  } catch {
    return null;
  }
}

// Is a simulated walk running? Read by MapView, which keeps the camera on
// the dog while simulating — the loop is necessarily wider than a phone
// screen at street zoom (a smaller one would put marks closer together
// than the server's spacing rule allows), so without this the walker
// spends half of every lap out of frame.
export function isSimulatedWalk(): boolean {
  return readSimConfig() != null;
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
      // Angle around the anchor. The radius breathes a little so repeated
      // laps trace slightly different streets instead of retracing one
      // rut — which matters for territory, where re-marking the exact
      // same cells is a different case from claiming fresh ones.
      let angle = Math.random() * Math.PI * 2;
      let laps = 0;
      const emit = () => {
        const wobble = 1 + 0.25 * Math.sin(laps * 2.3);
        const r = sim.radiusM * wobble;
        const pos = {
          lat: sim.start.lat + (r * Math.cos(angle)) / 110540,
          lng:
            sim.start.lng +
            (r * Math.sin(angle)) /
              (111320 * Math.cos((sim.start.lat * Math.PI) / 180)),
        };
        setState({ position: pos, error: null, granted: true, usingFallback: false });
      };
      emit();
      const id = setInterval(() => {
        // Arc length = speed × dt, so the angular step scales with radius:
        // a bigger loop takes proportionally longer to walk, exactly like
        // real ground would.
        const step = sim.speedMps * (SIM_TICK_MS / 1000);
        angle += step / sim.radiusM;
        laps = angle / (Math.PI * 2);
        emit();
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
