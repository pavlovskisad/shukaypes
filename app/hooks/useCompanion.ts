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
// remaining * LERP_TAIL) — lerp shape gives smooth deceleration as
// the companion arrives, the cap prevents the "flash" effect on far
// targets where lerping a percentage of a 100m gap covers tens of
// meters in a single frame.
//   MAX_STEP_M = 0.3 → 3 m/s, brisk dog trot, faster than walker.
//   LERP_TAIL  = 0.18 → only ever active in the last ~2m, soft stop.
const MAX_STEP_M = 0.3;
const LERP_TAIL = 0.18;

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

// Companion has two modes:
//   - hunt: when a paw or bone is inside HUNT_RADIUS_M of the walker,
//           slide smoothly toward it. Auto-collect (which uses
//           min(user, companion) distance) eats it on arrival.
//   - idle: the original sin-wobble orbit at balance.roamRadius —
//           keeps the dog "alive" between targets.
// Pauses entirely while the radial menu is open so taps land cleanly.
export function useCompanion(userPos: LatLng | null): LatLng | null {
  const [pos, setPos] = useState<LatLng | null>(null);
  const angleRef = useRef(Math.random() * Math.PI * 2);
  const targetRef = useRef(angleRef.current);

  useEffect(() => {
    if (!userPos) return;

    const id = setInterval(() => {
      const { menuOpen, tokens, foodItems } = useGameStore.getState();
      if (menuOpen) return;

      const now = Date.now();
      const hunt = findNearestTarget(userPos, tokens, foodItems);

      if (hunt) {
        // Slide toward the prey position with a meter-based step so far
        // targets don't flash by in 1-2 ticks. Updates via the functional
        // form so concurrent ticks compose, and moves from the previous
        // companion pos rather than the user pos — real chase visual.
        setPos((prev) => {
          const from = prev ?? userPos;
          const distM = distanceMeters(from, hunt);
          if (distM < 0.5) return hunt;
          const stepM = Math.min(MAX_STEP_M, distM * LERP_TAIL);
          const ratio = stepM / distM;
          return {
            lat: from.lat + (hunt.lat - from.lat) * ratio,
            lng: from.lng + (hunt.lng - from.lng) * ratio,
          };
        });
        return;
      }

      // Idle orbit — original behavior. Random new angle every ~20s.
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
      setPos({
        lat: userPos.lat + Math.sin(angleRef.current) * roamR,
        lng: userPos.lng + Math.cos(angleRef.current) * roamR,
      });
    }, balance.roamTick);

    return () => clearInterval(id);
  }, [userPos?.lat, userPos?.lng]);

  return pos;
}
