// Tiny pixelated landscape that lives behind the profile dog scene.
// All shapes are rectangles on a 2-px pixel grid to match the 8-bit
// dog sprite aesthetic — no anti-aliased curves, no gradients.
//
// Three parallax layers:
//   far  — distant cityscape + windows (factor ~0.06)
//   mid  — trees + lamppost (factor ~0.18)
//   near — bench + ground tufts (factor ~0.32)
// Plus a ground stripe that stays locked as the reference plane.
//
// Each layer is its own <svg> with the same 360×130 viewBox so the
// elements line up vertically. Layers translate horizontally by
// `(dogCenter - cardCenter) * -factor` — when the dog moves right
// of centre, the layers slide left; when the dog moves left, they
// slide right. Factor 0 for the ground, increasing toward the
// foreground for that classic platformer parallax depth feel.
//
// Transition matches the dog's slide duration so layers lerp in
// sync with the dog's motion.

interface BackdropProps {
  // Dog's current center x in container pixels. Drives parallax.
  dogCenterX: number;
  // Container width in pixels — the dog's "world" reference.
  cardWidth: number;
  // ms — same value the dog's transform transition uses, so the
  // layers slide in sync. 0 for stationary.
  transitionMs: number;
}

const VIEW_W = 360;
const VIEW_H = 130;

// Ground line y in viewBox units. Houses, trees, and lamppost all
// stand on this; the dog's per-anim bottomOffset aligns its paws
// here too.
const GROUND_Y = 115;

interface HouseProps {
  x: number; // left edge of body
  bodyW: number;
  bodyH: number; // body height (excluding roof)
  body: string; // body fill
  roof: string; // roof fill
}

// A single old-town house: stepped pitched roof, body, 2×3 window
// grid, small door at the bottom-center. All measurements snap to a
// 2-px grid for consistent pixel-art look. The body sits flush with
// GROUND_Y so houses share a baseline.
function House({ x, bodyW, bodyH, body, roof }: HouseProps) {
  const bodyY = GROUND_Y - bodyH;
  // Stepped pitched roof — three horizontal rectangles narrowing
  // toward the apex. 8 px total roof height.
  const roofY = bodyY - 8;
  const roofPad = 4; // how far the eaves overhang the body each side
  const rW1 = bodyW + roofPad * 2;
  const rW2 = Math.max(4, bodyW);
  const rW3 = Math.max(4, bodyW - roofPad * 2);
  // Window grid — 2 columns × 2 rows, 4×4 windows, 4 px gutters.
  const winW = 4;
  const winH = 4;
  const colGap = 4;
  const rowGap = 5;
  const cols = 2;
  const rows = 2;
  const winsW = cols * winW + (cols - 1) * colGap;
  const winsLeft = x + (bodyW - winsW) / 2;
  const winsTop = bodyY + 6;
  // Door — 6×10 at body bottom center.
  const doorW = 6;
  const doorH = 10;
  const doorX = x + (bodyW - doorW) / 2;
  const doorY = GROUND_Y - doorH;
  // Window + door colors derived from roof for cohesion.
  const windowFill = '#e8eef2';
  const doorFill = roof;
  return (
    <g>
      {/* Roof — three stacked rectangles, narrowing upward */}
      <rect x={x - roofPad} y={roofY + 6} width={rW1} height={2} fill={roof} />
      <rect
        x={x - roofPad + (rW1 - rW2) / 2}
        y={roofY + 3}
        width={rW2}
        height={3}
        fill={roof}
      />
      <rect
        x={x - roofPad + (rW1 - rW3) / 2}
        y={roofY}
        width={rW3}
        height={3}
        fill={roof}
      />
      {/* Body */}
      <rect x={x} y={bodyY} width={bodyW} height={bodyH} fill={body} />
      {/* Windows */}
      {Array.from({ length: rows }).map((_, r) =>
        Array.from({ length: cols }).map((_, c) => (
          <rect
            key={`${r}-${c}`}
            x={winsLeft + c * (winW + colGap)}
            y={winsTop + r * (winH + rowGap)}
            width={winW}
            height={winH}
            fill={windowFill}
          />
        )),
      )}
      {/* Door */}
      <rect x={doorX} y={doorY} width={doorW} height={doorH} fill={doorFill} />
      {/* Tiny door knob for character */}
      <rect x={doorX + doorW - 2} y={doorY + doorH / 2} width={1} height={1} fill="#3a2a1a" />
    </g>
  );
}

