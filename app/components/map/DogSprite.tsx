import { useEffect, useState } from 'react';

// Pixel-art companion sprite. White-with-spots dog from the
// "8-Bit Dogs" pack by 14collective (free for commercial use, no
// attribution required — README in the original RAR).
//
// Sheets live in /public/dog/ so they're served as plain static URLs
// (bypassing Metro's asset pipeline). Each sheet is a horizontal strip
// of 64×64 frames, all facing right.
//
// We render at 2× nominal so the dog reads on the map at zoom 16
// without going so big that it eats neighbouring tiles. The container
// is positioned so its anchor (the dog's paws) sits on the actual
// companionPos lat/lng — feet on the ground, head looks "above" it.
//
// Direction: the sheets only have one perspective (side view facing
// right). For movement to the left we flip horizontally via
// scaleX(-1). North/south movement reuses the most-recent horizontal
// facing — top-down movement on a map doesn't have a "front view" and
// trying to fake one with a rotation looks worse than letting the dog
// slide while still facing east/west.

export type DogAnim = 'walking' | 'sitting' | 'running' | 'sniffing' | 'lying';

interface Sheet {
  url: string;
  frameCount: number;
  // ms per frame. Walking is moderate, running is faster (3-frame
  // cycle blurs by quickly), sniffing is slower (the dog is busy with
  // its nose), sitting is the slowest (idle breathing).
  frameMs: number;
}

const FRAME_PX = 64;

const SHEETS: Record<DogAnim, Sheet> = {
  walking: { url: '/dog/walking.png', frameCount: 7, frameMs: 110 },
  sitting: { url: '/dog/sitting.png', frameCount: 5, frameMs: 220 },
  running: { url: '/dog/running.png', frameCount: 3, frameMs: 80 },
  // The original Sniffing.png is 512×55 (top whitespace trimmed).
  // We pre-pad it to 512×64 with a transparent 9px top strip so the
  // frame grid stays uniform — see scripts in the PR description.
  sniffing: { url: '/dog/sniffing.png', frameCount: 8, frameMs: 140 },
  // Deep idle — the dog has been sitting long enough that it
  // settles down. Slowest cycle so it reads as "asleep" not "I'm
  // watching every leaf move". Companion swaps to this after
  // LYING_DELAY_MS of continuous sitting.
  lying: { url: '/dog/lying.png', frameCount: 4, frameMs: 320 },
};

interface DogSpriteProps {
  anim: DogAnim;
  // True when the dog should face left. The sheet is inherently
  // right-facing, so we flip via CSS instead of maintaining a second
  // copy of every animation.
  facingLeft: boolean;
  // Multiplier on the 64px native frame size. 2 = 128px on screen,
  // which is roughly the right presence at our 16+ map zoom.
  scale?: number;
}

export function DogSprite({ anim, facingLeft, scale = 2 }: DogSpriteProps) {
  const sheet = SHEETS[anim];
  const [frameIdx, setFrameIdx] = useState(0);

  // Restart the frame counter on anim swap so we don't blink mid-cycle
  // showing a "walking" frame from the wrong sheet.
  useEffect(() => {
    setFrameIdx(0);
    const id = setInterval(() => {
      setFrameIdx((i) => (i + 1) % sheet.frameCount);
    }, sheet.frameMs);
    return () => clearInterval(id);
  }, [anim, sheet.frameCount, sheet.frameMs]);

  const size = FRAME_PX * scale;

  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${sheet.url})`,
        backgroundRepeat: 'no-repeat',
        // Each frame is FRAME_PX wide; we shift left by frame*FRAME_PX
        // (in source pixels) and let backgroundSize scale the whole
        // strip up by `scale` so positioning math stays in source-px.
        backgroundPosition: `-${frameIdx * FRAME_PX * scale}px 0`,
        backgroundSize: `${sheet.frameCount * size}px ${size}px`,
        // imageRendering: pixelated keeps the 8-bit edges crisp at 2×.
        // Without this, browsers smooth-scale and the dog turns into a
        // blurry beige smudge.
        imageRendering: 'pixelated',
        transform: facingLeft ? 'scaleX(-1)' : undefined,
        pointerEvents: 'none',
      }}
    />
  );
}
