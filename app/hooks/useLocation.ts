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
// It WANDERS inside a radius of the anchor rather than walking a line or
// a ring. A straight-line walker leaves the camera behind within a couple
// of minutes and you end up staring at empty map; a perfect circle keeps
// it in frame but retraces one rut, which is the wrong shape for testing
// territory — every lap re-marks the same ground and you never see a
// claim spread the way a real walk spreads it.
//
// So: a heading that drifts, the occasional sharper turn at a "corner",
// and a steer back toward the anchor once it strays past the radius. The
// track that produces looks like somebody walking a neighbourhood, and
// it covers new ground on every pass while staying on screen.
//
// The radius is a leash, not a path — a walker inside it still travels
// well past the server's 140 m minimum mark spacing between claims. Very
// slow speeds (< ~1 m/s) shrink the distance covered between marks enough
// to starve marking; bump `?simSpeed=` if you want a crawl.
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
      // Heading (radians, 0 = north) plus a slow drift, so the track
      // curves the way a person following streets curves rather than
      // holding a bearing or tracing a circle.
      let heading = Math.random() * Math.PI * 2;
      let pos = { ...sim.start };
      const emit = () => {
        setState({ position: { ...pos }, error: null, granted: true, usingFallback: false });
      };
      emit();
      const id = setInterval(() => {
        const stepM = sim.speedMps * (SIM_TICK_MS / 1000);

        // Gentle wander, plus an occasional corner — a real walk is mostly
        // straight lines with the odd decision at a junction.
        heading += (Math.random() - 0.5) * 0.5;
        if (Math.random() < 0.06) heading += (Math.random() - 0.5) * 2.2;

        // The leash: once past the radius, bend back toward the anchor
        // instead of teleporting or bouncing. Strength grows with how far
        // out we are, so the walker curves home rather than snapping.
        const mPerLat = 110540;
        const mPerLng = 111320 * Math.cos((sim.start.lat * Math.PI) / 180);
        const dN = (pos.lat - sim.start.lat) * mPerLat;
        const dE = (pos.lng - sim.start.lng) * mPerLng;
        const out = Math.hypot(dN, dE);
        if (out > sim.radiusM) {
          const home = Math.atan2(-dE, -dN);
          // Shortest angular difference, so it never turns the long way.
          let diff = ((home - heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
          const pull = Math.min(1, (out - sim.radiusM) / sim.radiusM + 0.35);
          heading += diff * pull;
        }

        pos = {
          lat: pos.lat + (stepM * Math.cos(heading)) / mPerLat,
          lng: pos.lng + (stepM * Math.sin(heading)) / mPerLng,
        };
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
