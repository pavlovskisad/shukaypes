import { useEffect, useRef, useState } from 'react';
import type { SceneMode } from './ProfileSceneBackdrop';

// Random ambient flyovers / drops over the dog scene. Each "event" is
// a small sprite that crosses the scene once and is then removed.
// Examples:
//   day:   flock of birds (2-4 "v"s drifting across the sky), single
//          butterfly bobbing through the foreground, a leaf falling.
//   night: a bat zigzagging across the moon, fireflies blinking around
//          the lamppost, a falling star.
//
// Keeps the scene from feeling static during the long sit/lie beats
// without being so noisy you stare at it instead of the dog. One event
// fires every 6-14 seconds; only one runs at a time so events don't
// pile up.

interface BirdsProps {
  cardWidth: number;
  mode: SceneMode;
}

type EventKind =
  | 'birdFlock'
  | 'butterfly'
  | 'leaf'
  | 'bat'
  | 'firefly'
  | 'shootingStar';

interface ActiveEvent {
  id: number;
  kind: EventKind;
  // ms total duration the event takes to cross / fall.
  durMs: number;
  // Random seed for sub-element placement (so a flock has different
  // bird positions every time).
  seed: number;
  // Optional starting Y offset within the scene (for variety).
  yOffset: number;
  // True = enter from right, drift left. False = left-to-right.
  reverse: boolean;
}

// Per-mode event pool. Weights bias what shows up; durMs is the
// flyover duration in ms.
const EVENT_POOL: Record<SceneMode, { kind: EventKind; weight: number; durMs: [number, number] }[]> = {
  day: [
    { kind: 'birdFlock', weight: 5, durMs: [4500, 7000] },
    { kind: 'butterfly', weight: 2, durMs: [5500, 8000] },
    { kind: 'leaf', weight: 2, durMs: [4000, 6500] },
  ],
  night: [
    { kind: 'bat', weight: 3, durMs: [4500, 7000] },
    { kind: 'firefly', weight: 4, durMs: [5000, 8000] },
    { kind: 'shootingStar', weight: 1, durMs: [900, 1300] },
  ],
};

function pickEvent(mode: SceneMode): ActiveEvent {
  const pool = EVENT_POOL[mode];
  const total = pool.reduce((s, e) => s + e.weight, 0);
  let r = Math.random() * total;
  let chosen = pool[0]!;
  for (const e of pool) {
    r -= e.weight;
    if (r <= 0) {
      chosen = e;
      break;
    }
  }
  const dur = chosen.durMs[0] + Math.random() * (chosen.durMs[1] - chosen.durMs[0]);
  return {
    id: Math.random(),
    kind: chosen.kind,
    durMs: dur,
    seed: Math.random(),
    yOffset: Math.random(),
    reverse: Math.random() < 0.5,
  };
}

export function ProfileSceneBirds({ cardWidth, mode }: BirdsProps) {
  const [event, setEvent] = useState<ActiveEvent | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    if (cardWidth === 0) return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = (delayMs: number) => {
      timer = setTimeout(() => {
        const ev = pickEvent(modeRef.current);
        setEvent(ev);
        // Clear after the event finishes, then schedule the next one.
        timer = setTimeout(() => {
          setEvent(null);
          schedule(6000 + Math.random() * 8000);
        }, ev.durMs);
      }, delayMs);
    };

    // First event lands a few seconds in so users don't see it during
    // the initial render flash.
    schedule(2500 + Math.random() * 4000);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [cardWidth]);

  if (!event || cardWidth === 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 1, // above backdrop, behind dog (dog is also z-1 but later in DOM)
      }}
      aria-hidden
    >
      <EventSprite event={event} cardWidth={cardWidth} />
    </div>
  );
}

function EventSprite({ event, cardWidth }: { event: ActiveEvent; cardWidth: number }) {
  switch (event.kind) {
    case 'birdFlock':
      return <BirdFlock event={event} cardWidth={cardWidth} />;
    case 'butterfly':
      return <Butterfly event={event} cardWidth={cardWidth} />;
    case 'leaf':
      return <Leaf event={event} cardWidth={cardWidth} />;
    case 'bat':
      return <Bat event={event} cardWidth={cardWidth} />;
    case 'firefly':
      return <Firefly event={event} cardWidth={cardWidth} />;
    case 'shootingStar':
      return <ShootingStar event={event} cardWidth={cardWidth} />;
  }
}

