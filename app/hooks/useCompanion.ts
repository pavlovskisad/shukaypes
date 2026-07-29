import { useEffect, useRef, useState } from 'react';
import { balance } from '../constants/balance';
import { useGameStore } from '../stores/gameStore';
import { distanceMeters, pointAheadOnRoute } from '../utils/geo';
import type { LatLng, FoodItem, Token } from '@shukajpes/shared';

// Detection radius around the USER for "there's something to eat
// nearby." When a paw or bone is inside this circle, the companion
// targets the nearest one and moves toward it instead of idly orbiting.
// Sized so it covers a comfortable two blocks around the walker.
const HUNT_RADIUS_M = 200;

// Two speed caps. Lerp shape (distance * LERP_TAIL) softens the
// approach for both, but the cap dominates while the dog is far.
//   HUNT_STEP_M = 2.0 → 6.7 m/s, dog jog. Used for chasing prey AND
//                       running back from a finished hunt. Sized so
//                       the SPRITE running/walking transition
//                       (RUN_THRESHOLD_M in Companion.tsx) only fires
//                       during the initial dash phase and the
//                       deceleration tail reads as walking.
//   IDLE_STEP_M = 0.55 → 1.8 m/s, brisk trot. Used for keeping pace
//                       with a walking user from the orbit ring.
// LERP_TAIL = 0.2 only kicks in inside the last ~10m for HUNT and
// ~3m for IDLE; produces a natural deceleration that the sprite picks
// up as a swap from running to walking.
const HUNT_STEP_M = 2.0;
const IDLE_STEP_M = 0.55;
const LERP_TAIL = 0.2;

// Only sprint (running gait) when we're genuinely SEPARATED from where the
// dog should be — a big GPS jump, or coming back from an off-screen pause.
// Everyday roaming + keeping pace with a walking user stays a walk (IDLE_STEP),
// so the frantic running sprite is reserved for hunts and real catch-ups
// instead of firing on every little orbit hop. IDLE_STEP (1.8 m/s) already
// out-paces a normal walker, so the dog keeps up without ever sprinting.
const CATCHUP_M = 28;

// A dog can never be slower than the person it's walking with. Both step
// caps above are absolute — IDLE is 1.8 m/s and even a full run is 6.7 —
// so anyone moving faster than that left the dog permanently trailing,
// drifting further behind every tick and never catching up. That's the
// normal case on a simulated walk (`?simSpeed=8`), and it's reachable on
// a bike or a fast GPS reacquisition too.
//
// So the cap floors at a multiple of how fast the WALKER is actually
// moving, measured from their own position samples. The dog keeps its
// lazy trot when you're strolling and simply matches you when you're not.
const KEEPUP_FACTOR = 1.35;

// Search-mode lead distance: how far AHEAD of the user (along the route) the
// companion positions itself while leading. Enough to read as "follow me,"
// small enough that it never abandons you and paces your walk.
const LEAD_AHEAD_M = 35;

// The companion roams in DISCRETE, SHORT hops: every ROAM_MIN_MS (+ up to
// ROAM_JITTER_MS) it ambles a little way around the orbit ring (a ±ROAM_ARC_MAX
// nudge, not a jump to the far side), then RESTS until the next hop. Short hop
// + long rest = the dog mostly stands/sits near you and only walks a few steps
// now and then, and because the hop is small it's a walk, never a sprint.
const ROAM_MIN_MS = 12000;
const ROAM_JITTER_MS = 14000;
const ROAM_ARC_MAX = 0.35; // radians of arc per hop (~12 m on the ring)

// GOING TO MARK. The idle ring is only ~21-33 m out, which on screen puts
// the dog nearly on top of the walker's own GPS dot — so a mark placed at
// the dog's feet looked like the HUMAN had made it, which is the one thing
// the whole mechanic must not read as.
//
// When the server says the dog is due (state.companion.markReady), it
// heads out to this much wider ring, finds its spot, marks, and comes back
// once the cooldown restarts. The trip is what makes the claim legibly the
// dog's.
//
// Sized against the two server rules it has to live inside: comfortably
// past the 140 m minimum spacing is impossible from a ring this size
// alone, but the walker's own movement supplies the rest — and well under
// the 160 m the server allows between walker and dog, so an excursion
// never gets its mark rejected as an implausible offset.
const MARK_RING_M = 90;

