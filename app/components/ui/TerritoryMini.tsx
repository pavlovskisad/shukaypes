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
// THE FINISH IS THE MAP'S, STEP FOR STEP.
//
// Not "in the same spirit" — the same pipeline, ported primitive for
// primitive from territoryHeatLayer's composite shader, with the band
// thresholds READ OUT of that shader below so the two cannot drift:
//
//   shader                        →  filter primitive
//   ─────────────────────────────────────────────────────────────
//   gaussian blur of coverage     →  feGaussianBlur on SourceAlpha
//   fbm edge meander              →  feTurbulence + feDisplacementMap
//   halo/body smoothstep bands    →  feFuncA table (sampled from the
//                                    identical smoothstep maths)
//   owner colour                  →  feFlood + feComposite in
//   puff relief from the gradient →  feDiffuseLighting (its normals ARE
//                                    the coverage gradient the shader
//                                    probes for by hand)
//   bright rim at each band       →  second feFuncA table, white flood
//
// One deliberate difference, and it is a background difference rather
// than a rendering one: on the map the field MULTIPLIES the paper, here
// it composites over the card. Over white those are the same operation,
// so the hue is identical and the chip reads a shade lighter than the
// same claim does over map paper. The core saturation lift and the
// large-scale density grain are dropped — both work at scales (a whole
// claim, ~260px of city) that a 92px chip has no room to show.

import { useId, useMemo } from 'react';

// Big enough that the blur and the bands survive rasterisation, small
// enough that 48-corner polygons stay cheap. Rendered size is per-use.
const BOX = 64;
// Room inside the box for the halo band and the meander to breathe —
// the field spreads visibly past the polygon it grew from.
const PAD = 8;

// ── The shader's own numbers ────────────────────────────────────────
// Kept as literal copies of territoryHeatLayer's composite stage. If
// those move, move these: the whole point of this file is that a chip
// and the ground it stands for are the same picture.
const FILL_ALPHA = 0.42;
const HALO_LO = 0.28;
const HALO_HI = 0.4;
const BODY_LO = 0.55;
const BODY_HI = 0.74;
const HALO_WEIGHT = 0.38;
const BODY_WEIGHT = 0.62;

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// TWO soft steps, not one — a pale halo, then the dense body. The gap
// between fringe and body is the contrast that sells the field.
const shapedAt = (c: number): number =>
  HALO_WEIGHT * smoothstep(HALO_LO, HALO_HI, c) +
  BODY_WEIGHT * smoothstep(BODY_LO, BODY_HI, c);

// Bright rims where each band is born — the hot outline of a heat blob.
const rimAt = (c: number): number =>
  smoothstep(0.28, 0.36, c) * (1 - smoothstep(0.38, 0.5, c)) * 0.34 +
  smoothstep(0.55, 0.63, c) * (1 - smoothstep(0.65, 0.78, c)) * 0.22;

// feFuncA maps input alpha through a piecewise-linear table, so sampling
// the shader's curves finely enough IS the shader's curve.
const SAMPLES = 33;
const tableOf = (f: (c: number) => number): string =>
  Array.from({ length: SAMPLES }, (_, i) => f(i / (SAMPLES - 1)).toFixed(4)).join(' ');

const SHAPED_TABLE = tableOf((c) => shapedAt(c) * FILL_ALPHA);
// Gated by the body's own alpha so the rim can never paint where there
// is no field — the shader's `min(1.0, cov * 4.0)` guard in spirit.
const RIM_TABLE = tableOf((c) => rimAt(c) * shapedAt(c) * FILL_ALPHA);

