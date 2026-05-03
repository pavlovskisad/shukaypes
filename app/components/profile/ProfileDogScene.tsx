import { useEffect, useRef, useState } from 'react';
import { DogSprite, type DogAnim } from '../map/DogSprite';
import { ProfileSceneBackdrop } from './ProfileSceneBackdrop';

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
}

// Sitting is the default idle, lying is rare. Combined with the no-
// repeat guard from bf99b37, lying surfaces ~once every 5-7 beats —
// reads as "the dog occasionally settles for a nap" instead of "lies
// down constantly". User-tuned weights.
const SCENE: SceneEntry[] = [
  { anim: 'sitting', weight: 6, durMs: [4000, 7500], moves: false },
  { anim: 'lying', weight: 1, durMs: [4000, 7000], moves: false },
  { anim: 'sniffing', weight: 2, durMs: [1500, 2800], moves: false },
  { anim: 'walking', weight: 3, durMs: [3000, 5500], moves: true },
  { anim: 'running', weight: 1, durMs: [2000, 3200], moves: true },
];

// Per-anim downward offset — pushes the sprite down inside the
// container so the dog's BODY (not its sprite frame) lands on the
// scene's FRONT_GROUND_Y line. Tuned by eye against each pose's
// actual paw row in its sprite frame; running's mid-leap frames
// will still appear airborne (that's correct for "running"), but
// the on-ground frames sit on the line.
const ANIM_BOTTOM_OFFSET: Record<DogAnim, number> = {
  walking: -27,
  running: -27,
  sniffing: -8,
  sitting: -27,
  lying: -14,
};

const SPRITE_SCALE = 2.5; // 64 × 2.5 = 160 px on screen
const SPRITE_PX = 64 * SPRITE_SCALE;
// Clip the top ~12 source pixels of the sprite frame (which are
// empty for every pose — the dog's body sits in rows 12-60). This
// kills the visual whitespace above the dog without cropping the
// head in walking/running poses.
const HEIGHT_PX = SPRITE_PX - 30;

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

export function ProfileDogScene() {
  const [anim, setAnim] = useState<DogAnim>('sitting');
  const [facingLeft, setFacingLeft] = useState(false);
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
        // Pick a new x that's at least 80px from current — avoids
        // tiny "twitch" moves that look glitchy. Bias toward the
        // farther side of the container so the dog actually crosses
        // the card.
        const minDelta = 80;
        let target = Math.random() * maxX;
        if (Math.abs(target - xRef.current) < minDelta) {
          target = xRef.current < maxX / 2 ? xRef.current + minDelta : xRef.current - minDelta;
          target = Math.max(0, Math.min(maxX, target));
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
        height: HEIGHT_PX,
        // No marginBottom — the dog's "feet" sit flush against the
        // companion-name line below for a tighter hero card. The
        // sprite's empty top region (clipped by HEIGHT_PX) handles
        // the top breathing room.
        marginBottom: -4,
        // Hide overflow so a slide that overshoots doesn't leak past
        // the card edge mid-resize, and so the sprite-top clip
        // (HEIGHT_PX < SPRITE_PX) cuts cleanly.
        overflow: 'hidden',
        pointerEvents: 'none',
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
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          // Per-anim downward offset — sitting/lying push the sprite
          // down so empty pixels below the dog body in the sprite
          // frame don't show up as bottom padding inside the card.
          bottom: ANIM_BOTTOM_OFFSET[anim],
          transform: `translateX(${x}px)`,
          // Sprite stays above the SVG backdrop.
          zIndex: 1,
          // Transition the slide on its real duration; the bottom
          // offset transitions much faster (80ms) so the per-anim
          // "drop" doesn't read as a separate motion event.
          transition:
            transitionMs > 0
              ? `transform ${transitionMs}ms linear, bottom 80ms ease-out`
              : 'bottom 80ms ease-out',
        }}
      >
        <DogSprite anim={anim} facingLeft={facingLeft} scale={SPRITE_SCALE} />
      </div>
    </div>
  );
}
