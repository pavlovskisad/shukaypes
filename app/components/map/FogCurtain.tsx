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
  // Deep, smooth, many-stop haze: a near-opaque toned band right at the
  // horizon strip (where the bare tile-limit ground sits at steep pitch),
  // easing down through a long graduated tail so the rendered city beneath
  // recedes into it (depth) rather than meeting a flat band edge. Top few %
  // stay sky-coloured to blend with MapLibre's sky dome.
  return [
    'linear-gradient(to bottom',
    `${hexToRgba(sky.skyColor, 0.45)} 0%`,
    `${hexToRgba(sky.horizonColor, 0.74)} 8%`,
    `${hexToRgba(sky.fogColor, 0.82)} 15%`, // dense horizon / tile-limit band
    `${hexToRgba(sky.fogColor, 0.6)} 22%`,
    `${hexToRgba(sky.fogColor, 0.42)} 30%`,
    `${hexToRgba(sky.fogColor, 0.28)} 40%`, // graduated tail over the city = depth
    `${hexToRgba(sky.fogColor, 0.17)} 52%`,
    `${hexToRgba(sky.fogColor, 0.09)} 66%`,
    `${hexToRgba(sky.fogColor, 0.03)} 84%`,
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
      const z = map.getZoom();
      // Pitch drives the base (engages as you tilt into the flood zone).
      const pitchBase = Math.max(0, (p - 56) / 26);
      // Zoom boost: zooming OUT is exactly when the far city stops being
      // rendered and bare land shows at the horizon, so thicken the fog to
      // swallow it. None at street level (>=16.5), ramping up as you pull
      // back. Zoomed IN the city stays clear.
      const zoomBoost = Math.max(0, Math.min(0.35, (16.5 - z) * 0.13));
      setOpacity(Math.max(0, Math.min(0.95, pitchBase + zoomBoost)));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    apply();
    map.on('pitch', schedule);
    map.on('zoom', schedule);
    return () => {
      map.off('pitch', schedule);
      map.off('zoom', schedule);
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