// The coverage ramp, in viewBox units — the one number here that is
// deliberately TIGHTER than the map's proportion rather than equal to
// it, and the reason is size. On the map a claim is hundreds of pixels
// wide and a wide ramp reads as a soft edge; at 92px the same
// proportion spends a quarter of the whole chip on fringe, and the
// shape stops being a shape. So the pipeline stays the map's and the
// ramp comes in: a crisp body, the bands drawn close to the edge.
// Below about 0.8 the bands have no room left and the chip flattens
// into a sticker.
const BLUR = 1.2;
// Edge meander. Low frequency and small amplitude: on the map the
// wobble has ~170px features, and a whole territory drawn at 64 units
// only ever shows the first bend of one.
const WOBBLE = 1.2;
const WOBBLE_FREQ = 0.03;
// Puff relief. feDiffuseLighting builds its normals from the alpha
// gradient — the same field the shader probes left/right/up/down — so a
// distant light at the shader's top-left gives the same cushion.
const SURFACE = 3.2;
const LIGHT_AZIMUTH = 225;
const LIGHT_ELEVATION = 62;
// A flat-lit surface comes back at sin(elevation); rescale so flat
// ground reads as unshaded (×1) and only the slopes lift or settle.
const FLAT = Math.sin((LIGHT_ELEVATION * Math.PI) / 180);
const LIT_SLOPE = 1 / FLAT;

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
  // Every chip meanders differently — one shared seed would give a row
  // of blobs bent the same way, which reads as a pattern rather than as
  // ground. Derived from the id so a chip is stable across renders.
  const seed = useMemo(() => {
    let h = 2166136261;
    for (let i = 0; i < uid.length; i++) {
      h ^= uid.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) % 100;
  }, [uid]);

  return (
    <svg
      viewBox={`0 0 ${BOX} ${BOX}`}
      width={size}
      height={size}
      aria-hidden
      // sRGB, not the filter default of linearRGB: the map composites in
      // sRGB, and in linear the same alphas come out visibly paler.
      style={{ overflow: 'visible' }}
    >
      <defs>
        <filter
          id={fid}
          x="-25%"
          y="-25%"
          width="150%"
          height="150%"
          colorInterpolationFilters="sRGB"
        >
          {/* The coverage field: what the shader blurs offscreen. */}
          <feGaussianBlur in="SourceAlpha" stdDeviation={BLUR} result="cov" />
          {/* …bent a little, so the border meanders instead of being
              uniformly rounded. */}
          <feTurbulence
            type="fractalNoise"
            baseFrequency={WOBBLE_FREQ}
            numOctaves={2}
            seed={seed}
            result="noise"
          />
          <feDisplacementMap
            in="cov"
            in2="noise"
            scale={WOBBLE}
            xChannelSelector="R"
            yChannelSelector="G"
            result="field"
          />

          {/* Coverage → the halo/body bands, at the map's own alpha. */}
          <feComponentTransfer in="field" result="shapedA">
            <feFuncA type="table" tableValues={SHAPED_TABLE} />
          </feComponentTransfer>
          <feFlood floodColor={color} result="hue" />
          <feComposite in="hue" in2="shapedA" operator="in" result="body" />

          {/* Puff: the field lit from the top-left, so a claim reads as a
              cushion of scent rather than a flat sticker. */}
          <feDiffuseLighting
            in="field"
            surfaceScale={SURFACE}
            diffuseConstant={1}
            lightingColor="#ffffff"
            result="litRaw"
          >
            <feDistantLight azimuth={LIGHT_AZIMUTH} elevation={LIGHT_ELEVATION} />
          </feDiffuseLighting>
          <feComponentTransfer in="litRaw" result="lit">
            <feFuncR type="linear" slope={LIT_SLOPE} intercept={0} />
            <feFuncG type="linear" slope={LIT_SLOPE} intercept={0} />
            <feFuncB type="linear" slope={LIT_SLOPE} intercept={0} />
          </feComponentTransfer>
          {/* arithmetic k1=1 is a per-channel multiply: the shading rides
              on the colour without touching its alpha (the light is
              opaque, so alpha × 1). */}
          <feComposite
            in="body"
            in2="lit"
            operator="arithmetic"
            k1={1}
            k2={0}
            k3={0}
            k4={0}
            result="bodyLit"
          />

          {/* The bright rim each band is born with. */}
          <feComponentTransfer in="field" result="rimA">
            <feFuncA type="table" tableValues={RIM_TABLE} />
          </feComponentTransfer>
          <feFlood floodColor="#ffffff" result="white" />
          <feComposite in="white" in2="rimA" operator="in" result="rim" />

          <feMerge>
            <feMergeNode in="bodyLit" />
            <feMergeNode in="rim" />
          </feMerge>
        </filter>
      </defs>
      {/* The source is a bare silhouette — every bit of the look above is
          the filter, exactly as every bit of the map's is the shader.
          No shape (older server, or ground lost mid-read) falls back to a
          disc, which the same filter turns into the same kind of field. */}
      {pts ? (
        <polygon points={pts} fill="#000" filter={`url(#${fid})`} />
      ) : (
        <circle cx={BOX / 2} cy={BOX / 2} r={BOX / 4.4} fill="#000" filter={`url(#${fid})`} />
      )}
    </svg>
  );
}