function layerStyle(
  dogCenterX: number,
  cardWidth: number,
  factor: number,
  transitionMs: number,
): React.CSSProperties {
  const offset = dogCenterX - cardWidth / 2;
  const tx = -offset * factor;
  return {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    imageRendering: 'pixelated' as const,
    pointerEvents: 'none',
    transform: `translateX(${tx}px)`,
    transition:
      transitionMs > 0 ? `transform ${transitionMs}ms linear` : 'none',
  };
}

export function ProfileSceneBackdrop({
  dogCenterX,
  cardWidth,
  transitionMs,
}: BackdropProps) {
  return (
    <>
      {/* Far layer — old-town houses. Each house has a body in a
          warm pastel, a stepped pitched roof in a darker tone, a 2×3
          window grid, and a small door at the bottom-center.
          Heights stop well above the ground line so the dog walks
          IN FRONT of them; varied widths + colors give the row a
          European-old-town silhouette without being noisy. */}
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        style={layerStyle(dogCenterX, cardWidth, 0.06, transitionMs)}
        aria-hidden
      >
        <House x={4} bodyW={40} bodyH={62} body="#f0d9b5" roof="#a05a3c" />
        <House x={50} bodyW={32} bodyH={70} body="#dde7d6" roof="#7a8c6e" />
        <House x={88} bodyW={36} bodyH={58} body="#e4cdb5" roof="#8c5a3c" />
        <House x={130} bodyW={28} bodyH={66} body="#dfd5e6" roof="#6c5a76" />
        <House x={186} bodyW={42} bodyH={68} body="#e9dac1" roof="#946d4b" />
        <House x={236} bodyW={30} bodyH={56} body="#d8dde6" roof="#5e7080" />
        <House x={272} bodyW={36} bodyH={64} body="#e4d2c4" roof="#a45e44" />
        <House x={316} bodyW={28} bodyH={58} body="#dde0d2" roof="#7a8068" />
      </svg>

      {/* Mid layer — trees + lamppost. Medium parallax. */}
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        style={layerStyle(dogCenterX, cardWidth, 0.18, transitionMs)}
        aria-hidden
      >
        {/* Left tree */}
        <g>
          <rect x="14" y="92" width="6" height="22" fill="#735940" />
          <rect x="4" y="80" width="26" height="14" fill="#88a878" />
          <rect x="6" y="74" width="22" height="6" fill="#88a878" />
          <rect x="10" y="70" width="14" height="4" fill="#88a878" />
          <rect x="8" y="78" width="6" height="4" fill="#a3c195" />
        </g>
        {/* Right tree */}
        <g>
          <rect x="332" y="94" width="6" height="20" fill="#735940" />
          <rect x="324" y="84" width="22" height="12" fill="#88a878" />
          <rect x="326" y="78" width="18" height="6" fill="#88a878" />
          <rect x="330" y="74" width="10" height="4" fill="#88a878" />
          <rect x="338" y="82" width="6" height="4" fill="#a3c195" />
        </g>
        {/* Lamppost */}
        <g>
          <rect x="160" y="58" width="2" height="56" fill="#4a4a4a" />
          <rect x="156" y="56" width="10" height="4" fill="#4a4a4a" />
          <rect x="160" y="52" width="2" height="4" fill="#4a4a4a" />
          <rect x="156" y="58" width="10" height="2" fill="#f5d68a" />
        </g>
      </svg>

      {/* Near layer — bench + ground tufts. Fastest parallax. */}
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        style={layerStyle(dogCenterX, cardWidth, 0.32, transitionMs)}
        aria-hidden
      >
        {/* Bench */}
        <g fill="#735940">
          <rect x="262" y="106" width="36" height="3" />
          <rect x="262" y="100" width="36" height="2" />
          <rect x="266" y="102" width="2" height="4" />
          <rect x="294" y="102" width="2" height="4" />
          <rect x="266" y="109" width="2" height="6" />
          <rect x="294" y="109" width="2" height="6" />
        </g>
        {/* Grass tufts on the ground line */}
        <g fill="#8aa078">
          <rect x="120" y="112" width="2" height="3" />
          <rect x="148" y="112" width="2" height="3" />
          <rect x="244" y="112" width="2" height="3" />
          <rect x="308" y="112" width="2" height="3" />
        </g>
      </svg>

      {/* Ground stripe — locked, no parallax. The reference plane
          everything else moves against. */}
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          imageRendering: 'pixelated',
          pointerEvents: 'none',
        }}
        aria-hidden
      >
        <rect x="0" y="115" width="360" height="3" fill="#c5c8b5" />
      </svg>
    </>
  );
}