// To stop the dog "walking in place" from GPS jitter while the user stands
// still, the orbit CENTRE follows the user's live position only while they're
// actually moving (drifted > MOVE_THRESHOLD_M within STILL_AFTER_MS). Once
// still it holds fixed, so the dog roams around a stable point and rests
// cleanly between hops instead of chasing GPS noise.
const MOVE_THRESHOLD_M = 6;
const STILL_AFTER_MS = 3000;

// Time after any collect (auto, forced, by user or companion) where
// the dog ignores fresh hunt targets and just returns/sits. Without
// this, a parked user with several paws in the 90-200m ring keeps the
// dog in a continuous hunt loop — chases one, collects, immediately
// chases the next. The cooldown forces a beat between hunts so the
// dog visibly returns and settles. Doesn't apply to the very first
// hunt at session start (cooldownUntilRef defaults to 0).
//
// Plus a randomised "long rest" — every Nth cooldown gets stretched
// to LONG_REST_MS so the dog occasionally takes a real break instead
// of sprinting again the moment the timer runs out. Reads as the
// dog being content to sit with you sometimes, not always
// hyper-focused on the next paw.
const HUNT_COOLDOWN_MS = 8000;
const LONG_REST_MS = 25000;
const LONG_REST_PROBABILITY = 0.4;

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
  // Tracks the last gameStore.collectPulse we saw so we can detect
  // bumps inside the interval and start a fresh cooldown. Init to -1
  // so the first observed value (always 0 on a fresh store) doesn't
  // count as a collect.
  const lastCollectPulseRef = useRef<number>(-1);
  const cooldownUntilRef = useRef<number>(0);
  // Idle-roam bookkeeping: the orbit centre the dog roams around (held steady
  // while the user is still), the last position counted as a real user move +
  // when it happened, and when the next discrete roam hop is due.
  const centerRef = useRef<LatLng | null>(null);
  const moveAnchorRef = useRef<LatLng | null>(null);
  const lastMoveAtRef = useRef<number>(0);
  // Walker speed in m/s, smoothed, measured from consecutive positions —
  // the dog's step cap floors on this so it can always keep up.
  const walkerSpeedRef = useRef<number>(0);
  const lastSampleRef = useRef<{ pos: LatLng; at: number } | null>(null);
  const nextRoamAtRef = useRef<number>(0);
  // Edge-detect "due to mark" so the trip out starts on the transition
  // rather than being re-triggered every tick it stays true.
  const wasMarkReadyRef = useRef(false);

  useEffect(() => {
    if (!userPos || !enabled) return;

    // Real user movement vs GPS jitter: the anchor only resets when the user
    // drifts past MOVE_THRESHOLD_M, and lastMoveAt marks that moment — so a
    // parked user's GPS wander never counts as walking.
    const moveAnchor = moveAnchorRef.current;
    if (!moveAnchor || distanceMeters(moveAnchor, userPos) > MOVE_THRESHOLD_M) {
      moveAnchorRef.current = userPos;
      lastMoveAtRef.current = Date.now();
    }

    // Smoothed walker speed. Exponential so one jumpy GPS fix doesn't send
    // the dog sprinting, and so it decays back down when you stop.
    const nowSample = Date.now();
    const prevSample = lastSampleRef.current;
    if (prevSample) {
      const dt = (nowSample - prevSample.at) / 1000;
      if (dt > 0.05) {
        const v = distanceMeters(prevSample.pos, userPos) / dt;
        walkerSpeedRef.current = walkerSpeedRef.current * 0.6 + Math.min(30, v) * 0.4;
      }
    }
    lastSampleRef.current = { pos: userPos, at: nowSample };

    const id = setInterval(() => {
      const {
        menuOpen,
        tokens,
        foodItems,
        collectPulse,
        dogCam,
        searchTarget,
        searchRoute,
        markReady,
      } = useGameStore.getState();
      if (menuOpen) return;

      const now = Date.now();

      // Sniff-and-lead search mode: the dog LEADS you along the route toward the
      // spot — it heads to a point LEAD_AHEAD_M further along the route than you
      // currently are, so it stays in front and PACES you (advancing as you
      // advance) instead of sprinting off to the destination and abandoning you.
      // A resting user → the lead point holds a set distance ahead → the dog
      // waits there (MapView barks encouragement).
      if (dogCam && searchTarget) {
        const route =
          searchRoute && searchRoute.length >= 2
            ? searchRoute
            : [userPos, searchTarget.spot];
        const goal = pointAheadOnRoute(route, userPos, LEAD_AHEAD_M);
        setPos((prev) => lerpStep(prev ?? userPos, goal, HUNT_STEP_M));
        return;
      }

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
        // Roll for a long rest — most cooldowns are the standard
        // HUNT_COOLDOWN_MS; LONG_REST_PROBABILITY of them stretch out
        // so the dog occasionally takes a real breather instead of
        // sprinting again the second the cooldown ends.
        const restMs =
          Math.random() < LONG_REST_PROBABILITY ? LONG_REST_MS : HUNT_COOLDOWN_MS;
        cooldownUntilRef.current = now + restMs;
      }

      const hunt = now < cooldownUntilRef.current
        ? null
        : findNearestTarget(userPos, tokens, foodItems);

      // Orbit centre: follow the user's live position while they're actually
      // walking; hold it fixed once they're still, so GPS jitter doesn't drag
      // the dog around (which read as "walking in place").
      const userMoving = now - lastMoveAtRef.current < STILL_AFTER_MS;
      if (userMoving || !centerRef.current) centerRef.current = userPos;
      const center = centerRef.current ?? userPos;

      // Discrete roam: every few seconds pick a fresh spot on the orbit ring.
      // Between hops the angle is unchanged, so once the dog reaches its spot it
      // stops and the sprite settles to sitting — the walk cycle only plays
      // while it's actually travelling (to the next spot, or keeping pace with
      // a walking user). No continuous drift/wobble → no walking in place.
      // The moment the dog becomes due to mark, send it off in a fresh
      // direction instead of letting it finish the current rest — the trip
      // out is the part that reads as "it's going to find a spot", and
      // waiting up to 26s for the next hop would swallow it.
      if (markReady && !wasMarkReadyRef.current) {
        angleRef.current = Math.random() * Math.PI * 2;
        nextRoamAtRef.current = now + ROAM_MIN_MS;
      }
      wasMarkReadyRef.current = markReady;

      if (now >= nextRoamAtRef.current) {
        // Amble a short, random arc around the ring — either direction, and
        // sometimes barely at all — so it reads as an organic shuffle rather
        // than a fixed mechanical step. On the wide marking ring the same
        // arc covers more ground, which reads as casting about for a spot.
        angleRef.current += (Math.random() - 0.5) * 2 * ROAM_ARC_MAX;
        nextRoamAtRef.current =
          now + ROAM_MIN_MS + Math.random() * ROAM_JITTER_MS;
      }
      // Due to mark? Swing out to the wide ring and stay there until the
      // server takes the mark (which restarts the cooldown and clears
      // this), so the claim visibly comes from the dog rather than from
      // under the walker's feet. The ring still tracks the walker, so a
      // dog that's gone looking never falls outside the offset the server
      // will accept — it ranges wide, it doesn't get left behind.
      const ringM = markReady ? MARK_RING_M : null;
      const orbitPos: LatLng = ringM
        ? {
            lat: center.lat + (ringM * Math.sin(angleRef.current)) / 110540,
            lng:
              center.lng +
              (ringM * Math.cos(angleRef.current)) /
                (111320 * Math.cos((center.lat * Math.PI) / 180)),
          }
        : {
            lat: center.lat + Math.sin(angleRef.current) * balance.roamRadius,
            lng: center.lng + Math.cos(angleRef.current) * balance.roamRadius,
          };

      if (hunt) {
        setPos((prev) => lerpStep(prev ?? userPos, hunt, HUNT_STEP_M));
        return;
      }

      // No prey — amble to (or rest at) the orbit spot. Walk (IDLE_STEP) for
      // everyday roaming + keeping pace; only break into a run if we're really
      // far behind (CATCHUP_M). Spawn straight at the orbit spot so there's no
      // startup dash across the screen.
      setPos((prev) => {
        const from = prev ?? orbitPos;
        const distToOrbitM = distanceMeters(from, orbitPos);
        // Per-tick metres the walker is covering, plus a margin so the dog
        // gains rather than merely holding station.
        const keepUp =
          (walkerSpeedRef.current * KEEPUP_FACTOR * balance.roamTick) / 1000;
        const base = distToOrbitM > CATCHUP_M ? HUNT_STEP_M : IDLE_STEP_M;
        return lerpStep(from, orbitPos, Math.max(base, keepUp));
      });
    }, balance.roamTick);

    return () => clearInterval(id);
  }, [userPos?.lat, userPos?.lng, enabled]);

  return pos;
}
