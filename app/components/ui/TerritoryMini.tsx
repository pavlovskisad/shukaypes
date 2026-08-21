// A territory, small enough to sit next to a name.
//
// The board draws each owner's LARGEST piece in their colour — the same
// shape their claim has on the map, so a player who has walked past "the
// red blob by the fountain" recognises it in the standings. It is
// identity, not measurement: the miniature is normalised to fit its box,
// so a huge claim and a modest one draw at the same size and the area
// counter next to it stays the honest number.
//
// Raw DOM <svg>, the ProfileSceneBackdrop pattern — react-native-web
// passes it straight through, and the quests tab is already web-committed
// (it injects keyframes into document.head). No native path exists yet;
// the native map itself is a stub.
//
// A CLAIMED FIELD: PALE INSIDE, DASHED AT THE EDGE.
//
// Three constructions came before this one and all three were trying to
// reproduce the MAP's finish — a soft heat field, blurred at the border
// and hot in the core. The last of them got close (contour bands eroded
// inward, hard steps, density building toward the middle) and it is gone
// anyway, because reproducing the map's finish was never the job. What a
// row needs is a SHAPE you can recognise, and a blob with a soft edge is
// the one thing a shape cannot survive at 92px: the outline is where the
// identity lives, and every version so far spent its best pixels
// dissolving exactly that.
//
// So the outline is now the loudest thing in the chip — a dashed stroke
// at full strength — and the fill drops to a wash behind it. Dashed
// rather than solid because a claim is a boundary somebody walked, not a
// fence: the same reason a surveyor's plot and a national border are
// drawn broken on every map that isn't trying to say "wall".
//
// KNOWN AND ACCEPTED: the chip no longer matches the map's finish. The
// map paints territory as a soft field with deliberately no borders (see
// TerritoryLayer's header, which argues that case at length and is still
// right — at city scale, over three hundred pixels of ground, an outline
// reads as a diagram). The SHAPE is what carries between the two, and
// that is unchanged: same hull, same proportions, north up.

import { useMemo } from 'react';
import { lineColorCss } from '../map/territoryColor';

// Big enough that a 48-corner hull keeps its corners, small enough to
// stay cheap on a sheet holding a hundred of these. Rendered size is
// per-use.
const BOX = 64;
// Breathing room inside the box — the stroke is centred on the outline,
// so half of STROKE_W hangs outside the polygon and has to fit.
const PAD = 5;

// In viewBox units. At the board's 92px the box scales by ~1.44, so
// these land at ~2.9px of ink and a ~7px dash — chunky enough to read as
// a drawn boundary rather than a hairline, at the size it is actually
// seen.
const STROKE_W = 2;
const DASH = '5 3.5';
// The wash behind the line. Low, because the line is doing the work: at
// anything denser the chip goes back to being a coloured blob with a
// decoration around it.
const FILL_ALPHA = 0.22;

export function TerritoryMini({
  points,
  color,
  size,
}: {
  points: { lat: number; lng: number }[] | undefined;
  color: string;
  size: number;
}) {
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

  // One shape, one wash, one dashed edge — the same paint whether we have
  // a real hull or the placeholder. No piece to draw (an older server, or
  // ground lost mid-read) falls back to a circle: a claim we cannot draw,
  // drawn as the most neutral shape there is, rather than a gap in the
  // column where every other row has something.
  // The wash is the owner's colour as the map paints it; the line is the
  // same colour taken down far enough to BE a line on a white card — see
  // lineColorCss, which measures the case the palette was never scored
  // for. Your own blue passes through unchanged.
  const paint = {
    fill: color,
    fillOpacity: FILL_ALPHA,
    stroke: lineColorCss(color),
    strokeWidth: STROKE_W,
    strokeDasharray: DASH,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
  };

  return (
    <svg viewBox={`0 0 ${BOX} ${BOX}`} width={size} height={size} aria-hidden>
      {pts ? (
        <polygon points={pts} {...paint} />
      ) : (
        <circle cx={BOX / 2} cy={BOX / 2} r={BOX / 2 - PAD} {...paint} />
      )}
    </svg>
  );
}
