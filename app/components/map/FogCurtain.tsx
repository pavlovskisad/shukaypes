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
  // Gentle, see-through haze — densest near the horizon but light enough
  // that the rendered far city stays visible THROUGH it (rather than being
  // covered), fading to clear over the foreground. A flat screen-space
  // curtain can't tell "far city" from "bare horizon seam", so we keep it
  // translucent: the city stays, the seam is softened (not fully masked).
  return [
    'linear-gradient(to bottom',
    `${hexToRgba(sky.skyColor, 0.5)} 0%`,
    `${hexToRgba(sky.horizonColor, 0.44)} 18%`,
    `${hexToRgba(sky.fogColor, 0.32)} 36%`,
    `${hexToRgba(sky.fogColor, 0.18)} 56%`,
    `${hexToRgba(sky.fogColor, 0.06)} 76%`,
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
      // Gentle, fairly pitch-CONSISTENT ramp (low cap, shallow slope) so
      // the haze doesn't thicken much as you tilt — the far city stays
      // about as visible at steep pitch as at mild pitch, instead of being
      // swallowed by a denser curtain when you look further.
      setOpacity(Math.max(0, Math.min(0.6, (p - 52) / 40)));
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
