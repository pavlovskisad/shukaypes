import { useEffect, useState } from 'react';
import { useMaplibreMap } from './MapContext';
import { LIGHT_PALETTE, DARK_PALETTE } from './crayonStyle';

// A pitch-driven "fog curtain" laid over the TOP of the map. MapLibre's
// sky fog only hazes the sky band — it doesn't fog the 3D geometry — so at
// a steep tilt the distant city rises above the horizon haze and floods
// the top of the screen. This DOM overlay paints a sky→haze→clear
// gradient over that region, hiding the far city behind atmosphere while
// the near city stays crisp below. Its opacity fades in with pitch, so a
// flat map is untouched and the effect only engages as the camera tilts
// into the flood zone. Own opacity state so pitch updates re-render only
// this div, not the whole (marker-heavy) MapView.

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function gradientFor(sniffMode: boolean): string {
  const sky = (sniffMode ? DARK_PALETTE : LIGHT_PALETTE).sky;
  // Sky colour at the very top (blends with MapLibre's own sky dome),
  // through the horizon haze, to the fog colour, fading fully out lower
  // down so the foreground city reads clean.
  return `linear-gradient(to bottom, ${sky.skyColor} 0%, ${sky.horizonColor} 28%, ${sky.fogColor} 52%, ${hexToRgba(sky.fogColor, 0)} 100%)`;
}

export function FogCurtain({ sniffMode }: { sniffMode: boolean }) {
  const map = useMaplibreMap();
  const [opacity, setOpacity] = useState(0);

  useEffect(() => {
    if (!map) return;
    let raf = 0;
    const apply = () => {
      raf = 0;
      const p = map.getPitch();
      // None below 60°, full by 80° — engages as the distance floods.
      setOpacity(Math.max(0, Math.min(1, (p - 60) / 20)));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    apply();
    map.on('pitch', schedule);
    return () => {
      map.off('pitch', schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [map]);

  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '52%',
        pointerEvents: 'none',
        opacity,
        transition: 'opacity 220ms linear',
        background: gradientFor(sniffMode),
      }}
    />
  );
}
