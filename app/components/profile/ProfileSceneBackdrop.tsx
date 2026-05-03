// Tiny pixelated landscape that lives behind the profile dog scene.
// All shapes are rectangles on a 2-px pixel grid to match the 8-bit
// dog sprite aesthetic — no anti-aliased curves, no gradients.
//
// Three parallax layers + day/night theming:
//   far  — sky tint, sun-or-moon, clouds (factor ~0.06)
//   mid  — trees + lamppost, lamp light cone at night (factor ~0.18)
//   near — bench + ground tufts (factor ~0.32)
// Plus a ground stripe + sky/foreground rectangles that stay locked
// as the reference plane.
//
// Each layer is its own <svg> with the same 360×200 viewBox so the
// elements line up vertically.

export type SceneMode = 'day' | 'night';

interface BackdropProps {
  // Dog's current center x in container pixels. Drives parallax.
  dogCenterX: number;
  // Container width in pixels — the dog's "world" reference.
  cardWidth: number;
  // ms — same value the dog's transform transition uses, so the
  // layers slide in sync. 0 for stationary.
  transitionMs: number;
  // 'day' or 'night' — drives the colour palette + sun/moon swap +
  // lamp light cone.
  mode: SceneMode;
}

const VIEW_W = 360;
const VIEW_H = 200;

// Where trees + lamppost + bench stand. Upper-middle of the viewBox
// so the dog (paws at container y≈190) walks visibly BELOW this
// line.
const GROUND_Y = 110;

// Per-mode colour palettes.
const PALETTE = {
  day: {
    sky: '#dbeaf4',
    foreground: '#cdd5c0',
    foliage: '#88a878',
    foliageHighlight: '#a3c195',
    trunk: '#735940',
    bench: '#735940',
    grass: '#8aa078',
    cloud: '#ffffff',
    cloudShadow: '#f0f3f6',
    lamppost: '#4a4a4a',
    lampBulb: '#f5d68a',
  },
  night: {
    sky: '#1c2a44',
    foreground: '#2a3a4a',
    foliage: '#3a5a3e',
    foliageHighlight: '#52764e',
    trunk: '#3a2c1f',
    bench: '#3a2c1f',
    grass: '#3e5236',
    cloud: '#465972',
    cloudShadow: '#3a4c63',
    lamppost: '#222222',
    lampBulb: '#fff2b3',
  },
} satisfies Record<SceneMode, Record<string, string>>;

interface CloudProps {
  x: number;
  y: number;
  scale?: number;
  fill: string;
  shadow: string;
}

function Cloud({ x, y, scale = 1, fill, shadow }: CloudProps) {
  const u = 2 * scale;
  return (
    <g>
      <rect x={x + 4 * u} y={y} width={6 * u} height={u} fill={fill} />
      <rect x={x + u} y={y + u} width={12 * u} height={2 * u} fill={fill} />
      <rect x={x + 2 * u} y={y + 3 * u} width={10 * u} height={u} fill={shadow} />
    </g>
  );
}

interface TreeProps {
  x: number;
  scale?: number;
  foliage: string;
  highlight: string;
  trunk: string;
}

function Tree({ x, scale = 1, foliage, highlight, trunk }: TreeProps) {
  const u = 2 * scale;
  const trunkW = u;
  const trunkH = u * 4;
  const trunkX = x + u * 4 - trunkW / 2;
  const trunkY = GROUND_Y - trunkH;
  return (
    <g>
      <rect x={trunkX} y={trunkY} width={trunkW} height={trunkH} fill={trunk} />
      <rect x={x} y={trunkY - u * 5} width={u * 9} height={u * 5} fill={foliage} />
      <rect x={x + u} y={trunkY - u * 8} width={u * 7} height={u * 3} fill={foliage} />
      <rect x={x + u * 2} y={trunkY - u * 10} width={u * 5} height={u * 2} fill={foliage} />
      <rect x={x + u} y={trunkY - u * 4} width={u * 2} height={u * 2} fill={highlight} />
    </g>
  );
}

// Sun — gold square cluster at the upper-right of the sky. Stepped
// edges read as a pixel disc rather than a hard square.
function Sun({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g fill="#f5b542">
      <rect x={cx - 4} y={cy - 8} width={8} height={2} />
      <rect x={cx - 6} y={cy - 6} width={12} height={2} />
      <rect x={cx - 8} y={cy - 4} width={16} height={8} />
      <rect x={cx - 6} y={cy + 4} width={12} height={2} />
      <rect x={cx - 4} y={cy + 6} width={8} height={2} />
    </g>
  );
}

// Moon — pale square cluster with a small darker crater dot.
function Moon({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g>
      <g fill="#f0eee0">
        <rect x={cx - 3} y={cy - 7} width={6} height={2} />
        <rect x={cx - 5} y={cy - 5} width={10} height={2} />
        <rect x={cx - 7} y={cy - 3} width={14} height={6} />
        <rect x={cx - 5} y={cy + 3} width={10} height={2} />
        <rect x={cx - 3} y={cy + 5} width={6} height={2} />
      </g>
      {/* Crater */}
      <rect x={cx + 1} y={cy - 1} width={2} height={2} fill="#c8c4a8" />
    </g>
  );
}

