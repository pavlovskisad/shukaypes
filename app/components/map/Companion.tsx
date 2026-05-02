import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { OverlayViewF, FLOAT_PANE } from '@react-google-maps/api';
import { useGameStore } from '../../stores/gameStore';
import { SpeechBubble } from '../ui/SpeechBubble';
import {
  RadialMenu,
  PRIMARY_ACTIONS,
  WALK_SHAPE_ACTIONS,
  WALK_DISTANCE_ACTIONS,
  VISIT_CATEGORY_ACTIONS,
  type RadialAction,
} from './RadialMenu';
import type { LatLng } from '@shukajpes/shared';
import { distanceMeters } from '../../utils/geo';
import type { SpotCategory, Spot } from '../../services/places';
import { fetchWalkingRoute } from '../../services/directions';
import {
  buildCandidates,
  planWalk,
  type WalkDistance,
  type WalkShape,
} from '../../utils/walk';
import { DogSprite, type DogAnim } from './DogSprite';

const VISIT_LEAVES_PER_CATEGORY = 3;

// Resolves the actions for the current menu level. Path is a stack of
// branch ids ('walk', 'walk:roundtrip', etc). Empty = root.
function getCurrentActions(
  path: string[],
  spots: Spot[],
  userPos: LatLng | null,
): RadialAction[] {
  const head = path[0];
  if (!head) return PRIMARY_ACTIONS;
  if (head === 'walk') {
    if (path.length === 1) return WALK_SHAPE_ACTIONS;
    // path[1] is 'walk:roundtrip' or 'walk:oneway'; rewrite the leaf
    // ids to encode the full shape:distance combo so the handler can
    // dispatch on a single string.
    const shape = path[1]!.replace('walk:', ''); // 'roundtrip' | 'oneway'
    return WALK_DISTANCE_ACTIONS.map((a) => ({
      ...a,
      id: `walk:${shape}${a.id}`, // a.id starts with ':', e.g. ':close'
    }));
  }
  if (head === 'visit') {
    if (path.length === 1) return VISIT_CATEGORY_ACTIONS;
    if (!userPos) return [];
    const category = path[1]!.replace('visit:', '') as SpotCategory;
    return spots
      .filter((s) => s.category === category)
      .map((s) => ({ s, d: distanceMeters(userPos, s.position) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, VISIT_LEAVES_PER_CATEGORY)
      .map(({ s }) => ({
        id: `visit:spot:${s.id}`,
        icon: s.icon ?? '📍',
        label: s.name.slice(0, 16),
      }));
  }
  return PRIMARY_ACTIONS;
}


interface CompanionProps {
  position: LatLng;
  bubble: string | null;
  onTapCompanion?: () => void;
  // Fires on EVERY tap (open and close), before the menu state changes.
  // Parent uses it to record a timestamp and suppress the map-level
  // onClick that Google Maps fires independently of DOM event flow —
  // without this, low-zoom taps open the menu and immediately close it.
  onTap?: () => void;
}

// Companion overlay — float keyframe, tap-to-open radial menu. All children
// (bubble, menu) live inside this OverlayView div so they move with the map
// (demo's floatPane pattern). The expanding aura rings were a bit much —
// we'll revisit that animation later when we have the right sensor metaphor.
export function Companion({ position, bubble, onTapCompanion, onTap }: CompanionProps) {
  const router = useRouter();
  const menuOpen = useGameStore((s) => s.menuOpen);
  const setMenuOpen = useGameStore((s) => s.setMenuOpen);
  const setSelectedDog = useGameStore((s) => s.setSelectedDog);
  const setSelectedSpot = useGameStore((s) => s.setSelectedSpot);
  const spots = useGameStore((s) => s.spots);
  const userPosition = useGameStore((s) => s.userPosition);
  const [localBubble, setLocalBubble] = useState<string | null>(null);
  // Stack of branch ids representing the current menu drill-down. Empty
  // = root (PRIMARY_ACTIONS). Tapping the companion always resets to
  // root from any depth (matches user expectation: "essentials are
  // always one tap away on the dog").
  const [menuPath, setMenuPath] = useState<string[]>([]);
  // Track the "coming soon" bubble timeout so rapid menu taps don't
  // accumulate dangling timers — each new tap cancels the previous one.
  const bubbleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sprite facing + motion state, both derived from per-tick position
  // deltas (the hook ticks every 100ms and pushes a fresh `position`
  // prop). The sheets are right-facing only, so a leftward dlng flips
  // via scaleX(-1) rather than a separate mirrored asset.
  //
  // Three motion levels with thresholds tuned to the lerp speeds in
  // useCompanion (HUNT_STEP_M=1.5/tick, IDLE_STEP_M=0.8/tick, lerp tail
  // decelerates the last few metres of any approach):
  //   - movedM > RUN_THRESHOLD: running sprite. Hits during hunt
  //     pursuit + return-to-orbit while still > 7m from target.
  //   - RUN_THRESHOLD ≥ movedM > WALK_THRESHOLD: walking sprite. Hits
  //     during the lerp tail (approaching prey or orbit) and while
  //     keeping pace with a walking user.
  //   - movedM ≤ WALK_THRESHOLD: sitting sprite, after a debounce so
  //     a single quiet tick mid-walk doesn't blink to sit.
  // The walking sprite naturally appears in the last ~2-3m of every
  // hunt approach (the dog "trots in to sniff") instead of running at
  // full speed right up to the prey.
  const RUN_THRESHOLD_M = 0.4;
  const WALK_THRESHOLD_M = 0.04;
  const STILL_DEBOUNCE_MS = 400;
  const [motion, setMotion] = useState<'still' | 'walking' | 'running'>('still');
  const [facingLeft, setFacingLeft] = useState(false);
  const lastPosRef = useRef<LatLng | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const last = lastPosRef.current;
    lastPosRef.current = position;
    if (!last) return;
    const movedM = distanceMeters(last, position);
    if (movedM > RUN_THRESHOLD_M) setMotion('running');
    else if (movedM > WALK_THRESHOLD_M) setMotion('walking');
    if (movedM > WALK_THRESHOLD_M) {
      const dLng = position.lng - last.lng;
      if (Math.abs(dLng) > 1e-7) setFacingLeft(dLng < 0);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => setMotion('still'), STILL_DEBOUNCE_MS);
    }
  }, [position]);
  useEffect(() => {
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, []);

  // Tapping the dog opens the radial menu and freezes the lerp (the
  // hook bails early while menuOpen). Without this the sprite would
  // keep cycling its last running/walking frames "glued in place" for
  // up to STILL_DEBOUNCE_MS — reads as a bug. Force-sit immediately so
  // the dog visibly stops to acknowledge the interaction.
  useEffect(() => {
    if (!menuOpen) return;
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    setMotion('still');
  }, [menuOpen]);

  // Sniff override — bumped by gameStore.collectPulse on every paw or
  // bone collect (auto OR forced). When it ticks, show the sniffing
  // sprite for SNIFF_DURATION_MS, then drop back to whatever the
  // motion/mode state has settled on. This is a moment-long beat, not
  // a sustained mode — the dog finds something, sniffs, moves on.
  const collectPulse = useGameStore((s) => s.collectPulse);
  const [sniffing, setSniffing] = useState(false);
  const sniffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (collectPulse === 0) return; // initial mount, not a real collect
    const SNIFF_DURATION_MS = 1500;
    setSniffing(true);
    if (sniffTimerRef.current) clearTimeout(sniffTimerRef.current);
    sniffTimerRef.current = setTimeout(() => setSniffing(false), SNIFF_DURATION_MS);
  }, [collectPulse]);
  useEffect(() => {
    return () => {
      if (sniffTimerRef.current) clearTimeout(sniffTimerRef.current);
    };
  }, []);

  // Anim priority: sniffing (transient collect beat) wins over
  // everything; otherwise straight mapping from observed motion level
  // to the matching sprite cycle.
  const anim: DogAnim = sniffing
    ? 'sniffing'
    : motion === 'running'
      ? 'running'
      : motion === 'walking'
        ? 'walking'
        : 'sitting';

  const flash = useCallback((msg: string, ms = 4500) => {
    setLocalBubble(msg);
    if (bubbleTimeoutRef.current) clearTimeout(bubbleTimeoutRef.current);
    bubbleTimeoutRef.current = setTimeout(() => setLocalBubble(null), ms);
  }, []);

  useEffect(() => {
    return () => {
      if (bubbleTimeoutRef.current) clearTimeout(bubbleTimeoutRef.current);
    };
  }, []);

  // Reset the drill-down whenever the menu closes (outside tap, action
  // fired, etc). Without this, re-opening would land mid-tree.
  useEffect(() => {
    if (!menuOpen) setMenuPath([]);
  }, [menuOpen]);

  const handleTap = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      // Fire the parent-side suppress hook BEFORE we mutate menu state —
      // Google's map-level onClick can race against ours at low zoom and
      // would otherwise close the menu we just opened.
      onTap?.();
      if (!menuOpen) {
        setMenuOpen(true);
        onTapCompanion?.();
        return;
      }
      // Already open: tap on the dog jumps back to the root level if
      // we're drilled in, or closes the menu if we're already at root.
      // Same gesture handles "back to essentials" and "dismiss".
      if (menuPath.length > 0) {
        setMenuPath([]);
        return;
      }
      setMenuOpen(false);
    },
    [menuOpen, menuPath, setMenuOpen, onTapCompanion, onTap]
  );

  const fireLeafAction = useCallback(
    (id: string) => {
      const { lostDogs, spots: ctxSpots, userPosition: ctxPos } = useGameStore.getState();

      switch (id) {
        case 'search': {
          if (!ctxPos || lostDogs.length === 0) {
            flash('no lost pets in range yet');
            return;
          }
          const closest = lostDogs.reduce((best, d) => {
            const dd = distanceMeters(ctxPos, d.lastSeen.position);
            const bd = distanceMeters(ctxPos, best.lastSeen.position);
            return dd < bd ? d : best;
          }, lostDogs[0]!);
          setSelectedDog(closest.id);
          flash(`sniffed out ${closest.name} 🔍`);
          return;
        }
        case 'chat': {
          router.push('/chat');
          return;
        }
        case 'meet': {
          flash('no walkers around yet 👥');
          return;
        }
      }

      // Walk leaves: walk:<shape>:<distance>. Pulls candidates from
      // both the spots layer (cafés, restaurants, bars, pet shops,
      // vets) AND the parks list, scores them by walk-friendliness +
      // distance-fit, then routes. Roundtrips go to a single
      // destination but return via a perpendicular nudge point so the
      // back leg uses different streets — the user gets a unique loop
      // home from one tap. We deliberately don't setSelectedSpot —
      // that's the "open details modal" channel and a walk shouldn't
      // pop a modal.
      if (id.startsWith('walk:')) {
        const parts = id.split(':'); // ['walk', shape, distance]
        const shape = (parts[1] ?? 'roundtrip') as WalkShape;
        const distance = (parts[2] ?? 'close') as WalkDistance;
        if (!ctxPos) {
          flash("can't walk without knowing where we are");
          return;
        }
        const ctxParks = useGameStore.getState().parks;
        const candidates = buildCandidates(ctxSpots, ctxParks);
        if (candidates.length === 0) {
          // Lazy-fetch — leaves were probably hit immediately after
          // tapping "walk" before Places had loaded. Kick it again
          // and ask the user to retry in a moment.
          const { syncSpots: doSync } = useGameStore.getState();
          void doSync(ctxPos);
          flash("sniffing out spots… try again in a sec");
          return;
        }
        const plan = planWalk({ candidates, origin: ctxPos, shape, distance });
        if (!plan) {
          flash('no spot at that distance — try the other one');
          return;
        }
        // Clear any open spot-detail modal — the user shifted intent.
        setSelectedSpot(null);
        const distLabel = distance === 'far' ? 'long' : 'short';
        const shapeLabel = shape === 'roundtrip' ? 'roundtrip' : 'one-way';
        flash(`${distLabel} ${shapeLabel} to ${plan.primary.name} 🚶`);
        // walkRouteMeta.spotId only makes sense when destination IS a
        // spot — keeps its marker visible regardless of toggle. Park
        // destinations get null here; the polyline endpoint speaks for
        // itself.
        const spotId = plan.primary.isSpot ? plan.primary.id : null;
        void fetchWalkingRoute(ctxPos, plan.waypoints).then(async (route) => {
          if (route) {
            useGameStore.getState().setWalkRoute(route, { shape, spotId });
            return;
          }
          // Fallback for roundtrips: the perpendicular via-point may
          // have landed somewhere Google can't walk to (river, gated
          // park, etc) and the whole call returned null. Retry with
          // the via-point stripped — at least the user gets out-and-
          // back instead of a missing polyline. One-way and degenerate
          // (no-detour) plans don't have a via-point to drop, so just
          // accept the null.
          if (plan.hasReturnDetour && plan.waypoints.length === 3) {
            const fallback = [plan.waypoints[0]!, plan.waypoints[2]!]; // [dest, origin]
            const route2 = await fetchWalkingRoute(ctxPos, fallback);
            if (route2) {
              useGameStore.getState().setWalkRoute(route2, { shape, spotId });
            }
          }
        });
        return;
      }

      // Visit leaves: visit:spot:<spotId>. Select that spot on the map.
      if (id.startsWith('visit:spot:')) {
        const spotId = id.replace('visit:spot:', '');
        const spot = ctxSpots.find((s) => s.id === spotId);
        if (!spot) {
          flash("can't find that one anymore");
          return;
        }
        setSelectedSpot(spot.id);
        flash(`let's check out ${spot.name} ${spot.icon ?? '📍'}`);
        return;
      }

      const label = PRIMARY_ACTIONS.find((a) => a.id === id)?.label ?? id;
      flash(`${label}! coming soon 🐾`);
    },
    [router, setSelectedDog, setSelectedSpot, flash]
  );

  const handleSelect = useCallback(
    (id: string) => {
      // At root: walk and visit branch deeper, everything else is a leaf.
      if (menuPath.length === 0) {
        if (id === 'walk' || id === 'visit') {
          setMenuPath([id]);
          // Both branches need spots populated for their leaves. Lazy-
          // fetch here so the user doesn't have to manually visit the
          // Spots tab first. No-op if already loaded.
          const {
            spots: ctxSpots,
            syncSpots: doSync,
            userPosition: ctxPos,
          } = useGameStore.getState();
          if (ctxSpots.length === 0 && ctxPos) void doSync(ctxPos);
          return;
        }
        fireLeafAction(id);
        setMenuOpen(false);
        return;
      }
      // At level 2 (under a branch root): every option drills one
      // level deeper — walk shapes branch to distances, visit
      // categories branch to spot lists.
      if (menuPath.length === 1) {
        setMenuPath([...menuPath, id]);
        return;
      }
      // Level 3 = leaves only.
      fireLeafAction(id);
      setMenuOpen(false);
    },
    [menuPath, fireLeafAction, setMenuOpen]
  );

  const currentActions = useMemo(
    () => getCurrentActions(menuPath, spots, userPosition),
    [menuPath, spots, userPosition]
  );

  // Hide bubbles while the radial menu is open — otherwise the bubble
  // (above the companion) and the top "search" button fight for the
  // same vertical slot.
  const activeBubble = menuOpen ? null : bubble ?? localBubble;

  return (
    <OverlayViewF
      position={position as unknown as google.maps.LatLngLiteral}
      mapPaneName={FLOAT_PANE}
      getPixelPositionOffset={() => ({ x: -70, y: -70 })}
    >
      {/* Outer container is 140×140 — the entire box is the tap target
          even though the visible nose glyph is only 55×55 centered.
          At map-zoomed-out the companion sits on top of the UserMarker's
          breathing ring; a tighter 120px hit box was catching map-pan
          gestures on the edges. 140px + touchAction:manipulation + stop
          propagation on pointerDown make the tap land reliably without
          Google Maps' 'greedy' gesture handler hijacking it as a pan. */}
      <div
        role="button"
        tabIndex={0}
        onClick={handleTap}
        onPointerDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          width: 140,
          height: 140,
          cursor: 'pointer',
          userSelect: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          touchAction: 'manipulation',
          zIndex: 2,
        }}
      >
        {/* Pixel-art companion — 64×64 sprite scaled 2× = 128px on
            screen. Side-profile only (sheet has no top-down rotation),
            so we flip horizontally based on movement direction.
            pointer-events:none so the tap lands on the outer container
            instead of the sprite div. */}
        <DogSprite anim={anim} facingLeft={facingLeft} />

        <SpeechBubble text={activeBubble} />
        <RadialMenu
          open={menuOpen}
          actions={currentActions}
          onSelect={handleSelect}
          // Show readable names at the named-spot leaves only — every
          // other level has self-explanatory icons and a label below
          // each ring item would clutter the cardinal slots.
          showLabels={menuPath.length === 2 && menuPath[0] === 'visit'}
        />
      </div>
    </OverlayViewF>
  );
}
