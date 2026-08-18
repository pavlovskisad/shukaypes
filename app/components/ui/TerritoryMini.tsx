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
// A HEAT BLOB WITH HARD EDGES — CONTOURS, NOT BLUR.
//
// This is the third construction, and the first two are why it looks
// like this. Both built the chip the way the MAP builds its field: blur
// the shape into a coverage field, then threshold that field into
// bands. On the map that is right — a claim is hundreds of pixels wide,
// so the blurred ramp lands entirely in the border and the interior is
// a solid, evenly-held body. Shrink the same construction to 92px and
// both halves fail: the ramp is a quarter of the whole chip (fog), and
// tightening it until the edge is crisp leaves the interior a single
// flat step — a sticker in the owner's colour, with none of the heat.
//
// So the bands are drawn as CONTOURS instead. Each is the silhouette
// eroded a little further inward (feMorphology, a true offset — not a
// blur, which would round the shape away), filled at the same modest
// alpha, and stacked: where four bands overlap the colour has built up
// four times, so density rises toward the middle exactly as a heat
// field does, while every band boundary stays a hard step. Crisp, and
// hot in the core.
//
// What carries over from the map unchanged: the owner's hue and the
// fill alpha its palette was contrast-tuned at. Two of the map's stages
// are deliberately absent, both for the same reason — they need room a
// 92px chip hasn't got:
//
//   PUFF RELIEF. feDiffuseLighting reproduces it exactly, but at this
//   size it only ever lands on the outermost band, darkening it to a
//   grey ring that reads as a blurry drop shadow around the chip.
//
//   THE EDGE MEANDER. Turbulence bends the map's borders so they don't
//   look machined; here it fed the erosions a fuzzy edge and the bands
//   came back melted together. A claim's outline is the hull of a walk
//   — it already meanders without help.

import React, { useId, useMemo } from 'react';

// Big enough that the erosion steps survive rasterisation, small enough
// that 48-corner polygons stay cheap. Rendered size is per-use.
const BOX = 64;
// Breathing room inside the box. The field no longer spreads past the
// polygon — the outermost contour IS the polygon — so this is much
// tighter than the blurred versions needed, and the silhouette is
// correspondingly bigger in its box.
const PAD = 6;

// ── Contours ────────────────────────────────────────────────────────
// Erosion depth per band, in viewBox units, outermost first. The first
// is zero: band one is the claim's true outline, so the shape a player
// recognises from the map is drawn exactly, and every hotter band sits
// inside it. Depths are uneven on purpose — tight near the edge where
// the eye reads contour spacing as steepness, wider toward the middle
// so the core reads as a plateau rather than a bullseye.
const CONTOURS = [0, 2.4, 5.2, 8.6];
// Alpha PER BAND, not cumulative. Four of these stack to ~0.55 in the
// core; the map's field peaks at 0.42 over pale paper, and the chip
// sits on a white card, so a slightly higher peak lands at the same
// density. The outermost band alone is the palest — the claim's cool
// fringe.
const BAND_ALPHA = 0.18;
// Just enough blur to put back the antialiasing erosion throws away.
// Any more and the steps start to smear into each other, which is the
// fog this construction exists to replace.
const EDGE_SOFTEN = 0.3;

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
  // and ten board rows all pointing at the first row's filter is the
  // kind of bug that only shows once a row unmounts.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const fid = `tm-field-${uid}`;
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

  return (
    <svg
      viewBox={`0 0 ${BOX} ${BOX}`}
      width={size}
      height={size}
      aria-hidden
      style={{ overflow: 'visible' }}
    >
      <defs>
        <filter
          id={fid}
          x="-15%"
          y="-15%"
          width="130%"
          height="130%"
          // sRGB, not the filter default of linearRGB: the map composites
          // in sRGB, and in linear the same alphas come out visibly paler.
          colorInterpolationFilters="sRGB"
        >
          {/* No blur and no meander before the contours, and both were
              tried. Softening the silhouette first, or bending it with
              turbulence, feeds every erosion below a fuzzy edge — the
              bands come back melted into one another, which is the
              gradient this construction exists to replace. A real
              claim's outline already meanders (it is the hull of a walk);
              it does not need noise to look organic. */}
          <feFlood floodColor={color} result="hue" />

          {CONTOURS.map((depth, i) => (
            <React.Fragment key={i}>
              {/* Erode inward — a true offset of the outline, so a
                  claim's fingers and inlets survive as contour detail
                  instead of being rounded away. Depth 0 passes the
                  silhouette through untouched. */}
              {depth > 0 ? (
                <feMorphology
                  in="SourceAlpha"
                  operator="erode"
                  radius={depth}
                  result={`e${i}`}
                />
              ) : null}
              <feComponentTransfer in={depth > 0 ? `e${i}` : 'SourceAlpha'} result={`m${i}`}>
                <feFuncA type="linear" slope={BAND_ALPHA} intercept={0} />
              </feComponentTransfer>
              <feComposite in="hue" in2={`m${i}`} operator="in" result={`band${i}`} />
            </React.Fragment>
          ))}

          {/* Stacked, so the colour builds up where the bands overlap —
              which is what makes the core hot without any band being
              painted darker than the rest. */}
          <feMerge result="bands">
            {CONTOURS.map((_, i) => (
              <feMergeNode key={i} in={`band${i}`} />
            ))}
          </feMerge>
          {/* ONE softening pass over the finished stack rather than one
              per band: erosion returns a hard aliased edge (it takes the
              minimum over its kernel, which throws the antialiasing
              away), and this puts just enough back. Doing it once is
              four primitives cheaper on a sheet that can hold a hundred
              of these. */}
          <feGaussianBlur in="bands" stdDeviation={EDGE_SOFTEN} />
        </filter>
      </defs>
      {/* The source is a bare silhouette — every band above is the
          filter's doing. No shape (older server, or ground lost
          mid-read) falls back to a disc, which the same contours turn
          into the same kind of blob. */}
      {pts ? (
        <polygon points={pts} fill="#000" filter={`url(#${fid})`} />
      ) : (
        <circle cx={BOX / 2} cy={BOX / 2} r={BOX / 4} fill="#000" filter={`url(#${fid})`} />
      )}
    </svg>
  );
}