// Stars — a few scattered 1×1 white dots. Night only.
function Stars() {
  const positions: [number, number][] = [
    [50, 18], [82, 30], [124, 12], [200, 24], [248, 38], [296, 16], [332, 32],
  ];
  return (
    <g fill="#fff7e0">
      {positions.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} />
      ))}
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
  mode,
}: BackdropProps) {
  const p = PALETTE[mode];
  return (
    <>
      {/* Sky + foreground fill — locked, no parallax. Bottom strip
          is slightly tinted vs the sky so the foreground reads as
          "in front of" the back layers even before the dog walks
          across it. */}
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
        <rect x={0} y={0} width={VIEW_W} height={GROUND_Y} fill={p.sky} />
        <rect
          x={0}
          y={GROUND_Y}
          width={VIEW_W}
          height={VIEW_H - GROUND_Y}
          fill={p.foreground}
        />
        <rect x={0} y={GROUND_Y} width={VIEW_W} height={3} fill="#c5c8b5" />
      </svg>

      {/* Far layer — sun-or-moon, stars at night, clouds. */}
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        style={layerStyle(dogCenterX, cardWidth, 0.06, transitionMs)}
        aria-hidden
      >
        {mode === 'night' ? <Stars /> : null}
        {mode === 'day' ? <Sun cx={290} cy={28} /> : <Moon cx={290} cy={28} />}
        <Cloud x={20} y={18} scale={1.2} fill={p.cloud} shadow={p.cloudShadow} />
        <Cloud x={108} y={8} scale={1} fill={p.cloud} shadow={p.cloudShadow} />
        <Cloud x={172} y={28} scale={0.85} fill={p.cloud} shadow={p.cloudShadow} />
        <Cloud x={236} y={14} scale={1.15} fill={p.cloud} shadow={p.cloudShadow} />
      </svg>

      {/* Mid layer — trees + lamppost. Lamp light cone added at
          night, drawn UNDER the lamppost itself so the post sits on
          top of the glow. */}
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        style={layerStyle(dogCenterX, cardWidth, 0.18, transitionMs)}
        aria-hidden
      >
        {mode === 'night' ? (
          <>
            {/* Light cone: short trapezoid from bulb (narrow top) to
                just below the bench (wide bottom), warm yellow with
                low alpha so the post + bench still read through. */}
            <polygon
              points={`155,${GROUND_Y - 56} 165,${GROUND_Y - 56} 174,${GROUND_Y + 5} 146,${GROUND_Y + 5}`}
              fill="rgba(255, 215, 130, 0.2)"
            />
            {/* Brighter inner cone for a hot-spot look */}
            <polygon
              points={`158,${GROUND_Y - 56} 162,${GROUND_Y - 56} 167,${GROUND_Y + 5} 153,${GROUND_Y + 5}`}
              fill="rgba(255, 230, 160, 0.25)"
            />
            {/* Pool of light on the ground directly under the lamp */}
            <ellipse
              cx={160}
              cy={GROUND_Y + 4}
              rx={14}
              ry={2}
              fill="rgba(255, 220, 130, 0.4)"
            />
          </>
        ) : null}

        <Tree x={6} scale={1.4} foliage={p.foliage} highlight={p.foliageHighlight} trunk={p.trunk} />
        <Tree x={70} scale={1} foliage={p.foliage} highlight={p.foliageHighlight} trunk={p.trunk} />
        <Tree x={108} scale={0.85} foliage={p.foliage} highlight={p.foliageHighlight} trunk={p.trunk} />
        <Tree x={210} scale={1.15} foliage={p.foliage} highlight={p.foliageHighlight} trunk={p.trunk} />
        <Tree x={262} scale={0.95} foliage={p.foliage} highlight={p.foliageHighlight} trunk={p.trunk} />
        <Tree x={316} scale={1.3} foliage={p.foliage} highlight={p.foliageHighlight} trunk={p.trunk} />

        {/* Lamppost */}
        <g>
          <rect x={158} y={GROUND_Y - 56} width={2} height={56} fill={p.lamppost} />
          <rect x={154} y={GROUND_Y - 58} width={10} height={4} fill={p.lamppost} />
          <rect x={158} y={GROUND_Y - 62} width={2} height={4} fill={p.lamppost} />
          {/* Bulb — brighter at night */}
          <rect x={154} y={GROUND_Y - 56} width={10} height={2} fill={p.lampBulb} />
        </g>
      </svg>

      {/* Near layer — bench + grass tufts. Fastest parallax. */}
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        style={layerStyle(dogCenterX, cardWidth, 0.32, transitionMs)}
        aria-hidden
      >
        <g fill={p.bench}>
          <rect x={180} y={GROUND_Y - 9} width={36} height={3} />
          <rect x={180} y={GROUND_Y - 15} width={36} height={2} />
          <rect x={184} y={GROUND_Y - 13} width={2} height={4} />
          <rect x={212} y={GROUND_Y - 13} width={2} height={4} />
          <rect x={184} y={GROUND_Y - 6} width={2} height={6} />
          <rect x={212} y={GROUND_Y - 6} width={2} height={6} />
        </g>
        <g fill={p.grass}>
          <rect x={44} y={GROUND_Y - 3} width={2} height={3} />
          <rect x={92} y={GROUND_Y - 3} width={2} height={3} />
          <rect x={138} y={GROUND_Y - 3} width={2} height={3} />
          <rect x={248} y={GROUND_Y - 3} width={2} height={3} />
          <rect x={296} y={GROUND_Y - 3} width={2} height={3} />
          <rect x={334} y={GROUND_Y - 3} width={2} height={3} />
        </g>
      </svg>
    </>
  );
}
