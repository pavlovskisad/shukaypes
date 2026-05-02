import { useEffect, useRef, useState } from 'react';
import { balance } from '../constants/balance';
import { useGameStore } from '../stores/gameStore';
import { distanceMeters } from '../utils/geo';
import type { LatLng, FoodItem, Token } from '@shukajpes/shared';

// Detection radius around the USER for "there's something to eat
// nearby." When a paw or bone is inside this circle, the companion
// targets the nearest one and moves toward it instead of idly orbiting.
// Sized so it covers a comfortable two blocks around the walker.
const HUNT_RADIUS_M = 200;

// Pursuit speed cap. Movement per 100ms tick is min(MAX_STEP_M,
// remaining * LERP_TAIL). Lerp shape gives smooth deceleration as
// the companion arrives; the cap prevents the "flash" effect on far
// targets where lerping a percentage of a 100m gap covers tens of
// meters in a single frame.
//   MAX_STEP_M = 0.8 → 8 m/s, decisive dog run, fast enough to close
//                      on items as the walker keeps moving but well
//                      shy of a teleport.
//   LERP_TAIL  = 0.2 → only ever active in the last ~4m, soft stop.
const MAX_STEP_M = 0.8;
const LERP_TAIL = 0.2;

// Distance from the orbit "follow position" below which we consider
// the companion settled into idle. Above this, we're still lerping
// back from a hunt — exposed as mode 'return' so the sprite can show
// the running cycle instead of walking.
const ORBIT_SETTLE_M = 3;

export type CompanionMode = 'idle' | 'hunt' | 'return';

export interface CompanionState {
  pos: LatLng | null;
  mode: CompanionMode;
}

function findNearestTarget(
  userPos: LatLng,
  tokens: Token[],
  food: FoodItem[],
): LatLng | null {
  let best: { d: number; pos: LatLng } | null = null;
  for (const t of tokens) {
    if (t.collectedAt) continue;
    const d = distanceMeters(userPos, t.position);
    if (d > HUNT_RADIUS_M) continue;
    if (!best || d < best.d) best = { d, pos: t.position };
  }
  for (const f of food) {
    const d = distanceMeters(userPos, f.position);
    if (d > HUNT_RADIUS_M) continue;
    if (!best || d < best.d) best = { d, pos: f.position };
  }
  return best?.pos ?? null;
}

function lerpStep(from: LatLng, to: LatLng): LatLng {
  const distM = distanceMeters(from, to);
  if (distM < 0.5) return to;
  const stepM = Math.min(MAX_STEP_M, distM * LERP_TAIL);
  const ratio = stepM / distM;
  return {
    lat: from.lat + (to.lat - from.lat) * ratio,
    lng: from.lng + (to.lng - from.lng) * ratio,
  };
}

// Companion has three modes:
//   - hunt:   a paw or bone is inside HUNT_RADIUS_M of the walker;
//             slide toward it. Auto-collect (uses min(user, companion)
//             distance) eats it on arrival.
//   - return: no prey, but companion is still far from orbit pos —
//             lerp back toward the user's wake. Shows up after a hunt
//             completes far from the user.
//   - idle:   at orbit pos. Original sin-wobble around balance.roamRadius.
//
// Both hunt and return use the same lerp shape; only the target
// differs. The previous version JUMPED to orbit pos when prey left the
// hunt radius, which read as a teleport — now we lerp.
//
// Pauses entirely while the radial menu is open so taps land cleanly.
export function useCompanion(userPos: LatLng | null): CompanionState {
  const [pos, setPos] = useState<LatLng | null>(null);
  const [mode, setMode] = useState<CompanionMode>('idle');
  const angleRef = useRef(Math.random() * Math.PI * 2);
  const targetRef = useRef(angleRef.current);

  useEffect(() => {
    if (!userPos) return;

    const id = setInterval(() => {
      const { menuOpen, tokens, foodItems } = useGameStore.getState();
      if (menuOpen) return;

      const now = Date.now();
      const hunt = findNearestTarget(userPos, tokens, foodItems);

      // Slowly drift the orbit angle in both modes so when we switch
      // back to idle the dog isn't snapped to a stale heading.
      if (Math.random() < 0.005) {
        targetRef.current = Math.random() * Math.PI * 2;
      }
      let diff = targetRef.current - angleRef.current;
      if (diff > Math.PI) diff -= Math.PI * 2;
      if (diff < -Math.PI) diff += Math.PI * 2;
      angleRef.current += diff * 0.02 + Math.sin(now / 3000) * 0.005;
      const roamR =
        balance.roamRadius +
        Math.sin(now / balance.roamRadiusWobblePeriod) * balance.roamRadiusWobble;
      const orbitPos: LatLng = {
        lat: userPos.lat + Math.sin(angleRef.current) * roamR,
        lng: userPos.lng + Math.cos(angleRef.current) * roamR,
      };

      if (hunt) {
        setMode('hunt');
        setPos((prev) => lerpStep(prev ?? userPos, hunt));
        return;
      }

      // No prey — head back to (or stay at) orbit pos.
      setPos((prev) => {
        const from = prev ?? userPos;
        const distToOrbitM = distanceMeters(from, orbitPos);
        setMode(distToOrbitM > ORBIT_SETTLE_M ? 'return' : 'idle');
        return lerpStep(from, orbitPos);
      });
    }, balance.roamTick);

    return () => clearInterval(id);
  }, [userPos?.lat, userPos?.lng]);

  return { pos, mode };
}
