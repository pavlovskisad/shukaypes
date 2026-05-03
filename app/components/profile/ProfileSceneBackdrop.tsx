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
      {/* Far layer — distant cityscape + windows. Slowest parallax. */}
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        style={layerStyle(dogCenterX, cardWidth, 0.06, transitionMs)}
        aria-hidden
      >
        <g fill="#e6e6ea">
          <rect x="40" y="62" width="14" height="48" />
          <rect x="54" y="56" width="22" height="54" />
          <rect x="76" y="68" width="16" height="42" />
          <rect x="92" y="60" width="20" height="50" />
          <rect x="184" y="64" width="18" height="46" />
          <rect x="202" y="58" width="12" height="52" />
          <rect x="214" y="66" width="22" height="44" />
          <rect x="236" y="60" width="14" height="50" />
        </g>
        <g fill="#c2c2c8">
          <rect x="58" y="62" width="2" height="2" />
          <rect x="64" y="62" width="2" height="2" />
          <rect x="70" y="62" width="2" height="2" />
          <rect x="58" y="72" width="2" height="2" />
          <rect x="64" y="72" width="2" height="2" />
          <rect x="70" y="72" width="2" height="2" />
          <rect x="96" y="68" width="2" height="2" />
          <rect x="102" y="68" width="2" height="2" />
          <rect x="108" y="68" width="2" height="2" />
          <rect x="220" y="72" width="2" height="2" />
          <rect x="226" y="72" width="2" height="2" />
          <rect x="220" y="80" width="2" height="2" />
          <rect x="226" y="80" width="2" height="2" />
        </g>
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
