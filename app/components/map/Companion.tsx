import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { MapLibreMarker } from './MapLibreMarker';
import { useMaplibreMap } from './MapContext';
import { useGameStore } from '../../stores/gameStore';
import { Z } from '../../constants/z';
import { iconForCategory } from '../ui/Icon';
import { SpeechBubble } from '../ui/SpeechBubble';
import { useHint } from '../../hooks/useHint';
import { useStrings } from '../../i18n/useStrings';
import {
  RadialMenu,
  EXPLORE_ACTIONS,
  WALK_SHAPE_ACTIONS,
  WALK_DISTANCE_ACTIONS,
  VISIT_CATEGORY_ACTIONS,
  MODE_ACTION_IDS,
  type RadialAction,
} from './RadialMenu';
import type { LatLng } from '@shukajpes/shared';
import { distanceMeters } from '../../utils/geo';
import type { SpotCategory, Spot } from '../../services/places';
import { startExplorationWalk } from '../../services/exploreWalk';
import {
  buildCandidates,
  pickVisitCandidates,
  recordRecentVisit,
  type WalkDistance,
  type WalkShape,
} from '../../utils/walk';
import { DogSprite, type DogAnim } from './DogSprite';

const VISIT_LEAVES_PER_CATEGORY = 3;

// Ring radius for the four intents, wherever they are shown — the cold
// start's gate and the level you reach by tapping the dog are the same
// ring. The icon ring's 78 was sized for 68px discs; a 112px word pill
// at that radius would have «шукати» and «грати» overlapping across the
// dog. At 86 the container comes out at 308px, which still leaves
// margins on a 360px-wide phone.
const MODE_MENU_RADIUS = 86;

// Builds the visit-leaf actions for the current category. Pulled out
// so it can be memoised + cached separately from the rest of the menu
// (the `spots` reference flips on every /sync/map tick — without
// caching, the radial menu's 3 names would shuffle every 15s while
// the user is reading them).
function buildVisitLeaves(
  category: SpotCategory,
  spots: Spot[],
  userPos: LatLng,
): RadialAction[] {
  const inCategory = spots.filter((s) => s.category === category);
  const sampled = pickVisitCandidates(inCategory, userPos, VISIT_LEAVES_PER_CATEGORY);
  // Stamp the category's pixel icon so the leaf level matches the rest
  // of the radial menu (cafe/food/bar/pet/vet). Without iconName the
  // leaves fell back to the spot's raw emoji — the odd one out in an
  // otherwise pixel-icon menu. The spot's name (shown as the label at
  // this level) is what differentiates the three leaves, not the icon.
  const iconName = iconForCategory(category) ?? undefined;
  return sampled.map((s) => ({
    id: `visit:spot:${s.id}`,
    iconName,
    icon: s.icon ?? '📍',
    label: s.name.slice(0, 16),
  }));
}

// Resolves the actions for the non-leaf menu levels. Visit leaves are
// computed separately in the component so they can be ref-cached.
function getNonVisitActions(path: string[]): RadialAction[] | null {
  const head = path[0];
  if (!head) return EXPLORE_ACTIONS;
  if (head === 'walk') {
    if (path.length === 1) return WALK_SHAPE_ACTIONS;
    const shape = path[1]!.replace('walk:', ''); // 'roundtrip' | 'oneway'
    return WALK_DISTANCE_ACTIONS.map((a) => ({
      ...a,
      id: `walk:${shape}${a.id}`, // a.id starts with ':', e.g. ':close'
    }));
  }
  if (head === 'visit' && path.length === 1) return VISIT_CATEGORY_ACTIONS;
  // null = caller falls through to visit-leaf logic
  if (head === 'visit') return null;
  return EXPLORE_ACTIONS;
}