// Tiny "v" silhouette in pure pixel rectangles. Two colours so it
// reads at distance even against a sky tint.
function BirdGlyph({ size = 1, color = '#34344a' }: { size?: number; color?: string }) {
  const u = 2 * size;
  return (
    <div
      style={{
        position: 'relative',
        width: 7 * u,
        height: 3 * u,
        imageRendering: 'pixelated' as const,
      }}
    >
      <div style={{ position: 'absolute', left: 0, top: u, width: u, height: u, background: color }} />
      <div style={{ position: 'absolute', left: u, top: 0, width: u, height: u, background: color }} />
      <div style={{ position: 'absolute', left: 2 * u, top: u, width: u, height: u, background: color }} />
      <div style={{ position: 'absolute', left: 3 * u, top: 2 * u, width: u, height: u, background: color }} />
      <div style={{ position: 'absolute', left: 4 * u, top: u, width: u, height: u, background: color }} />
      <div style={{ position: 'absolute', left: 5 * u, top: 0, width: u, height: u, background: color }} />
      <div style={{ position: 'absolute', left: 6 * u, top: u, width: u, height: u, background: color }} />
    </div>
  );
}

function BirdFlock({ event, cardWidth }: { event: ActiveEvent; cardWidth: number }) {
  // 2-4 birds at staggered offsets, all moving in the same direction.
  const count = 2 + Math.floor(event.seed * 3);
  const baseY = 14 + event.yOffset * 30;
  const startX = event.reverse ? cardWidth + 80 : -80;
  const endX = event.reverse ? -80 : cardWidth + 80;
  const animName = `birds-${event.id.toString().slice(2, 8)}`;
  return (
    <>
      <style>{`@keyframes ${animName} { from { transform: translateX(${startX}px); } to { transform: translateX(${endX}px); } }`}</style>
      <div
        style={{
          position: 'absolute',
          top: baseY,
          left: 0,
          animation: `${animName} ${event.durMs}ms linear forwards`,
        }}
      >
        {Array.from({ length: count }).map((_, i) => {
          const dy = (i % 2 === 0 ? 1 : -1) * (3 + (i * 5) % 11);
          const dx = i * 14 + (i % 2) * 6;
          return (
            <div
              key={i}
              style={{ position: 'absolute', left: dx, top: dy }}
            >
              <BirdGlyph size={1} />
            </div>
          );
        })}
      </div>
    </>
  );
}

function Butterfly({ event, cardWidth }: { event: ActiveEvent; cardWidth: number }) {
  const baseY = 70 + event.yOffset * 50;
  const startX = event.reverse ? cardWidth + 30 : -30;
  const endX = event.reverse ? -30 : cardWidth + 30;
  const animName = `bf-${event.id.toString().slice(2, 8)}`;
  const flapName = `bff-${event.id.toString().slice(2, 8)}`;
  const bobName = `bfb-${event.id.toString().slice(2, 8)}`;
  return (
    <>
      <style>{`
        @keyframes ${animName} { from { transform: translateX(${startX}px); } to { transform: translateX(${endX}px); } }
        @keyframes ${bobName} { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-12px); } }
        @keyframes ${flapName} { 0%,100% { transform: scaleX(1); } 50% { transform: scaleX(0.4); } }
      `}</style>
      <div
        style={{
          position: 'absolute',
          top: baseY,
          left: 0,
          animation: `${animName} ${event.durMs}ms linear forwards`,
        }}
      >
        <div style={{ animation: `${bobName} 700ms ease-in-out infinite` }}>
          <div
            style={{
              animation: `${flapName} 220ms ease-in-out infinite`,
              imageRendering: 'pixelated' as const,
              width: 10,
              height: 8,
              position: 'relative',
            }}
          >
            <div style={{ position: 'absolute', left: 0, top: 1, width: 4, height: 6, background: '#e07a3a' }} />
            <div style={{ position: 'absolute', left: 6, top: 1, width: 4, height: 6, background: '#e07a3a' }} />
            <div style={{ position: 'absolute', left: 4, top: 0, width: 2, height: 8, background: '#34344a' }} />
          </div>
        </div>
      </div>
    </>
  );
}

function Leaf({ event, cardWidth }: { event: ActiveEvent; cardWidth: number }) {
  const startX = 30 + event.seed * (cardWidth - 60);
  const fallName = `lf-${event.id.toString().slice(2, 8)}`;
  const swayName = `lfs-${event.id.toString().slice(2, 8)}`;
  const driftPx = (event.seed - 0.5) * 80;
  return (
    <>
      <style>{`
        @keyframes ${fallName} {
          from { transform: translate(0, -10px) rotate(0deg); }
          to   { transform: translate(${driftPx}px, 200px) rotate(540deg); }
        }
        @keyframes ${swayName} { 0%,100% { transform: translateX(0); } 50% { transform: translateX(10px); } }
      `}</style>
      <div
        style={{
          position: 'absolute',
          left: startX,
          top: 0,
          animation: `${fallName} ${event.durMs}ms linear forwards`,
        }}
      >
        <div style={{ animation: `${swayName} 1200ms ease-in-out infinite` }}>
          <div
            style={{
              imageRendering: 'pixelated' as const,
              width: 6,
              height: 6,
              position: 'relative',
            }}
          >
            <div style={{ position: 'absolute', left: 1, top: 0, width: 4, height: 2, background: '#c97a2c' }} />
            <div style={{ position: 'absolute', left: 0, top: 2, width: 6, height: 2, background: '#d68a3a' }} />
            <div style={{ position: 'absolute', left: 1, top: 4, width: 4, height: 2, background: '#a55d1f' }} />
          </div>
        </div>
      </div>
    </>
  );
}

