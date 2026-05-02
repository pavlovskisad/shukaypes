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

// Two speed caps. Lerp shape (distance * LERP_TAIL) softens the
// approach for both, but the cap dominates while the dog is far.
//   HUNT_STEP_M = 3.0 → 30 m/s, real-dog full-burst sprint. Used for
//                       chasing prey AND running back from a finished
//                       hunt — both are "I am closing distance fast"
//                       moments. Sized so the SPRITE running/walking
//                       transition (RUN_THRESHOLD_M in Companion.tsx)
//                       only fires during the initial sprint phase
//                       and the deceleration tail reads as walking.
//   IDLE_STEP_M = 0.8 → 8 m/s, decisive trot. Used for keeping pace
//                       with a walking user from the orbit ring.
// LERP_TAIL = 0.2 only kicks in inside the last ~15m for HUNT and
// ~4m for IDLE; produces a natural deceleration that the sprite picks
// up as a swap from running to walking.
const HUNT_STEP_M = 3.0;
const IDLE_STEP_M = 0.8;
const LERP_TAIL = 0.2;

// Distance from the orbit "follow position" below which we stop
// sprinting and just keep pace with the user. Above this we treat the
// situation as "we got separated" and sprint home at HUNT_STEP_M.
const ORBIT_SETTLE_M = 3;

// Time after any collect (auto, forced, by user or companion) where
// the dog ignores fresh hunt targets and just returns/sits. Without
// this, a parked user with several paws in the 90-200m ring keeps the
// dog in a continuous hunt loop — chases one, collects, immediately
// chases the next. The cooldown forces a beat between hunts so the
// dog visibly returns and settles. Doesn't apply to the very first
// hunt at session start (cooldownUntilRef defaults to 0).
const HUNT_COOLDOWN_MS = 5000;

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

function lerpStep(from: LatLng, to: LatLng, maxStepM: number): LatLng {
  const distM = distanceMeters(from, to);
  if (distM < 0.5) return to;
  const stepM = Math.min(maxStepM, distM * LERP_TAIL);
  const ratio = stepM / distM;
  return {
    lat: from.lat + (to.lat - from.lat) * ratio,
    lng: from.lng + (to.lng - from.lng) * ratio,
  };
}

// Companion has three contexts internally:
//   - hunt:   a paw or bone is inside HUNT_RADIUS_M of the walker.
//             Sprint at HUNT_STEP_M toward it. Auto-collect (uses
//             min(user, companion) distance) eats it on arrival.
//   - return: no prey, but companion is still > ORBIT_SETTLE_M from
//             orbit pos — sprint back at HUNT_STEP_M.
//   - idle:   close to orbit pos. Trot at IDLE_STEP_M to keep pace
//             with a walking user.
//
// We don't expose this distinction to the consumer — the sprite
// machinery in Companion.tsx derives running vs walking vs sitting
// purely from the observed velocity, so the lerp tail's natural
// deceleration as the dog approaches its target produces the running
// → walking sprite swap automatically.
//
// Pauses entirely while the radial menu is open so taps land cleanly.
// The `enabled` flag (driven by useIsFocused in MapView) pauses the
// lerp tick while the map tab isn't focused — burning CPU on
// off-screen movement is wasteful, and the dog visibly resumes from
// its last position on refocus because pos state lives across the
// pause.
export function useCompanion(userPos: LatLng | null, enabled = true): LatLng | null {
  const [pos, setPos] = useState<LatLng | null>(null);
  const angleRef = useRef(Math.random() * Math.PI * 2);
  const targetRef = useRef(angleRef.current);
  // Tracks the last gameStore.collectPulse we saw so we can detect
  // bumps inside the interval and start a fresh cooldown. Init to -1
  // so the first observed value (always 0 on a fresh store) doesn't
  // count as a collect.
  const lastCollectPulseRef = useRef<number>(-1);
  const cooldownUntilRef = useRef<number>(0);

  useEffect(() => {
    if (!userPos || !enabled) return;

    const id = setInterval(() => {
      const { menuOpen, tokens, foodItems, collectPulse } = useGameStore.getState();
      if (menuOpen) return;

      const now = Date.now();

      // Detect a collect since last tick → start hunt cooldown. After
      // any collect (auto, companion, or forced tap) we ignore fresh
      // hunt targets for HUNT_COOLDOWN_MS so the dog returns to the
      // user and visibly settles instead of chaining hunts back-to-
      // back. Init guard (-1) keeps the very first observation from
      // counting as a collect.
      if (lastCollectPulseRef.current < 0) {
        lastCollectPulseRef.current = collectPulse;
      } else if (collectPulse !== lastCollectPulseRef.current) {
        lastCollectPulseRef.current = collectPulse;
        cooldownUntilRef.current = now + HUNT_COOLDOWN_MS;
      }

      const hunt = now < cooldownUntilRef.current
        ? null
        : findNearestTarget(userPos, tokens, foodItems);

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
        setPos((prev) => lerpStep(prev ?? userPos, hunt, HUNT_STEP_M));
        return;
      }

      // No prey — head back to (or stay at) orbit pos. Sprint while
      // we're far from where the user wants us; gentle trot once
      // we're close enough to be just "following alongside".
      setPos((prev) => {
        const from = prev ?? userPos;
        const distToOrbitM = distanceMeters(from, orbitPos);
        const stepCap = distToOrbitM > ORBIT_SETTLE_M ? HUNT_STEP_M : IDLE_STEP_M;
        return lerpStep(from, orbitPos, stepCap);
      });
    }, balance.roamTick);

    return () => clearInterval(id);
  }, [userPos?.lat, userPos?.lng, enabled]);

  return pos;
}