interface CompanionProps {
  position: LatLng;
  bubble: string | null;
  // Suppress the in-map bubble — used when the dog is off-screen and
  // MapView wants to render the bubble next to the edge chip instead
  // (so the user can still see the dog's remark while panning around).
  hideBubble?: boolean;
  // Hide the dog sprite entirely — used when the companion is off-screen
  // (its edge chip is showing instead). At max pitch an off-screen,
  // beyond-horizon position projects up into the sky, so the sprite must
  // be hidden or it floats in the air.
  hidden?: boolean;
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
export function Companion({ position, bubble, hideBubble, hidden, onTapCompanion, onTap }: CompanionProps) {
  const t = useStrings();
  const router = useRouter();
  const menuOpen = useGameStore((s) => s.menuOpen);
  const setMenuOpen = useGameStore((s) => s.setMenuOpen);
  const setSelectedDog = useGameStore((s) => s.setSelectedDog);
  const setSelectedSpot = useGameStore((s) => s.setSelectedSpot);
  const spots = useGameStore((s) => s.spots);
  const userPosition = useGameStore((s) => s.userPosition);
  // Supersniff (dog-cam search) mode — used to fire the one-time "how it works"
  // intro hint on entry.
  const dogCam = useGameStore((s) => s.dogCam);
  // The four-way question. While it's up the ring is the only live thing
  // on screen, so most of the Companion's usual behaviour is suppressed.
  const appMode = useGameStore((s) => s.appMode);
  const setAppMode = useGameStore((s) => s.setAppMode);
  const setLostFlowOpen = useGameStore((s) => s.setLostFlowOpen);
  const gateOpen = appMode === 'gate';
  // Whether the ring is currently showing the four intents rather than
  // the current mode's own verbs. This is a MENU position, not a mode —
  // being here changes nothing outside the ring. The gate is the one
  // case where the two coincide: it is the four intents with the rest of
  // the app held back, and it cannot be left except by answering.
  const [atModes, setAtModes] = useState(false);
  const showModes = gateOpen || atModes;
  // Bumped by every mode flip — the signal that anything transient this
  // component owns belongs to the mode we just left.
  const overlayEpoch = useGameStore((s) => s.overlayEpoch);
  const [localBubble, setLocalBubble] = useState<string | null>(null);
  // Stack of branch ids representing the current menu drill-down. Empty
  // = root (EXPLORE_ACTIONS). Tapping the companion always resets to
  // root from any depth (matches user expectation: "essentials are
  // always one tap away on the dog").
  const [menuPath, setMenuPath] = useState<string[]>([]);
  // Track the "coming soon" bubble timeout so rapid menu taps don't
  // accumulate dangling timers — each new tap cancels the previous one.
  const bubbleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sprite facing + motion state, both derived from per-tick position
  // deltas (the hook ticks every 300ms and pushes a fresh `position`
  // prop). The sheets are right-facing only, so a leftward dlng flips
  // via scaleX(-1) rather than a separate mirrored asset.
  //
  // Three motion levels, with thresholds tuned to the lerp speeds in
  // useCompanion (HUNT_STEP_M=2.0/tick, IDLE_STEP_M=0.55/tick, lerp
  // tail decelerates the last few metres of any approach):
  //   - movedM > RUN_THRESHOLD_M: running sprite. Fires only while
  //     the dog is in the initial dash phase of a hunt. Once the
  //     lerp tail kicks in, the step drops below threshold and the
  //     sprite reads as walking. Net: running shows up for short
  //     bursts (1-2s on a far hunt), not the whole approach.
  //   - RUN_THRESHOLD_M ≥ movedM > WALK_THRESHOLD_M: walking sprite.
  //     Covers the lerp tail of any approach AND keeping pace with a
  //     walking user.
  //   - movedM ≤ WALK_THRESHOLD_M: sitting sprite, after a debounce
  //     so a single quiet tick mid-walk doesn't blink to sit.
  const RUN_THRESHOLD_M = 1.5;
  const WALK_THRESHOLD_M = 0.1;
  const STILL_DEBOUNCE_MS = 400;
  const [motion, setMotion] = useState<'still' | 'walking' | 'running'>('still');
  const [facingLeft, setFacingLeft] = useState(false);
  const lastPosRef = useRef<LatLng | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const map = useMaplibreMap();
  // Facing follows the dog's SCREEN-space travel this tick — project both
  // positions and compare X. Basing it on world longitude (dLng) was wrong two
  // ways: it ignored map rotation (a rotated map makes east ≠ screen-right),
  // and the old 4-tick averaging lagged behind direction changes, so on a
  // reversed hop the dog slid one way while still facing the other ("running
  // backwards"). Screen-space + instantaneous fixes both; a small pixel
  // deadzone holds the facing on near-vertical / negligible moves.
  const FACING_DEADZONE_PX = 0.5;
  useEffect(() => {
    const last = lastPosRef.current;
    lastPosRef.current = position;
    if (!last) return;
    const movedM = distanceMeters(last, position);
    if (movedM > RUN_THRESHOLD_M) setMotion('running');
    else if (movedM > WALK_THRESHOLD_M) setMotion('walking');
    if (movedM > WALK_THRESHOLD_M) {
      if (map) {
        try {
          const ax = map.project([last.lng, last.lat]).x;
          const bx = map.project([position.lng, position.lat]).x;
          const dxPx = bx - ax;
          if (dxPx > FACING_DEADZONE_PX) setFacingLeft(false);
          else if (dxPx < -FACING_DEADZONE_PX) setFacingLeft(true);
          // else: near-vertical / tiny move → keep current facing.
        } catch {
          /* project can throw mid-teardown — keep last facing */
        }
      }
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => setMotion('still'), STILL_DEBOUNCE_MS);
    }
  }, [position, map]);
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