function Bat({ event, cardWidth }: { event: ActiveEvent; cardWidth: number }) {
  const baseY = 18 + event.yOffset * 26;
  const startX = event.reverse ? cardWidth + 60 : -60;
  const endX = event.reverse ? -60 : cardWidth + 60;
  const animName = `bt-${event.id.toString().slice(2, 8)}`;
  const zigName = `btz-${event.id.toString().slice(2, 8)}`;
  return (
    <>
      <style>{`
        @keyframes ${animName} { from { transform: translateX(${startX}px); } to { transform: translateX(${endX}px); } }
        @keyframes ${zigName} { 0%,100% { transform: translateY(0); } 25% { transform: translateY(-10px); } 75% { transform: translateY(10px); } }
      `}</style>
      <div
        style={{
          position: 'absolute',
          top: baseY,
          left: 0,
          animation: `${animName} ${event.durMs}ms linear forwards`,
        }}
      >
        <div style={{ animation: `${zigName} 600ms ease-in-out infinite` }}>
          <div
            style={{
              imageRendering: 'pixelated' as const,
              width: 14,
              height: 6,
              position: 'relative',
            }}
          >
            <div style={{ position: 'absolute', left: 0, top: 2, width: 2, height: 2, background: '#2a2a3a' }} />
            <div style={{ position: 'absolute', left: 2, top: 0, width: 2, height: 2, background: '#2a2a3a' }} />
            <div style={{ position: 'absolute', left: 4, top: 2, width: 2, height: 2, background: '#2a2a3a' }} />
            <div style={{ position: 'absolute', left: 6, top: 2, width: 2, height: 4, background: '#2a2a3a' }} />
            <div style={{ position: 'absolute', left: 8, top: 2, width: 2, height: 2, background: '#2a2a3a' }} />
            <div style={{ position: 'absolute', left: 10, top: 0, width: 2, height: 2, background: '#2a2a3a' }} />
            <div style={{ position: 'absolute', left: 12, top: 2, width: 2, height: 2, background: '#2a2a3a' }} />
          </div>
        </div>
      </div>
    </>
  );
}

function Firefly({ event, cardWidth }: { event: ActiveEvent; cardWidth: number }) {
  // Bobs near the lamppost (mid layer x=160 in the 360-wide viewBox);
  // map that into the card-width coordinate space.
  const lampScreenX = (160 / 360) * cardWidth;
  const startX = lampScreenX + (event.seed - 0.5) * 40;
  const baseY = 110 + event.yOffset * 60; // around the bench / lamp glow
  const animName = `ff-${event.id.toString().slice(2, 8)}`;
  const blinkName = `ffb-${event.id.toString().slice(2, 8)}`;
  const dx = (event.reverse ? -1 : 1) * 30;
  return (
    <>
      <style>{`
        @keyframes ${animName} {
          0%   { transform: translate(0, 0); }
          25%  { transform: translate(${dx}px, -20px); }
          50%  { transform: translate(${dx * 2}px, 0px); }
          75%  { transform: translate(${dx * 1.5}px, 20px); }
          100% { transform: translate(${dx * 2}px, 0px); opacity: 0; }
        }
        @keyframes ${blinkName} { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }
      `}</style>
      <div
        style={{
          position: 'absolute',
          left: startX,
          top: baseY,
          animation: `${animName} ${event.durMs}ms ease-in-out forwards`,
        }}
      >
        <div
          style={{
            width: 3,
            height: 3,
            background: '#fff7a0',
            boxShadow: '0 0 6px 2px rgba(255, 247, 160, 0.6)',
            animation: `${blinkName} 600ms ease-in-out infinite`,
          }}
        />
      </div>
    </>
  );
}

function ShootingStar({ event, cardWidth }: { event: ActiveEvent; cardWidth: number }) {
  const startX = event.reverse ? cardWidth - 20 : 20;
  const startY = 5 + event.yOffset * 15;
  const dx = event.reverse ? -160 : 160;
  const dy = 50;
  const animName = `ss-${event.id.toString().slice(2, 8)}`;
  return (
    <>
      <style>{`
        @keyframes ${animName} {
          0%   { transform: translate(0, 0); opacity: 0; }
          15%  { opacity: 1; }
          85%  { opacity: 1; }
          100% { transform: translate(${dx}px, ${dy}px); opacity: 0; }
        }
      `}</style>
      <div
        style={{
          position: 'absolute',
          left: startX,
          top: startY,
          width: 18,
          height: 2,
          background: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.9) 100%)',
          transform: `rotate(${event.reverse ? 200 : 20}deg)`,
          transformOrigin: 'right center',
          animation: `${animName} ${event.durMs}ms linear forwards`,
        }}
      />
    </>
  );
}
