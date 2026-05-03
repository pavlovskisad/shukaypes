import { useCallback, useEffect, useRef, useState } from 'react';
import { DogSprite, type DogAnim } from '../map/DogSprite';
import { ProfileSceneBackdrop, type SceneMode } from './ProfileSceneBackdrop';
import { ProfileSceneBirds } from './ProfileSceneBirds';

// Ambient dog scene for the profile hero — replaces the 🐶 emoji
// with the live pixel-art companion. Runs a small state machine that
// cycles through sitting / lying / walking / sniffing / running with
// weighted probability and slides the sprite across the card during
// the moving anims. Stationary anims freeze in place. Reads as "the
// dog is just hanging out next to you" instead of a flat icon.

interface SceneEntry {
  anim: DogAnim;
  weight: number;
  durMs: [number, number]; // [min, max]
  moves: boolean;
  // Optional override for slide distance from current position. With
  // no override the step picks a random target across the container
  // (with 80px minimum delta — biased to "cross the card"). Sniffing
  // uses a tight [30, 90] so the dog tracks a scent in a small area
  // instead of running across the card every time.
  movePx?: [number, number];
}

// Sitting is the default idle, lying is rare. Combined with the no-
// repeat guard from bf99b37, lying surfaces ~once every 5-7 beats —
// reads as "the dog occasionally settles for a nap" instead of "lies
// down constantly". User-tuned weights.
const SCENE: SceneEntry[] = [
  { anim: 'sitting', weight: 6, durMs: [4000, 7500], moves: false },
  { anim: 'lying', weight: 1, durMs: [4000, 7000], moves: false },
  // Sniffing now ambles a few px in a random direction so the dog
  // appears to follow a scent on the ground instead of stationary
  // pose-sniffing.
  { anim: 'sniffing', weight: 2, durMs: [2200, 3800], moves: true, movePx: [30, 90] },
  { anim: 'walking', weight: 3, durMs: [3000, 5500], moves: true },
  { anim: 'running', weight: 1, durMs: [2000, 3200], moves: true },
];

// Bark variants — pixel speech-bubble text shown when the user taps
// the scene. Mix of literal woofs and *action* notes.
const BARKS = [
  'woof!',
  'bork!',
  'arf!',
  'ruff!',
  'yip!',
  'woof woof!',
  'awoo!',
  'bark!',
  'arf arf!',
  'borf!',
  'henlo',
  'mlem',
  'boop?',
  '*sniff sniff*',
  '*tail wag*',
  '*tilts head*',
  '*zoomies*',
  '*sploot*',
];

interface BarkBubble {
  id: number;
  text: string;
  // Horizontal jitter so consecutive taps don't stack identically.
  dx: number;
}

// Per-anim downward offset — pushes the sprite down inside the
// container so the dog's BODY (not its sprite frame) lands on the
// scene's bottom ground at container y≈190. Different poses have
// different paw rows in their frames so the offsets vary; tuned by
// eye against the new HEIGHT_PX = 200.
const ANIM_BOTTOM_OFFSET: Record<DogAnim, number> = {
  walking: -25,
  running: -25,
  sniffing: 8,
  sitting: -25,
  lying: -5,
};

const SPRITE_SCALE = 2.5; // 64 × 2.5 = 160 px on screen
const SPRITE_PX = 64 * SPRITE_SCALE;
// Scene container is taller than the sprite — added sky above the
// ground line so the dog "lives" lower in the card. The whole hero
// card grows by ~70 px on the bottom end as a result, with the dog
// landing at the vertical position where the "шукайпес" label
// used to be.
const HEIGHT_PX = 200;

function pickEntry(prev: DogAnim | null): SceneEntry {
  // Exclude the previous anim from the pool so the dog doesn't loop
  // "lying → lying → lying" — visible as a glitchy "settle-glance-
  // settle-glance" instead of a single committed session. With 5
  // entries one removed leaves 4, plenty of variety.
  const pool = prev ? SCENE.filter((e) => e.anim !== prev) : SCENE;
  const total = pool.reduce((sum, e) => sum + e.weight, 0);
  let r = Math.random() * total;
  for (const e of pool) {
    r -= e.weight;
    if (r <= 0) return e;
  }
  return pool[0]!;
}

function randomBetween([lo, hi]: [number, number]): number {
  return lo + Math.random() * (hi - lo);
}

// Day from 7:00 to 19:00 local time, otherwise night. Tuned so dawn /
// dusk both read as "night" — a lit lamppost at 6am feels right.
function isDayHour(): boolean {
  const h = new Date().getHours();
  return h >= 7 && h < 19;
}

