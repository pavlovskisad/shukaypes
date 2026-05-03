// Tiny pixelated landscape that lives behind the profile dog scene.
// All shapes are rectangles on a 2-px pixel grid to match the 8-bit
// dog sprite aesthetic — no anti-aliased curves, no gradients.
//
// Three parallax layers:
//   far  — clouds drifting in the sky (factor ~0.06)
//   mid  — trees of varied sizes + lamppost (factor ~0.18)
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
const VIEW_H = 200;

// The "ground line" trees + lamppost + bench stand on. Sits in the
// upper-middle of the viewBox so the dog (whose paws land near
// y≈190 of the container) walks visibly BELOW this line — like a
// foreground strip in front of the park scene.
const GROUND_Y = 110;

interface CloudProps {
  x: number;
  y: number;
  scale?: number; // multiplier on the cloud size (1 = base ~24px wide)
}

// Pixel cloud — 3 stacked rows of rectangles forming a puffy shape.
// Built around base unit `u` so we can scale without breaking the
// pixel grid. White-ish fill with a slightly darker bottom shadow
// row for a hint of volume.
function Cloud({ x, y, scale = 1 }: CloudProps) {
  const u = 2 * scale;
  return (
    <g>
      {/* Top row — narrow */}
      <rect x={x + 4 * u} y={y} width={6 * u} height={u} fill="#ffffff" />
      {/* Mid row — wide body */}
      <rect x={x + u} y={y + u} width={12 * u} height={2 * u} fill="#ffffff" />
      {/* Bottom row — slightly narrower with shadow row */}
      <rect x={x + 2 * u} y={y + 3 * u} width={10 * u} height={u} fill="#f0f3f6" />
    </g>
  );
}

interface TreeProps {
  x: number;
  scale?: number; // 1 = base size; trunk + foliage scale together
}

// Pixel tree — stepped square foliage on a small trunk. Sits on
// GROUND_Y. Scale multiplier lets the same component render small
// shrubs and big mature trees from one helper.
function Tree({ x, scale = 1 }: TreeProps) {
  const u = 2 * scale;
  // Trunk
  const trunkW = u;
  const trunkH = u * 4;
  const trunkX = x + u * 4 - trunkW / 2; // centered under foliage
  const trunkY = GROUND_Y - trunkH;
  // Foliage — three stacked tiers narrowing upward
  const foliage = '#88a878';
  const highlight = '#a3c195';
  return (
    <g>
      <rect x={trunkX} y={trunkY} width={trunkW} height={trunkH} fill="#735940" />
      {/* Bottom tier — widest */}
      <rect x={x} y={trunkY - u * 5} width={u * 9} height={u * 5} fill={foliage} />
      {/* Mid tier */}
      <rect x={x + u} y={trunkY - u * 8} width={u * 7} height={u * 3} fill={foliage} />
      {/* Top tier — narrow crown */}
      <rect x={x + u * 2} y={trunkY - u * 10} width={u * 5} height={u * 2} fill={foliage} />
      {/* Highlight — top-left of bottom tier */}
      <rect x={x + u} y={trunkY - u * 4} width={u * 2} height={u * 2} fill={highlight} />
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
      {/* Far layer — clouds drifting in the sky. Slowest parallax,
          so they barely move as the dog walks (sells "distant"). */}
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        style={layerStyle(dogCenterX, cardWidth, 0.06, transitionMs)}
        aria-hidden
      >
        <Cloud x={20} y={18} scale={1.2} />
        <Cloud x={108} y={8} scale={1} />
        <Cloud x={172} y={28} scale={0.85} />
        <Cloud x={236} y={14} scale={1.15} />
        <Cloud x={306} y={24} scale={0.9} />
      </svg>

      {/* Mid layer — varied trees. Six trees of different sizes
          spread across the row, with the lamppost in the middle
          for a focal point. Sizes range from small shrub to big
          mature so the row reads as a real park edge. */}
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        style={layerStyle(dogCenterX, cardWidth, 0.18, transitionMs)}
        aria-hidden
      >
        <Tree x={6} scale={1.4} />
        <Tree x={70} scale={1} />
        <Tree x={108} scale={0.85} />
        <Tree x={210} scale={1.15} />
        <Tree x={262} scale={0.95} />
        <Tree x={316} scale={1.3} />
        {/* Lamppost — sits between two of the trees */}
        <g>
          <rect x="158" y={GROUND_Y - 56} width="2" height="56" fill="#4a4a4a" />
          <rect x="154" y={GROUND_Y - 58} width="10" height="4" fill="#4a4a4a" />
          <rect x="158" y={GROUND_Y - 62} width="2" height="4" fill="#4a4a4a" />
          {/* Warm bulb glow */}
          <rect x="154" y={GROUND_Y - 56} width="10" height="2" fill="#f5d68a" />
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
          <rect x="180" y={GROUND_Y - 9} width="36" height="3" />
          <rect x="180" y={GROUND_Y - 15} width="36" height="2" />
          <rect x="184" y={GROUND_Y - 13} width="2" height="4" />
          <rect x="212" y={GROUND_Y - 13} width="2" height="4" />
          <rect x="184" y={GROUND_Y - 6} width="2" height="6" />
          <rect x="212" y={GROUND_Y - 6} width="2" height="6" />
        </g>
        {/* Grass tufts on the ground line */}
        <g fill="#8aa078">
          <rect x="44" y={GROUND_Y - 3} width="2" height="3" />
          <rect x="92" y={GROUND_Y - 3} width="2" height="3" />
          <rect x="138" y={GROUND_Y - 3} width="2" height="3" />
          <rect x="248" y={GROUND_Y - 3} width="2" height="3" />
          <rect x="296" y={GROUND_Y - 3} width="2" height="3" />
          <rect x="334" y={GROUND_Y - 3} width="2" height="3" />
        </g>
      </svg>

      {/* Ground stripe — locked, no parallax. The reference plane
          everything else stands on. */}
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
        <rect x="0" y={GROUND_Y} width={VIEW_W} height="3" fill="#c5c8b5" />
      </svg>
    </>
  );
}