  // Deep-idle: after LYING_DELAY_MS of continuous sitting (no
  // motion, no sniff override), the dog settles down into the lying
  // sprite. Reads as "we're chilling, I'm comfortable here" instead
  // of constant alert sitting. Resets to sitting on any motion.
  const LYING_DELAY_MS = 30_000;
  const [resting, setResting] = useState(false);
  const lyingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (motion !== 'still' || sniffing) {
      setResting(false);
      if (lyingTimerRef.current) {
        clearTimeout(lyingTimerRef.current);
        lyingTimerRef.current = null;
      }
      return;
    }
    if (lyingTimerRef.current) clearTimeout(lyingTimerRef.current);
    lyingTimerRef.current = setTimeout(() => setResting(true), LYING_DELAY_MS);
    return () => {
      if (lyingTimerRef.current) clearTimeout(lyingTimerRef.current);
    };
  }, [motion, sniffing]);

  // Anim priority: sniffing (transient collect beat) wins over
  // everything; otherwise straight mapping from observed motion level
  // to the matching sprite cycle. Lying is the deep-idle variant of
  // sitting.
  const anim: DogAnim = sniffing
    ? 'sniffing'
    : motion === 'running'
      ? 'running'
      : motion === 'walking'
        ? 'walking'
        : resting
          ? 'lying'
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
    if (!menuOpen) {
      setMenuPath([]);
      setAtModes(false);
    }
  }, [menuOpen]);

  // The gate opens the menu rather than closing it, so the reset above
  // never fires on the way in — and a drill-down left over from the mode
  // we just left would render underneath the four intents. The mode
  // reducer bumps overlayEpoch precisely so component-local state like
  // this can drop itself; that is what it is for.
  // A real mode change still wipes the menu's position, both the drill
  // and the level. Only picking a DIFFERENT mode gets here — walking up
  // to the four intents and back down inside the same mode never bumps
  // the epoch, which is the whole point of the change.
  useEffect(() => {
    setMenuPath([]);
    setAtModes(false);
  }, [overlayEpoch]);

  const handleTap = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      // Fire the parent-side suppress hook BEFORE we mutate menu state —
      // Google's map-level onClick can race against ours at low zoom and
      // would otherwise close the menu we just opened.
      onTap?.();
      // The gate is a question, and a question you can tap away is not a
      // question. The dog does not react, does not woof, does not close
      // the ring — the only way out is one of the four answers.
      if (useGameStore.getState().appMode === 'gate') return;
      // Supersniff used to swallow the tap entirely: a sniff beat and a
      // woof, and nothing else. That was right while the dog's menu was
      // a pile of walking verbs with no business on a search — but the
      // top of the menu is the way out of a mode now, and supersniff was
      // the one mode you could not leave that way. The corner logo is
      // not a worse answer, it is a different one, and "tap the dog" has
      // to mean the same thing everywhere or it means nothing.
      //
      // So the beat stays — the dog still reacts to being touched — and
      // the ring opens on top of it. No woof, because the question takes
      // the bubble and two lines cannot share it.
      const sniffing = useGameStore.getState().dogCam;
      if (sniffing) {
        setSniffing(true);
        if (sniffTimerRef.current) clearTimeout(sniffTimerRef.current);
        sniffTimerRef.current = setTimeout(() => setSniffing(false), 1500);
      }
      // THE DOG OPENS THE FOUR CHOICES — AS A MENU LEVEL, NOT AS A MODE.
      //
      // It used to go to 'gate', which meant every tap on the dog paid
      // the whole mode change: chrome bubbling out, the clear-slate
      // reducer firing, territory and spots flipping, all to ask a
      // question the user might answer with the mode they were already
      // in. So the four words are their own level of THIS menu now, and
      // nothing outside the ring moves until a different mode is
      // actually chosen. Someone in explore who wants a walk taps the
      // dog, taps «гуляти», and drills on — no flicker in between.
      if (!menuOpen) {
        // Recentring is the one thing supersniff still does not want: it
        // would fight the chase camera that is following the dog down
        // the trail. The ring does not need it — in that mode the dog is
        // already framed.
        if (!sniffing) onTapCompanion?.();
        setAtModes(true);
        setMenuPath([]);
        setMenuOpen(true);
        return;
      }
      // Open, anywhere below the top: the dog is the way back up, and it
      // is the same way back from every depth.
      if (!atModes) {
        setAtModes(true);
        setMenuPath([]);
        return;
      }
      // Already at the top — nothing above it, so this is a dismiss.
      setMenuOpen(false);
    },
    // `t` and `flash` left with the supersniff woof — the bubble carries
    // the question now, so this handler no longer says anything.
    [menuOpen, atModes, setMenuOpen, onTapCompanion, onTap]
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
          flash(t.modes.noWalkers);
          return;
        }
        case 'about': {
          // Promoted from the logo tap (which now toggles sniff mode).
          // Companion → ? → about sheet.
          useGameStore.getState().setMenuOpen(false);
          useGameStore.getState().setAboutOpen(true);
          return;
        }
      }

      // Walk leaves: walk:<shape>:<distance>. Pulls candidates from
      // both the spots layer (cafés, restaurants, bars, pet shops,
      // vets) AND the parks list, then hands them to
      // startExplorationWalk, which ranks a few, asks the server which
      // of them passes the most kyiv_lore landmarks, and routes through
      // those — so the walk arrives somewhere nice AND has something to
      // say on the way. Roundtrips still return via a perpendicular
      // nudge point so the back leg uses different streets. We
      // deliberately don't setSelectedSpot — that's the "open details
      // modal" channel and a walk shouldn't pop a modal.
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
        // Clear any open spot-detail modal — the user shifted intent.
        setSelectedSpot(null);
        // The landmark step is a round-trip to the server, so say
        // something now rather than leaving the tap unanswered; the
        // real label lands when the route does.
        flash(`${distance === 'far' ? 'long' : 'short'} walk, sniffing the way 🚶`);
        void startExplorationWalk({ origin: ctxPos, candidates, shape, distance }).then(
          (walk) => {
            if (!walk) {
              flash('no spot at that distance — try the other one');
              return;
            }
            // walkRouteMeta.spotId only makes sense when destination IS
            // a spot — keeps its marker visible regardless of toggle.
            // Park destinations get null; the polyline endpoint speaks
            // for itself.
            useGameStore
              .getState()
              .setWalkRoute(
                walk.route,
                { shape, spotId: walk.spotId, destinationName: walk.primary.name },
                walk.stops,
              );
            const shapeLabel = shape === 'roundtrip' ? 'roundtrip' : 'one-way';
            const distLabel = distance === 'far' ? 'long' : 'short';
            const n = walk.stops.length;
            flash(
              n
                ? `${distLabel} ${shapeLabel} to ${walk.primary.name} — ${n} ${n === 1 ? 'stop' : 'stops'} on the way 🐾`
                : `${distLabel} ${shapeLabel} to ${walk.primary.name} 🚶`,
            );
          },
        );
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
        // Feed the recent-visit list so next time the user opens the
        // visit submenu in this category, this spot sinks in the
        // ranking and other names surface.
        recordRecentVisit(spot.id);
        setSelectedSpot(spot.id);
        flash(`let's check out ${spot.name} ${spot.icon ?? '📍'}`);
        return;
      }

      const label = EXPLORE_ACTIONS.find((a) => a.id === id)?.label ?? id;
      flash(`${label}! coming soon 🐾`);
    },
    // `t` joined the list when the "nobody around" line stopped being a
    // hardcoded English string. It only changes when the user switches
    // language, so it costs one rebuild of this callback per toggle.
    [router, setSelectedDog, setSelectedSpot, flash, t]
  );

  const handleSelect = useCallback(
    (id: string) => {
      // The four intents answer first — they are levels and modes, not
      // actions, and none of the drill-down logic below applies.
      //
      // The rule throughout: only ever call setAppMode when the mode is
      // genuinely CHANGING. It runs the clear-slate reducer and flips
      // every piece of chrome, and paying that to re-enter the mode you
      // are already in is the flicker this whole level exists to avoid.
      if (id.startsWith('mode:')) {
        switch (id) {
          case 'mode:lost': {
            // Not a mode — a sheet. Whatever mode the user was in stays
            // exactly as it was, so asking about a lost pet from the
            // territory view does not silently turn the territory off.
            // The gate is the one exception: it has to be left, or the
            // sheet opens over a screen with no chrome and a dead map.
            if (gateOpen) setAppMode('explore');
            else setMenuOpen(false);
            setLostFlowOpen(true);
            return;
          }
          case 'mode:search':
            if (appMode !== 'search') setAppMode('search');
            else setMenuOpen(false);
            return;
          case 'mode:play':
            if (appMode !== 'play') setAppMode('play');
            else setMenuOpen(false);
            return;
          default:
            // «гуляти» drops one level rather than closing: it is the
            // door to walk / visit / meet, and that is what the user
            // just asked for. Already in explore → no mode change at
            // all, just the level.
            if (appMode !== 'explore') setAppMode('explore');
            setAtModes(false);
            setMenuPath([]);
            setMenuOpen(true);
            return;
        }
      }
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
    [menuPath, fireLeafAction, setMenuOpen, setAppMode, setLostFlowOpen, appMode, gateOpen]
  );

  // Visit-leaf cache — keyed by the category drill (path[1] like
  // 'visit:cafe'). pickVisitCandidates uses Math.random, so without
  // this cache, every /sync/map tick (which changes the `spots`
  // reference) would re-shuffle the names while the user is reading
  // them. Cleared whenever the menu closes so the next open gets a
  // fresh sample.
  const visitLeavesCacheRef = useRef<{ key: string; leaves: RadialAction[] } | null>(null);
  useEffect(() => {
    if (!menuOpen) visitLeavesCacheRef.current = null;
  }, [menuOpen]);

  // The four intents, labelled from i18n. Built here rather than in
  // RadialMenu because only the ids are static — the words are Ukrainian
  // by default and come from the strings table.
  const modeActions = useMemo<RadialAction[]>(
    () =>
      MODE_ACTION_IDS.map((id) => ({
        id,
        label: {
          'mode:lost': t.modes.lost,
          'mode:search': t.modes.search,
          'mode:explore': t.modes.explore,
          'mode:play': t.modes.play,
        }[id],
      })),
    [t],
  );

  const currentActions = useMemo(() => {
    if (showModes) return modeActions;
    const nonVisit = getNonVisitActions(menuPath);
    if (nonVisit) return nonVisit;
    // We're at visit:<category>. Use the cached picks if the category
    // hasn't changed; otherwise compute + cache.
    if (!userPosition) return [];
    const visitKey = menuPath[1]!;
    const cached = visitLeavesCacheRef.current;
    if (cached && cached.key === visitKey) return cached.leaves;
    const category = visitKey.replace('visit:', '') as SpotCategory;
    const leaves = buildVisitLeaves(category, spots, userPosition);
    visitLeavesCacheRef.current = { key: visitKey, leaves };
    return leaves;
  }, [showModes, modeActions, menuPath, spots, userPosition]);

  // Hide bubbles while the radial menu is open — otherwise the bubble
  // (above the companion) and the top "search" button fight for the
  // same vertical slot.
  // hideBubble: parent (MapView) is mirroring the bubble next to the
  // off-screen edge chip, so we suppress the in-map version to avoid
  // double-render.
  //
  // One-shot hint: long-pressing anywhere on the map triggers the
  // sniff-press flow, which is the most-missed gesture in the app
  // because nothing in the UI suggests it exists. The hint waits
  // for any real bubble (the greeting, sniff feedback, narration)
  // to clear via `ready` so it doesn't get stomped on by the
  // greeting on first map view — once the dog falls silent, the
  // hint's show + auto-dismiss timers start counting.
  // Hints only count down when the map is in a calm state (hintsAllowed,
  // computed in MapView: on the map tab, camera idle, not sniff mode, no
  // modal, dog comfortably on-screen) AND no real bubble (greeting,
  // sniff feedback, narration) holds the surface. If the user starts
  // doing something the timer pauses and restarts once they're idle
  // again — so a hint never fires mid-transition or off-screen.
  const hintsAllowed = useGameStore((s) => s.hintsAllowed);
  const noRealBubble = !menuOpen && !hideBubble && !bubble && !localBubble;
  const hintsReady = hintsAllowed && noRealBubble;
  const longPressHint = useHint('map:long-press-to-sniff', {
    ready: hintsReady,
    showDelayMs: 1200,
    autoDismissMs: 6000,
    // FIXME(hints): persist:false while we iterate on the
    // wording / timing / sequence. Flip to true (or just
    // remove this line) when the hint's behaviour is settled
    // so it goes back to one-shot per device.
    persist: false,
  });
  // Soft fan-out, step 2: the HUD meters — the three pills top-left
  // (sun = mood, bone = hunger, paws = collected). Chained after the
  // long-press hint so the dog names what it's feeling once the user has
  // the basics. Pulses all three pills via activeHint. (hintsReady is
  // already false in sniff mode, where the HUD is hidden.)
  const hudMetersHint = useHint('map:hud-meters', {
    ready: hintsReady && longPressHint.seen && !longPressHint.visible,
    showDelayMs: 1200,
    autoDismissMs: 6000,
    persist: false,
  });
  // Soft fan-out, step 3 (map): the spots on/off toggle — the top-right
  // pin pill. Chained after the HUD meters (seen + gone) so the map hints
  // arrive strictly one at a time. Pulses the pill via activeHint.
  const spotsHint = useHint('map:spots-toggle', {
    ready: hintsReady && hudMetersHint.seen && !hudMetersHint.visible,
    showDelayMs: 1200,
    autoDismissMs: 6000,
    persist: false,
  });
  // Soft fan-out, final step: super-sniff (the top-left logo toggles it —
  // a mode-switching brand logo is undiscoverable on its own). Saved for
  // last because it's the deepest feature (hunting lost dogs); by now the
  // user knows the map basics. Chained after the spots toggle so the map
  // hints arrive strictly one at a time. Pulses the logo via activeHint.
  const supersniffHint = useHint('map:supersniff', {
    ready: hintsReady && spotsHint.seen && !spotsHint.visible,
    showDelayMs: 1200,
    autoDismissMs: 6000,
    persist: false,
  });
  // Supersniff "how it works" — fires immediately the first time you ENTER
  // supersniff (not gated on the idle hintsReady, since the chase cam is always
  // easing): the dog explains the swipe/tap interaction, replacing the old
  // per-swipe bubble. Fires right away and takes priority over any bark that
  // happens to be up (see activeBubble below).
  const supersniffIntroHint = useHint('map:supersniff-intro', {
    ready: dogCam,
    showDelayMs: 150,
    autoDismissMs: 6500,
    // FIXME(hints): persist:false while iterating — fires once per session
    // (fresh each reload). Flip to true for one-shot-per-device once settled.
    persist: false,
  });
  // Logo way-out hint: when supersniff was entered from the lost-dog modal
  // ("start search"), the user never touched the logo — nothing tells them
  // how to get back to walks. Once the entry bark has cleared and things go
  // quiet (ready gates on an empty bubble + the intro hint being done), a
  // couple of beats later the dog points at the logo, which pulses in sync
  // via activeHint. Purely additive: it only borrows the bubble for its
  // window — carousel swiping/tapping keeps working underneath it.
  const dogCamViaSearch = useGameStore((s) => s.dogCamViaSearch);
  const supersniffExitHint = useHint('map:supersniff-exit', {
    ready:
      dogCam &&
      dogCamViaSearch &&
      !supersniffIntroHint.visible &&
      !bubble &&
      !localBubble,
    showDelayMs: 2500,
    autoDismissMs: 7000,
    // FIXME(hints): persist:false while iterating, same as the intro.
    persist: false,
  });
  // Radial-menu explainer: the first time the menu blooms, the dog
  // names what's in it (search / walk / visit / meet / chat) so the
  // icon ring isn't a guessing game. Rides alongside the open menu at
  // root level, shows quickly, auto-dismisses. Independent of the
  // hintsReady gate (which suppresses while the menu is open) — this
  // one is *for* the open menu.
  const menuHint = useHint('menu:radial-explainer', {
    ready: menuOpen && menuPath.length === 0,
    showDelayMs: 250,
    autoDismissMs: 5000,
    persist: false,
  });
  // Which hint is currently on screen. NOT re-gated by the live idle
  // state: once a hint has fired (it only fires when idle) it owns the
  // bubble for its full window — the snap-to-dog ease it triggers would
  // otherwise flip `hintsReady` false and yank the bubble away mid-show.
  const activeHintId = longPressHint.visible
    ? 'map:long-press-to-sniff'
    : hudMetersHint.visible
      ? 'map:hud-meters'
      : spotsHint.visible
        ? 'map:spots-toggle'
        : supersniffHint.visible
          ? 'map:supersniff'
          : // Gated on dogCam so the line + logo pulse drop the moment the
            // user exits (the hinted gesture) instead of riding out the
            // window into normal mode, where "get back to walks" is stale.
            supersniffExitHint.visible && dogCam
            ? 'map:supersniff-exit'
            : null;
  const hintBubble =
    activeHintId === 'map:long-press-to-sniff'
      ? t.hints.longPressToSniff
      : activeHintId === 'map:hud-meters'
        ? t.hints.hudMeters
        : activeHintId === 'map:spots-toggle'
          ? t.hints.spotsToggle
          : activeHintId === 'map:supersniff'
            ? t.hints.supersniff
            : activeHintId === 'map:supersniff-exit'
              ? t.hints.supersniffExit
              : null;
  // While the menu is open we normally suppress the bubble — except
  // for the one-shot radial-menu explainer, which is meant to sit
  // alongside the open menu at root and name the options.
  const menuExplainer =
    menuOpen && menuPath.length === 0 && menuHint.visible
      ? t.hints.radialMenu
      : null;
  // Supersniff intro bubble — shown over ambient/real barks for its window.
  const supersniffIntro =
    dogCam && supersniffIntroHint.visible ? t.hints.supersniffIntro : null;
  // Priority: menu explainer (while open) → an active hint owns the
  // bubble (it fired during an idle moment and shouldn't be stepped on
  // by an ambient bark) → local tap/action feedback (user-initiated —
  // a supersniff tap-woof shouldn't lose to an ambient lead bark) →
  // parent bubbles (greeting / narration / ambient). Ambient generation
  // is also paused while a hint shows (see useGameLoop), so this mainly
  // settles same-frame races.
  //
  // The question travels with the four words, wherever they are shown.
  // It IS their label — four bare verbs orbiting a dog with an ambient
  // bark above them would read as nonsense. At the gate it also outranks
  // `hideBubble`, because there the question is the screen.
  const activeBubble = gateOpen
    ? t.modes.ask
    : hideBubble
      ? null
      : atModes
        ? t.modes.ask
        : menuOpen
          ? menuExplainer
          : supersniffIntro ?? hintBubble ?? localBubble ?? bubble;

  // Publish the visible hint so sibling components (the top-left logo
  // in the HUD) can render a matching cue. Clear on unmount.
  const setActiveHint = useGameStore((s) => s.setActiveHint);
  useEffect(() => {
    setActiveHint(activeHintId);
  }, [activeHintId, setActiveHint]);
  useEffect(() => () => setActiveHint(null), [setActiveHint]);

  // Publish the radial-menu camera mode so MapView can frame the dog.
  // Decided ONCE at open: first time (explainer not yet seen) → snap
  // lower for the explainer; every later tap → just centre the dog.
  // Deliberately keyed on menuOpen only so the framing doesn't jump
  // when the explainer auto-dismisses while the menu is still open.
  const setMenuCamera = useGameStore((s) => s.setMenuCamera);
  // The four intents always take the 'explainer' framing, every time and
  // not just the first: theirs is the widest ring we draw and it carries
  // the question above it, so the dog has to sit low enough that neither
  // the top pill nor the bubble leaves the screen. Keyed on `showModes`
  // so walking up to that level reframes and walking back down restores
  // the ordinary menu framing.
  useEffect(() => {
    setMenuCamera(
      showModes
        ? 'explainer'
        : menuOpen
          ? menuHint.seen
            ? 'center'
            : 'explainer'
          : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showModes, menuOpen, setMenuCamera]);
  useEffect(() => () => setMenuCamera(null), [setMenuCamera]);

  return (
    <MapLibreMarker position={position} zIndex={Z.MARKER_COMPANION}>
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
          zIndex: Z.MARKER_COMPANION,
          // Off-screen (edge chip showing): hide so a beyond-horizon
          // position can't float the dog in the sky at steep pitch.
          visibility: hidden ? 'hidden' : 'visible',
          pointerEvents: hidden ? 'none' : 'auto',
        }}
      >
        {/* Pixel-art companion — 64×64 sprite scaled 2× = 128px on
            screen. Side-profile only (sheet has no top-down rotation),
            so we flip horizontally based on movement direction.
            pointer-events:none so the tap lands on the outer container
            instead of the sprite div. */}
        <DogSprite anim={anim} facingLeft={facingLeft} />

        {/* Explainer rides higher (above the top ring button) so it
            clears the radial menu; every other line tucks just above
            the nose. The intents' ring is wider still — its top pill
            reaches ~108px above the dog's centre — so the question has
            to sit higher again or it lands on top of «загубив». */}
        <SpeechBubble
          text={activeBubble}
          bottom={
            showModes
              ? 'calc(50% + 165px)'
              : menuExplainer
                ? 'calc(50% + 130px)'
                : undefined
          }
        />
        <RadialMenu
          open={menuOpen}
          actions={currentActions}
          onSelect={handleSelect}
          // The map is light, so the menu is dark — a light-frosted menu
          // disappeared into it.
          inverted
          // Show readable names at the named-spot leaves only — every
          // other level has self-explanatory icons and a label below
          // each ring item would clutter the cardinal slots.
          showLabels={menuPath.length === 2 && menuPath[0] === 'visit'}
          // The top level is words. See the note on TEXT_ITEM in RadialMenu.
          variant={showModes ? 'text' : 'icon'}
          // Word pills are wider than icon buttons, so the ring has to
          // open out or opposite pills meet in the middle.
          radius={showModes ? MODE_MENU_RADIUS : undefined}
        />
      </div>
    </MapLibreMarker>
  );
}