export function ProfileDogScene() {
  const [anim, setAnim] = useState<DogAnim>('sitting');
  const [facingLeft, setFacingLeft] = useState(false);
  // Mode auto-derives from wall-clock time. Manual override takes
  // precedence when set — wired to a tap on the BACKGROUND of the
  // scene (sky / trees / bench), while a tap on the dog itself fires
  // a bark instead. So:
  //   tap dog        → bark
  //   tap elsewhere  → flip day ↔ night
  const [autoMode, setAutoMode] = useState<SceneMode>(() =>
    isDayHour() ? 'day' : 'night',
  );
  const [manualMode, setManualMode] = useState<SceneMode | null>(null);
  const mode: SceneMode = manualMode ?? autoMode;
  const [barks, setBarks] = useState<BarkBubble[]>([]);
  const barkSeqRef = useRef(0);
  // Measured container width — drives how far the sprite can slide
  // before clipping. ResizeObserver covers the orientation-flip case
  // on phones; SSR initial render uses 0 (hidden until measured).
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [x, setX] = useState(0);
  const [transitionMs, setTransitionMs] = useState(0);
  const xRef = useRef(0);
  xRef.current = x;

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') {
      // Fallback for environments without ResizeObserver — read once
      // and don't react to resizes. Still better than zero width.
      if (el) setWidth(el.clientWidth);
      return;
    }
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth;
      setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Center the dog on first measurement so it doesn't pop in at the
  // left edge.
  useEffect(() => {
    if (width > 0 && xRef.current === 0) {
      const center = Math.max(0, (width - SPRITE_PX) / 2);
      setX(center);
    }
  }, [width]);

  // Re-check the wall clock every minute so the scene drifts from day
  // to night across a long session without a refresh. Cheap; doesn't
  // re-render anything if the mode hasn't changed.
  useEffect(() => {
    const id = setInterval(() => {
      setAutoMode(isDayHour() ? 'day' : 'night');
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  // Tap on dog → bark bubble. Multiple bubbles can stack if the user
  // spams taps; each is removed after its float-up animation finishes.
  // stopPropagation keeps the tap from also firing the
  // background-toggle on the scene container.
  const bark = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const text = BARKS[Math.floor(Math.random() * BARKS.length)]!;
    const id = ++barkSeqRef.current;
    const dx = (Math.random() - 0.5) * 28;
    setBarks((prev) => [...prev, { id, text, dx }]);
    setTimeout(() => {
      setBarks((prev) => prev.filter((b) => b.id !== id));
    }, 1500);
  }, []);

  // Tap on background → flip day/night. Manual override sticks; a
  // second tap returns the scene to the opposite mode.
  const toggleMode = useCallback(() => {
    setManualMode((prev) => {
      const current = prev ?? (isDayHour() ? 'day' : 'night');
      return current === 'day' ? 'night' : 'day';
    });
  }, []);

  // State-machine tick — picks a new entry, sets the anim, and (if
  // moving) starts a CSS transition toward a new x. Each tick
  // schedules the next via setTimeout; cleanup on unmount cancels
  // the pending one.
  useEffect(() => {
    if (width === 0) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastAnim: DogAnim | null = null;
    const step = () => {
      const entry = pickEntry(lastAnim);
      lastAnim = entry.anim;
      const dur = randomBetween(entry.durMs);
      setAnim(entry.anim);
      if (entry.moves && width > SPRITE_PX) {
        const maxX = width - SPRITE_PX;
        let target: number;
        if (entry.movePx) {
          // Constrained move — small step in a random direction. If
          // the chosen direction would clip a wall, flip it. Used by
          // sniffing so the dog tracks a scent instead of dashing.
          const delta = randomBetween(entry.movePx);
          const dir = Math.random() < 0.5 ? -1 : 1;
          target = xRef.current + dir * delta;
          if (target < 0 || target > maxX) target = xRef.current - dir * delta;
          target = Math.max(0, Math.min(maxX, target));
        } else {
          // Wide pick — random target across the container with an
          // 80px minimum delta so we don't twitch in place.
          const minDelta = 80;
          target = Math.random() * maxX;
          if (Math.abs(target - xRef.current) < minDelta) {
            target = xRef.current < maxX / 2 ? xRef.current + minDelta : xRef.current - minDelta;
            target = Math.max(0, Math.min(maxX, target));
          }
        }
        setFacingLeft(target < xRef.current);
        setTransitionMs(dur);
        setX(target);
      } else {
        setTransitionMs(0); // no slide on stationary
      }
      timer = setTimeout(step, dur);
    };
    step();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [width]);

  return (
    <div
      ref={containerRef}
      onClick={toggleMode}
      role="button"
      aria-label={`Scene mode: ${mode}. Tap background to toggle, tap dog to bark.`}
      style={{
        position: 'relative',
        // Break out of the card's 18px horizontal padding so the dog
        // can use the full card width — the natural padding around
        // the card content was clamping the slide range to ~150 px
        // on phones, which read as "the dog only moves in a tiny
        // strip in the middle". Negative margins keep the container
        // inside the card's white bg + rounded corners (overflow
        // clips at the corners) but let the dog reach card edges.
        width: 'calc(100% + 36px)' as unknown as number,
        marginLeft: -18,
        // Reach the top of the card too — the card's 18px padding
        // would otherwise show as a white strip above the sky.
        marginTop: -18,
        height: HEIGHT_PX,
        // Small negative marginBottom — companion-name follows the
        // scene closely below, no big air gap.
        marginBottom: -4,
        // Hide overflow so a slide that overshoots doesn't leak past
        // the card edge mid-resize, and so the sprite-top clip
        // (HEIGHT_PX < SPRITE_PX) cuts cleanly.
        overflow: 'hidden',
        cursor: 'pointer',
      }}
    >
      {/* Pixelated city/park backdrop sits behind the dog. Three
          parallax layers (far/mid/near) translate opposite to the
          dog's motion at increasing rates for depth. The transition
          duration matches the dog's, so layers slide in lockstep
          with the dog instead of lagging. */}
      <ProfileSceneBackdrop
        dogCenterX={x + SPRITE_PX / 2}
        cardWidth={width}
        transitionMs={transitionMs}
        mode={mode}
      />
      {/* Random ambient flyovers — birds in day, bat at night, plus
          occasional falling leaves / fireflies. Sits above the
          backdrop so it parallaxes naturally with the far layer. */}
      <ProfileSceneBirds cardWidth={width} mode={mode} />
      <div
        onClick={bark}
        style={{
          position: 'absolute',
          left: 0,
          // Per-anim downward offset — sitting/lying push the sprite
          // down so empty pixels below the dog body in the sprite
          // frame don't show up as bottom padding inside the card.
          bottom: ANIM_BOTTOM_OFFSET[anim],
          transform: `translateX(${x}px)`,
          width: SPRITE_PX,
          height: SPRITE_PX,
          // Sprite stays above the SVG backdrop.
          zIndex: 1,
          // Transition the slide on its real duration; the bottom
          // offset transitions much faster (80ms) so the per-anim
          // "drop" doesn't read as a separate motion event.
          transition:
            transitionMs > 0
              ? `transform ${transitionMs}ms linear, bottom 80ms ease-out`
              : 'bottom 80ms ease-out',
          // pointerEvents:auto so the dog itself catches the tap
          // (bark) before the scene container's tap handler (toggle).
          pointerEvents: 'auto',
          cursor: 'pointer',
        }}
      >
        <DogSprite anim={anim} facingLeft={facingLeft} scale={SPRITE_SCALE} />
        {/* Bark bubbles — float up from above the dog's head and
            fade out. Multiple stack if the user taps fast. Inside
            the dog wrapper so they ride along with the slide. */}
        {barks.map((b) => (
          <BarkBubbleEl key={b.id} text={b.text} dx={b.dx} />
        ))}
      </div>
    </div>
  );
}

// Pixel-style speech bubble — white card, dark border, tail toward
// the dog's head. Floats up and fades out via CSS keyframes; the
// parent strips it from state when the animation finishes.
function BarkBubbleEl({ text, dx }: { text: string; dx: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: SPRITE_PX / 2,
        // Roughly aligned with the dog's head — top quarter of the
        // sprite frame. Float-up animation lifts it from there.
        top: 24,
        transform: `translateX(calc(-50% + ${dx}px))`,
        pointerEvents: 'none',
      }}
    >
      <style>{`
        @keyframes bark-float {
          0%   { opacity: 0; transform: translateY(8px) scale(0.85); }
          15%  { opacity: 1; transform: translateY(0) scale(1); }
          100% { opacity: 0; transform: translateY(-32px) scale(1); }
        }
      `}</style>
      <div
        style={{
          animation: 'bark-float 1500ms ease-out forwards',
          position: 'relative',
        }}
      >
        <div
          style={{
            background: '#ffffff',
            border: '2px solid #34344a',
            borderRadius: 8,
            padding: '3px 9px',
            fontSize: 12,
            fontWeight: 700,
            color: '#34344a',
            whiteSpace: 'nowrap',
            boxShadow: '0 2px 4px rgba(0,0,0,0.12)',
          }}
        >
          {text}
        </div>
        {/* Tail pointing down toward the dog */}
        <div
          style={{
            position: 'absolute',
            bottom: -6,
            left: '50%',
            marginLeft: -4,
            width: 0,
            height: 0,
            borderLeft: '4px solid transparent',
            borderRight: '4px solid transparent',
            borderTop: '6px solid #34344a',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: -3,
            left: '50%',
            marginLeft: -3,
            width: 0,
            height: 0,
            borderLeft: '3px solid transparent',
            borderRight: '3px solid transparent',
            borderTop: '4px solid #ffffff',
          }}
        />
      </div>
    </div>
  );
}
