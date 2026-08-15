// A territory, small enough to sit next to a name.
//
// The board draws each owner's LARGEST piece as a silhouette in their
// colour — the same shape their claim has on the map, so a player who has
// walked past "the red blob by the fountain" recognises it in the
// standings. It is identity, not measurement: the miniature is normalised
// to fit its box, so a huge claim and a modest one draw at the same size
// and the area counter next to it stays the honest number.
//
// Raw DOM <svg>, the ProfileSceneBackdrop pattern — react-native-web
// passes it straight through, and the quests tab is already web-committed
// (it injects keyframes into document.head). No native path exists yet;
// the native map itself is a stub.
//
// The finish copies the map, and the OPACITY is the load-bearing part:
// nobody ever sees an owner's hue raw on the map — the field composites
// at 42% over pale paper, and the whole palette was contrast-tuned in
// that composited form (see territoryColor.ts). The first cut of this
// chip filled at 0.9 and every silhouette came out lurid, a different
// palette from the city it was summarising. So the body sits at the
// map's own fill alpha and the paper does the pastelising, with a faint
// blurred halo underneath — the field's fringe, not a glow effect —
// and only a whisper of blur on the body so the edge stays clean.

import { useId, useMemo } from 'react';

// Big enough that the blur survives rasterisation, small enough that
// 48-corner polygons stay cheap. The rendered size is set per-use.
const BOX = 64;
const PAD = 7; // room inside the box for the halo to breathe

// The map's numbers: fill-opacity 0.42 on the ground field, halo at a
// fraction of it. Change these only alongside the map's.
const BODY_ALPHA = 0.45;
const HALO_ALPHA = 0.16;

export function TerritoryMini({
  points,
  color,
  size,
}: {
  points: { lat: number; lng: number }[] | undefined;
  color: string;
  size: number;
}) {
  // One filter id per mounted instance — ids are document-global in SVG,
  // and ten boards rows all pointing at the first row's filter is the
  // kind of bug that only shows once a row unmounts.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const pts = useMemo(() => {
    if (!points || points.length < 3) return null;
    // Locally flat projection: metres east vs metres north (scaled by
    // cos(lat) so a shape drawn here has the same proportions it has on
    // the map), then fit into the box preserving aspect, centred, with
    // north up.
    const midLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
    const kx = Math.cos((midLat * Math.PI) / 180);
    const xs = points.map((p) => p.lng * kx);
    const ys = points.map((p) => -p.lat);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const span = Math.max(maxX - minX, maxY - minY) || 1;
    const scale = (BOX - PAD * 2) / span;
    const offX = (BOX - (maxX - minX) * scale) / 2;
    const offY = (BOX - (maxY - minY) * scale) / 2;
    return points
      .map(
        (_, i) =>
          `${((xs[i]! - minX) * scale + offX).toFixed(1)},${((ys[i]! - minY) * scale + offY).toFixed(1)}`,
      )
      .join(' ');
  }, [points]);

  // No shape (older server, or ground lost mid-read): a soft dot in the
  // owner's colour keeps the column aligned and the colour legible.
  if (!pts) {
    return (
      <svg viewBox={`0 0 ${BOX} ${BOX}`} width={size} height={size} aria-hidden>
        <circle
          cx={BOX / 2}
          cy={BOX / 2}
          r={BOX / 3.2}
          fill={color}
          opacity={HALO_ALPHA}
        />
        <circle cx={BOX / 2} cy={BOX / 2} r={BOX / 4} fill={color} opacity={BODY_ALPHA} />
      </svg>
    );
  }

  return (
    <svg viewBox={`0 0 ${BOX} ${BOX}`} width={size} height={size} aria-hidden>
      <defs>
        <filter id={`tm-halo-${uid}`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
        <filter id={`tm-body-${uid}`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="0.4" />
        </filter>
      </defs>
      <polygon points={pts} fill={color} opacity={HALO_ALPHA} filter={`url(#tm-halo-${uid})`} />
      <polygon points={pts} fill={color} opacity={BODY_ALPHA} filter={`url(#tm-body-${uid})`} />
    </svg>
  );
}
