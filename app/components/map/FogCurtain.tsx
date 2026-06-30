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
  // Concentrate a DENSE band right at the horizon strip — that's where the
  // tile-limit zone (far ground with no building data) sits at steep pitch,
  // so the bare seam gets masked there — then drop to a LIGHT haze below it
  // so the rendered city just beneath stays visible through gentle fog. Top
  // few % stay sky-coloured to blend with MapLibre's sky dome above the
  // horizon.
  return [
    'linear-gradient(to bottom',
    `${hexToRgba(sky.skyColor, 0.45)} 0%`,
    `${hexToRgba(sky.horizonColor, 0.72)} 9%`,
    `${hexToRgba(sky.fogColor, 0.78)} 17%`, // dense horizon / tile-limit band
    `${hexToRgba(sky.fogColor, 0.42)} 27%`,
    `${hexToRgba(sky.fogColor, 0.22)} 42%`, // light haze over the rendered city
    `${hexToRgba(sky.fogColor, 0.1)} 64%`,
    `${hexToRgba(sky.fogColor, 0.03)} 85%`,
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
      // Ramps up with pitch so the dense horizon band only engages as you
      // tilt into the flood zone. The light lower body keeps the city
      // visible regardless; the dense top band intensifies to mask the
      // bare tile-limit seam at steep pitch.
      setOpacity(Math.max(0, Math.min(0.9, (p - 56) / 22)));
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
