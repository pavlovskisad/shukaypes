import { useEffect, useState } from 'react';
import { useMaplibreMap } from './MapContext';
import { LIGHT_PALETTE, DARK_PALETTE } from './crayonStyle';

// A pitch-driven atmospheric haze laid over the TOP of the map. MapLibre's
// sky fog only hazes the sky band, not the 3D geometry, so at a steep tilt
// the distant city would otherwise read flat and hard against the page.
// This DOM overlay adds a SEE-THROUGH haze — densest near the horizon,
// fading gradually to clear over the foreground — so the far city stays
// visible but recedes into atmosphere (depth), rather than being covered
// by an opaque band. Low baked-in alphas keep it translucent; the element
// opacity eases in with pitch so a flat map is untouched. Own opacity
// state so pitch updates re-render only this div, not the marker-heavy
// MapView.

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function gradientFor(sniffMode: boolean): string {
  const sky = (sniffMode ? DARK_PALETTE : LIGHT_PALETTE).sky;
  // Translucent throughout (low alphas) so the far city shows through —
  // densest at the horizon, easing off through many soft stops so there's
  // no hard "band edge". Reads as depth haze rather than a flat cover.
  // Denser, near-opaque bright haze across the upper band (masks the
  // ground→sky seam wherever it falls at steep pitch), then fading
  // gradually to clear over the foreground. Near-white so even the dense
  // top reads as airy bright sky rather than a heavy cover.
  return [
    'linear-gradient(to bottom',
    `${hexToRgba(sky.skyColor, 0.66)} 0%`,
    `${hexToRgba(sky.horizonColor, 0.66)} 18%`,
    `${hexToRgba(sky.fogColor, 0.5)} 36%`,
    `${hexToRgba(sky.fogColor, 0.28)} 56%`,
    `${hexToRgba(sky.fogColor, 0.1)} 76%`,
    `${hexToRgba(sky.fogColor, 0)} 100%)`,
  ].join(', ');
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
      // Eases in from ~54° and reaches near-full by the steep range so the
      // bright haze reliably masks the ground→sky seam. Capped at 0.92 so
      // a hint of the far city still shows through the brightest top.
      setOpacity(Math.max(0, Math.min(0.92, (p - 54) / 22)));
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
        height: '58%',
        pointerEvents: 'none',
        opacity,
        transition: 'opacity 220ms linear',
        background: gradientFor(sniffMode),
      }}
    />
  );
}
