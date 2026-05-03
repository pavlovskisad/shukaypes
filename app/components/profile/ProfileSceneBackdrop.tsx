// Tiny pixelated landscape that lives behind the profile dog scene.
// All shapes are rectangles on a 2-px pixel grid to match the 8-bit
// dog sprite aesthetic — no anti-aliased curves, no gradients.
//
// Two-ground-line layout:
//   BACK_GROUND_Y  ↦ trees + lamppost stand on this. Higher up in the
//                    viewBox so they read as "the line in the
//                    distance" — clouds sit above, the dog walks
//                    below.
//   FRONT_GROUND_Y ↦ dog paws + bench rest on this. At the bottom
//                    of the viewBox so the dog walks in the
//                    foreground, with the back ground visibly
//                    above its paws.
// Net effect: dog walks IN FRONT OF the tree row, not on the same
// line, which kills the "dog floating in mid-air" feel.
//
// Three parallax layers (factor opposite to dog motion):
//   far  — clouds (factor ~0.06)
//   mid  — trees + lamppost on BACK_GROUND_Y (factor ~0.18)
//   near — bench + grass tufts on FRONT_GROUND_Y (factor ~0.32)
// Plus the front ground stripe locked as the reference plane.

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

// Where the TREE-row stands. Trees, lamppost, and any "background"
// objects share this baseline. Sits in the upper-middle of the
// viewBox so the dog walks visibly below.
const BACK_GROUND_Y = 95;
// Where the DOG walks and the bench rests. Container's bottom strip.
// The dog's per-anim bottomOffset (in ProfileDogScene) lands paws on
// this line.
const FRONT_GROUND_Y = 122;

interface CloudProps {
  x: number;
  y: number;
  scale?: number;
}

// Fluffy pixel cloud — 6 rows of bumpy rectangles forming a
// rounded silhouette. The two top "bumps" + tapered bottom gives
// a real volume read instead of looking like flat lines. White fill
// with a faint shadow on the bottom row.
function Cloud({ x, y, scale = 1 }: CloudProps) {
  const u = 2 * scale;
  return (
    <g>
      {/* Top bumps */}
      <rect x={x + 4 * u} y={y} width={2 * u} height={u} fill="#ffffff" />
      <rect x={x + 8 * u} y={y} width={4 * u} height={u} fill="#ffffff" />
      {/* Upper body */}
      <rect x={x + 2 * u} y={y + u} width={4 * u} height={u} fill="#ffffff" />
      <rect x={x + 7 * u} y={y + u} width={6 * u} height={u} fill="#ffffff" />
      {/* Mid body — full width */}
      <rect x={x + u} y={y + 2 * u} width={14 * u} height={2 * u} fill="#ffffff" />
      {/* Lower body — slightly narrower */}
      <rect x={x + 2 * u} y={y + 4 * u} width={12 * u} height={u} fill="#ffffff" />
      {/* Bottom shadow row */}
      <rect x={x + 3 * u} y={y + 5 * u} width={10 * u} height={u} fill="#eef2f5" />
    </g>
  );
}

interface TreeProps {
  x: number;
  scale?: number;
}

// Pixel tree on the BACK_GROUND_Y baseline.
function Tree({ x, scale = 1 }: TreeProps) {
  const u = 2 * scale;
  const trunkW = u;
  const trunkH = u * 4;
  const trunkX = x + u * 4 - trunkW / 2;
  const trunkY = BACK_GROUND_Y - trunkH;
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
      {/* Far layer — fluffy clouds drifting in the upper sky.
          Slowest parallax. */}
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        style={layerStyle(dogCenterX, cardWidth, 0.06, transitionMs)}
        aria-hidden
      >
        <Cloud x={20} y={6} scale={1.2} />
        <Cloud x={120} y={2} scale={0.95} />
        <Cloud x={196} y={14} scale={0.85} />
        <Cloud x={262} y={6} scale={1.1} />
      </svg>

      {/* Mid layer — varied trees + lamppost, all standing on
          BACK_GROUND_Y. The dog walks in front of this row. */}
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
        {/* Lamppost — pole reaches down to BACK_GROUND_Y */}
        <g>
          <rect
            x={158}
            y={BACK_GROUND_Y - 50}
            width={2}
            height={50}
            fill="#4a4a4a"
          />
          <rect
            x={154}
            y={BACK_GROUND_Y - 52}
            width={10}
            height={4}
            fill="#4a4a4a"
          />
          <rect
            x={158}
            y={BACK_GROUND_Y - 56}
            width={2}
            height={4}
            fill="#4a4a4a"
          />
          {/* Warm bulb glow */}
          <rect
            x={154}
            y={BACK_GROUND_Y - 50}
            width={10}
            height={2}
            fill="#f5d68a"
          />
        </g>
      </svg>

      {/* Near layer — bench + grass tufts in the foreground, on
          FRONT_GROUND_Y where the dog walks. Fastest parallax. */}
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        style={layerStyle(dogCenterX, cardWidth, 0.32, transitionMs)}
        aria-hidden
      >
        {/* Bench — sits on FRONT_GROUND_Y, dog can walk past it */}
        <g fill="#735940">
          <rect x={172} y={FRONT_GROUND_Y - 9} width={36} height={3} />
          <rect x={172} y={FRONT_GROUND_Y - 15} width={36} height={2} />
          <rect x={176} y={FRONT_GROUND_Y - 13} width={2} height={4} />
          <rect x={204} y={FRONT_GROUND_Y - 13} width={2} height={4} />
          <rect x={176} y={FRONT_GROUND_Y - 6} width={2} height={6} />
          <rect x={204} y={FRONT_GROUND_Y - 6} width={2} height={6} />
        </g>
        {/* Grass tufts on the front ground line */}
        <g fill="#8aa078">
          <rect x={44} y={FRONT_GROUND_Y - 3} width={2} height={3} />
          <rect x={92} y={FRONT_GROUND_Y - 3} width={2} height={3} />
          <rect x={138} y={FRONT_GROUND_Y - 3} width={2} height={3} />
          <rect x={248} y={FRONT_GROUND_Y - 3} width={2} height={3} />
          <rect x={296} y={FRONT_GROUND_Y - 3} width={2} height={3} />
          <rect x={334} y={FRONT_GROUND_Y - 3} width={2} height={3} />
        </g>
      </svg>

      {/* Front ground stripe — locked, no parallax. The reference
          plane the dog's paws meet. */}
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
        <rect
          x={0}
          y={FRONT_GROUND_Y}
          width={VIEW_W}
          height={3}
          fill="#c5c8b5"
        />
        {/* Faint line at the BACK_GROUND_Y — gives a "horizon"
            hint without being visually heavy. Same color but thin. */}
        <rect
          x={0}
          y={BACK_GROUND_Y}
          width={VIEW_W}
          height={1}
          fill="#dde1d3"
        />
      </svg>
    </>
  );
}
