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

export type DogAnim =
  | 'walking'
  | 'sitting'
  | 'running'
  | 'sniffing'
  | 'lying'
  | 'jumping'
  | 'crouched';

interface Sheet {
  url: string;
  frameCount: number;
  // ms per frame. Walking is moderate, running is faster (3-frame
  // cycle blurs by quickly), sniffing is slower (the dog is busy with
  // its nose), sitting is the slowest (idle breathing).
  frameMs: number;
  // Optional fixed frame index. When set, the sprite renders that
  // single frame without cycling. Used for animations where the
  // source sheet is a *transition* into a pose (lying.png is
  // "stand → lay-down" frames; cycling reads as the dog repeatedly
  // standing back up).
  staticFrame?: number;
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
  // Hold the final "fully down" frame instead of cycling — the
  // 4-frame sheet is a transition (stand → lower → mostly-down →
  // fully-down) and looping it reads as the dog popping back up
  // every cycle. Static frame keeps the dog peacefully laid out.
  lying: { url: '/dog/lying.png', frameCount: 4, frameMs: 320, staticFrame: 3 },
  // 6-frame hop cycle. ~110ms/frame matches walking, full cycle ≈
  // 660ms which is about right for one tap-reaction beat.
  jumping: { url: '/dog/jumping.png', frameCount: 6, frameMs: 110 },
  // Source sheet ships 448×55; we pre-pad to 448×64 (9px transparent
  // top strip) so the frame grid stays uniform — see the same trick
  // for sniffing. Treated as a transition into the held crouch and
  // pinned to the last frame, similar to lying.
  crouched: { url: '/dog/crouched.png', frameCount: 7, frameMs: 140, staticFrame: 6 },
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
  // showing a "walking" frame from the wrong sheet. staticFrame skips
  // the interval entirely so the sheet renders a single held pose
  // (used for lying — its source sheet is a transition into the
  // pose, not an idle loop).
  useEffect(() => {
    if (sheet.staticFrame != null) {
      setFrameIdx(sheet.staticFrame);
      return;
    }
    setFrameIdx(0);
    const id = setInterval(() => {
      setFrameIdx((i) => (i + 1) % sheet.frameCount);
    }, sheet.frameMs);
    return () => clearInterval(id);
  }, [anim, sheet.frameCount, sheet.frameMs, sheet.staticFrame]);

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
