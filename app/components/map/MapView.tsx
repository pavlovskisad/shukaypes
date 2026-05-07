import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { GoogleMap, PolylineF, useJsApiLoader } from '@react-google-maps/api';
import { View, Text, StyleSheet, Image } from 'react-native';
import type { UrgencyLevel } from '@shukajpes/shared';
import { env } from '../../constants/env';
import { colors } from '../../constants/colors';
import { balance } from '../../constants/balance';
import { greyscaleMapStyle, darkMapStyle } from '../../constants/mapStyle';
import { useGameStore } from '../../stores/gameStore';
import { useLocation } from '../../hooks/useLocation';
import { useCompanion } from '../../hooks/useCompanion';
import { useGameLoop } from '../../hooks/useGameLoop';
import { distanceMeters } from '../../utils/geo';
import { Companion } from './Companion';
import logoNose from '../../assets/logo-nose.png';
import { UserMarker } from './UserMarker';
import { TokenMarker } from './TokenMarker';
import { FoodMarker } from './FoodMarker';
import { LostDogMarker } from './LostDogMarker';
import { LostDogCluster, URGENCY_RANK } from './LostDogCluster';
import { SearchZoneCircle } from './SearchZoneCircle';
import { LostDogModal } from '../ui/LostDogModal';
import { SpotModal } from '../ui/SpotModal';
import { fetchWalkingRoute } from '../../services/directions';
import { PoiMarker } from './PoiMarker';
import { PoiCluster } from './PoiCluster';
import { WaypointMarker } from './WaypointMarker';
import { clusterByDistance, jitterInRadius } from '../../utils/cluster';
import type { LatLng } from '@shukajpes/shared';
import { SYSTEM_FONT } from '../../constants/fonts';

const CONTAINER_STYLE = { width: '100%', height: '100%' };
const LIBRARIES: ('places')[] = ['places'];
const TOKEN_REFRESH_MS = 15000;

// Two pets within this radius are visually grouped together — either
// floated in a ring (zone-outline feel) or collapsed behind a cluster
// badge if the group is big enough to warrant the interaction cost.
const PIN_CLUSTER_RADIUS_M = 250;

// At or above this group size we switch from "disperse in a ring" to
// "show a cluster badge, tap to expand". Below it, the pets just float
// around the cluster center so the user sees them at a glance.
const CLUSTER_BADGE_THRESHOLD = 6;

// Distance from the user beyond which lost-pet pins, paws and bones
// are not rendered on the map. The full lists stay in the store
// (Quests tab keeps the city-wide view; auto-collect runs against the
// store data, not the DOM); we just don't pay the layout cost for
// pins the user can't act on without walking. ~2km covers a comfortable
// walking horizon at our zoom levels — anything further is a planning
// concern, not a "is it nearby" concern.
const MAP_RENDER_RADIUS_M = 2000;

// Spot clustering — disk-overlap criterion. Each PoiMarker is now a
// 44px disc and PoiCluster a 54px disc, so two pins "visually
// overlap" when their centres are within ~46-56px of each other.
// We translate that pixel threshold to METERS at the current zoom +
// map-centre latitude so clustering adapts naturally: aggressive at
// the locked min-zoom 16 (where the pile-up problem lives) and
// barely-active when the user zooms in.
const SPOT_OVERLAP_PX = 48;
// Web Mercator: meters-per-pixel at zoom 0 / equator. Standard
// constant from Google's tile spec.
const MPP_EQUATOR_Z0 = 156543.03392;

// Module-level flag so the greeting hint only fires once per
// JS session — i.e., once per app open. PWA / browser reload resets
// it; tab switches and re-focuses inside one session don't.
let hasGreetedThisSession = false;

export default function MapViewWeb() {
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: env.googleMapsApiKey,
    libraries: LIBRARIES,
  });

  const location = useLocation();
  const [bubble, setBubble] = useState<string | null>(null);
  const bubbleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  // Google Maps fires its own onClick on the map div independently of
  // DOM event propagation — `stopPropagation` inside an OverlayViewF
  // child doesn't reach it. At low zoom the companion overlaps the map
  // surface enough that opening the radial menu also triggers a
  // "background click" that closes it ~1 frame later. Record every
  // companion tap and suppress the map onClick for a short window.
  const companionTappedAtRef = useRef<number>(0);
  const SUPPRESS_MAP_CLICK_MS = 300;
  // Which cluster is currently "spiderified" — tapping a cluster pops its
  // pets out around the center. Tapping elsewhere (the map background or
  // another cluster) collapses it. Lives locally because nothing else in
  // the app cares about this transient view-state.
  const [expandedClusterKey, setExpandedClusterKey] = useState<string | null>(null);
  const userPos = location.position;
  // Map intervals (companion lerp, auto-collect, /sync/map poll) all
  // gate on this — when the user is on Profile/Chat/Quests we stop
  // burning CPU on work the user can't see. The /collect/path sweep
  // on refocus catches up any paws or bones the user walked past
  // while the loops were paused.
  const isFocused = useIsFocused();

  const companionPos = useCompanion(userPos, isFocused);
  // Tracks the map's visible bounds so we can detect when the
  // companion has wandered (or been panned) off-screen and surface a
  // tap-to-recenter indicator at the screen edge.
  const [mapBounds, setMapBounds] = useState<{
    n: number; s: number; e: number; w: number;
  } | null>(null);
  // Current zoom level + centre lat — used to translate the pixel
  // overlap threshold into a geographic radius for spot clustering.
  // Synced from the map in onIdle (fires after every pan/zoom).
  const [mapZoom, setMapZoom] = useState<number>(balance.mapZoomDefault);
  const [mapCenterLat, setMapCenterLat] = useState<number>(50.45);
  // Which clusters the user has tapped to expand. Stored by cluster
  // key (sorted item ids); cleared by the floating "collapse all" pill
  // that appears at the top of the map while any cluster is open.
  const [expandedSpotKeys, setExpandedSpotKeys] = useState<Set<string>>(() => new Set());
  const tokens = useGameStore((s) => s.tokens);
  const foodItems = useGameStore((s) => s.foodItems);
  const lostDogs = useGameStore((s) => s.lostDogs);
  const selectedDogId = useGameStore((s) => s.selectedDogId);
  const spots = useGameStore((s) => s.spots);
  const spotsVisible = useGameStore((s) => s.spotsVisible);
  const sniffMode = useGameStore((s) => s.sniffMode);
  // The chip pop animations should ONLY play during the brief window
  // around an actual sniff-mode toggle. Without this, two leaks happen:
  //
  // 1. Initial app load (sniffMode = false): if we always attach
  //    `animation: chip-pop-out`, the keyframe's 0% (scale 1, opacity 1)
  //    overrides the static styles during playback — so chips briefly
  //    flash visible before shrinking to 0.
  //
  // 2. Mid-session in NORMAL mode: a pet that was on-screen exits the
  //    viewport (e.g., user pans, companion minimizes), so a new chip
  //    DOM node mounts. If it mounts with `chip-pop-out` attached, same
  //    flash — chip pops in for one keyframe before disappearing.
  //
  // Fix: use a `sniffJustChanged` flag that goes true on toggle and
  // clears after the animation duration. New mounts during the rest
  // of the session get `animation: none` and rely purely on static
  // styles (opacity / scale) keyed off `sniffMode`.
  const [sniffJustChanged, setSniffJustChanged] = useState(false);
  const sniffInitRef = useRef(true);
  useEffect(() => {
    if (sniffInitRef.current) {
      sniffInitRef.current = false;
      return;
    }
    setSniffJustChanged(true);
    const t = setTimeout(() => setSniffJustChanged(false), 420);
    return () => clearTimeout(t);
  }, [sniffMode]);
  const spotsCategoryFilter = useGameStore((s) => s.spotsCategoryFilter);
  const selectedSpotId = useGameStore((s) => s.selectedSpotId);
  const setSelectedSpot = useGameStore((s) => s.setSelectedSpot);
  const collectToken = useGameStore((s) => s.collectToken);
  const eatFood = useGameStore((s) => s.eatFood);
  const setUserPosition = useGameStore((s) => s.setUserPosition);
  const syncMap = useGameStore((s) => s.syncMap);
  const syncSpots = useGameStore((s) => s.syncSpots);
  const collectPath = useGameStore((s) => s.collectPath);
  const setSelectedDog = useGameStore((s) => s.setSelectedDog);
  const activeQuest = useGameStore((s) => s.activeQuest);
  const syncActiveQuest = useGameStore((s) => s.syncActiveQuest);
  const advanceQuestIfNear = useGameStore((s) => s.advanceQuestIfNear);
  const forceAdvanceActiveWaypoint = useGameStore((s) => s.forceAdvanceActiveWaypoint);
  const walkRoute = useGameStore((s) => s.walkRoute);
  const walkRouteMeta = useGameStore((s) => s.walkRouteMeta);
  const setWalkRoute = useGameStore((s) => s.setWalkRoute);

  // Street-hugging walking route through the active quest's waypoints.
  // Fetched once per quest (by id) so GPS ticks don't re-quota the
  // Directions API. Renders as a thicker polyline when available;
  // straight-line fallback otherwise (see below).
  const [questRoute, setQuestRoute] = useState<LatLng[] | null>(null);
  useEffect(() => {
    setQuestRoute(null);
    if (!activeQuest || !userPos) return;
    let cancelled = false;
    fetchWalkingRoute(
      userPos,
      activeQuest.waypoints.map((w) => w.position),
    ).then((path) => {
      if (!cancelled) setQuestRoute(path);
    });
    return () => {
      cancelled = true;
    };
  }, [activeQuest?.id]);

  const showBubble = useCallback((msg: string, duration?: number) => {
    setBubble(msg);
    if (bubbleTimeoutRef.current) clearTimeout(bubbleTimeoutRef.current);
    bubbleTimeoutRef.current = setTimeout(
      () => setBubble(null),
      duration ?? balance.bubbleDuration,
    );
  }, []);

  useGameLoop(showBubble);

  // Companion barks when sniff mode toggles. Skips the initial mount
  // (sniffMode starts false; we don't want a "back to normal" line on
  // every app load) via a ref guard.
  const sniffBubbleInitRef = useRef(true);
  useEffect(() => {
    if (sniffBubbleInitRef.current) {
      sniffBubbleInitRef.current = false;
      return;
    }
    showBubble(
      sniffMode ? '*deep sniff* supersniff mode 👀' : 'okay, back to walks 🐾',
      3500,
    );
  }, [sniffMode, showBubble]);

  // Greet on every map-tab focus — pick a random "woof" so it doesn't
  // get repetitive. Same energy as Claude Code's *percolating* /
  // *combobulating* spinner words. The very first focus per session
  // also nudges the user toward the about modal so newcomers find
  // the help affordance (top-left logo tap).
  useFocusEffect(
    useCallback(() => {
      if (!hasGreetedThisSession) {
        hasGreetedThisSession = true;
        showBubble("woof! tap me to learn what's what 🐾", 5500);
        return;
      }
      const woofs = [
        'woof 🐾',
        '*sniff sniff*',
        'ruff ruff 🐶',
        'bork bork',
        '*tail wag*',
        '*ears perk*',
        '*zoomies* 💨',
        '*butt wiggle*',
        '*play bow*',
        'arf arf!',
        '*nose boop*',
        '*happy pant*',
        'yip yip!',
        '*floof shake*',
        '*scout mode* 🔍',
        '*sploot*',
        '*boof*',
        '*mlem*',
      ];
      const pick = woofs[Math.floor(Math.random() * woofs.length)] ?? 'woof 🐾';
      showBubble(pick, 4000);
    }, [showBubble]),
  );

  // Preload neighbour photos on the FIRST modal open per session so
  // prev/next swipes find them in cache and don't briefly show the
  // grey backdrop while the photo decodes. Idempotent — the browser
  // dedupes by URL across re-renders. window.Image (not the RN
  // <Image> component imported up top) is the browser's HTMLImageElement
  // constructor which kicks off a network fetch when src is set.
  useEffect(() => {
    if (!selectedDogId || typeof window === 'undefined') return;
    for (const d of lostDogs) {
      if (d.photoUrl) {
        const img = new window.Image();
        img.src = d.photoUrl;
      }
    }
  }, [selectedDogId, lostDogs]);

  useEffect(() => {
    if (userPos) setUserPosition(userPos);
  }, [userPos?.lat, userPos?.lng, setUserPosition]);

  // Fetch server state tied to position: spawned tokens + food + nearby
  // lost dogs + user/companion state, all in one /sync/map round-trip
  // (PR #160's bulk endpoint). collectPath fires first so any token /
  // bone the user walked past while the tab was suspended (Safari
  // pauses JS) gets credited *before* the bulk sync filters them out
  // as collected. Spots stay separate — they're driven by Google
  // Places, not our backend, and the action is movement-gated so most
  // ticks are no-ops anyway.
  useEffect(() => {
    if (!userPos || !isFocused) return;
    void collectPath(userPos);
    void syncMap(userPos);
    syncSpots(userPos);
    const id = setInterval(() => {
      const pos = useGameStore.getState().userPosition;
      if (!pos) return;
      void collectPath(pos);
      void syncMap(pos);
      syncSpots(pos);
    }, TOKEN_REFRESH_MS);
    return () => clearInterval(id);
  }, [userPos?.lat, userPos?.lng, isFocused, collectPath, syncMap, syncSpots]);

  // Pull the active quest (if any) on mount so a refreshed tab sees the
  // quest the user started earlier. No polling — quest state only changes
  // on explicit user actions (start / advance / abandon).
  useEffect(() => {
    syncActiveQuest();
  }, [syncActiveQuest]);

  // Auto-advance: when the user crosses into the current waypoint's
  // radius, POST /quests/advance and (optionally) complete. Runs on
  // the same 100ms tick as auto-collect so progression feels immediate.
  // advanceQuestIfNear short-circuits outside 50m, so the API only
  // fires on actual waypoint arrivals.
  useEffect(() => {
    if (!activeQuest) return;
    const id = setInterval(async () => {
      const pos = useGameStore.getState().userPosition;
      if (!pos) return;
      const { advanced, completed, narration } = await advanceQuestIfNear(pos);
      if (completed) {
        showBubble(narration ?? `found something! quest complete 🎉`, 6000);
      } else if (advanced) {
        showBubble(narration ?? `paw print here — let's keep going 🐾`, 5000);
      }
    }, balance.roamTick);
    return () => clearInterval(id);
  }, [activeQuest?.id, activeQuest?.currentWaypoint, advanceQuestIfNear, showBubble]);

  // Auto-collect tokens. Uses min(user, companion) distance — the
  // companion orbits the walker at ~110m, so paws right at the user's
  // feet would otherwise sit just outside the companion's 90m disk
  // (donut-of-detection bug). Either being in range is enough.
  // Gated on isFocused — when the map tab isn't visible, the
  // /collect/path sweep on refocus catches anything the user walked
  // past while paused (server tracks their last anchor in Redis).
  // Companion position is read inside the auto-collect / auto-eat
  // intervals via this ref, NOT through the useEffect closure. The
  // companion lerps on its own tick (currently 300ms), so closing
  // over `companionPos` and listing `companionPos?.lat / .lng` in
  // useEffect deps would tear down + recreate these intervals on
  // EVERY lerp tick — the intervals barely got a chance to fire
  // their bodies, and the React reconciliation overhead for the
  // cleanup churn was the big "compounding tick lag" suspect from
  // the perf pass. Ref pattern lets the deps array stay stable
  // (just `isFocused` + the action) so each interval is set once
  // and ticks cleanly.
  const companionPosRef = useRef(companionPos);
  companionPosRef.current = companionPos;

  useEffect(() => {
    if (!isFocused) return;
    const id = setInterval(() => {
      const { tokens: ts, userPosition: u } = useGameStore.getState();
      const cp = companionPosRef.current;
      if (!u && !cp) return;
      ts.forEach((t) => {
        if (t.collectedAt) return;
        const dCompanion = cp ? distanceMeters(cp, t.position) : Infinity;
        const dUser = u ? distanceMeters(u, t.position) : Infinity;
        if (Math.min(dCompanion, dUser) < balance.autoCollectToken) {
          collectToken(t.id);
        }
      });
    }, balance.roamTick);
    return () => clearInterval(id);
  }, [isFocused, collectToken]);

  // Auto-eat food. Same min(user, companion) trick as paws. Same
  // refocus-catchup story — the path-collect sweep credits any bone
  // the user walked past while not focused. Same ref pattern so the
  // interval doesn't churn on every companion lerp tick.
  useEffect(() => {
    if (!isFocused) return;
    const id = setInterval(() => {
      const { foodItems: fs, userPosition: u } = useGameStore.getState();
      const cp = companionPosRef.current;
      if (!u && !cp) return;
      fs.forEach((f) => {
        const dCompanion = cp ? distanceMeters(cp, f.position) : Infinity;
        const dUser = u ? distanceMeters(u, f.position) : Infinity;
        if (Math.min(dCompanion, dUser) < balance.autoCollectFood) {
          eatFood(f.id);
        }
      });
    }, balance.foodCheckInterval);
    return () => clearInterval(id);
  }, [isFocused, eatFood]);

  const mapOptions = useMemo(
    () => ({
      // Sniff mode swaps to the dark style — deep-charcoal land,
      // brighter dark-grey streets, dim labels. Cost is a one-time
      // tile re-render per toggle (no sustained perf hit). The
      // body-filter route was attempted earlier but mangled photos
      // and the profile dog scene + felt laggy on iOS Safari from
      // forcing every child element into its own GPU compositing
      // layer; per-element approach is the right call here.
      styles: sniffMode ? darkMapStyle : greyscaleMapStyle,
      disableDefaultUI: true,
      zoomControl: false,
      minZoom: balance.mapZoomMin,
      maxZoom: balance.mapZoomMax,
      gestureHandling: 'greedy' as const,
      clickableIcons: false,
      // Hard-box the viewport around central Kyiv so panning + zoom
      // don't spill into empty map tiles + wasted /tokens/nearby,
      // /dogs/nearby queries. ±0.045° lat / ±0.07° lng ≈ a 10×10km
      // square centered on the Maidan-ish area — covers Podil,
      // Pechersk, Lukianivka, Solomianka, Vynohradar. Outside the
      // pilot geography we'll swap this for a per-user anchor.
      restriction: {
        latLngBounds: {
          north: 50.4951,
          south: 50.4051,
          east: 30.5934,
          west: 30.4534,
        },
        strictBounds: true,
      },
    }),
    [sniffMode],
  );

  // Map-only distance cull. Full lists live in the store (Quests tab,
  // auto-collect loops, sync diff math); only the rendered DOM is
  // bounded by MAP_RENDER_RADIUS_M. This is the perf sliding-door —
  // at city density we can have 100+ active pets and hundreds of
  // paws/bones, but the user can only act on what's within ~2km of
  // them. Without the cull every pan re-runs every overlay's wander +
  // SOS-beep timers.
  // Bucket the user position to a ~100m grid for memo invalidation
  // purposes. The visible-distance cull is at 2km radius — a few
  // meters of GPS jitter doesn't meaningfully change which pets /
  // tokens / food fall inside the cull, but listing precise
  // userPos.lat/.lng in the deps array meant every GPS tick blew
  // these memos AND every downstream memo that depended on the
  // resulting array reference (offscreenDogIndicators, clusters,
  // etc). Rounding to 3 decimal places (~111m) gives a stable
  // dependency that only flips when the user actually moves a
  // meaningful distance — turns out to be a decent chunk of the
  // "compounding tick lag" the user kept reporting.
  const userLatBucket = userPos ? Math.round(userPos.lat * 1000) / 1000 : null;
  const userLngBucket = userPos ? Math.round(userPos.lng * 1000) / 1000 : null;
  const visibleLostDogs = useMemo(() => {
    if (!userPos) return lostDogs;
    return lostDogs.filter(
      (d) => distanceMeters(userPos, d.lastSeen.position) <= MAP_RENDER_RADIUS_M,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bucketed userPos on purpose; see comment above
  }, [lostDogs, userLatBucket, userLngBucket]);
  const visibleTokens = useMemo(() => {
    const uncollected = tokens.filter((t) => !t.collectedAt);
    if (!userPos) return uncollected;
    return uncollected.filter(
      (t) => distanceMeters(userPos, t.position) <= MAP_RENDER_RADIUS_M,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bucketed userPos on purpose
  }, [tokens, userLatBucket, userLngBucket]);
  const visibleFood = useMemo(() => {
    if (!userPos) return foodItems;
    return foodItems.filter(
      (f) => distanceMeters(userPos, f.position) <= MAP_RENDER_RADIUS_M,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bucketed userPos on purpose
  }, [foodItems, userLatBucket, userLngBucket]);

  // Clustering runs against TRUE positions so "genuinely close reports"
  // are grouped regardless of display jitter. The cluster badge sits at the
  // true centroid; individual pets (singletons + members of small clusters)
  // render at their jittered positions from displayPositions.
  //
  // Each cluster also carries its derived render data (key, dogs[],
  // dominantUrgency, emojiHint) so the JSX call site doesn't have to
  // re-compute a fresh array / object every parent render. With these
  // stable, LostDogCluster's React.memo can actually skip identical-
  // prop renders during companion-lerp ticks (which fire MapView
  // re-renders ~10×/s).
  const clusters = useMemo(() => {
    const raw = clusterByDistance(
      visibleLostDogs.map((d) => ({ id: d.id, position: d.lastSeen.position, dog: d })),
      PIN_CLUSTER_RADIUS_M,
    );
    return raw.map((c) => {
      const key = c.items.map((i) => i.id).sort().join('|');
      const dogs = c.items.map((i) => i.dog);
      const dominantUrgency = dogs
        .map((d) => d.urgency)
        .reduce<UrgencyLevel>(
          (best, u) => (URGENCY_RANK[u] > URGENCY_RANK[best] ? u : best),
          'resolved',
        );
      const emojiHint = Array.from(new Set(dogs.map((d) => d.emoji)))
        .slice(0, 2)
        .join('');
      return { ...c, key, dogs, dominantUrgency, emojiHint };
    });
  }, [visibleLostDogs]);

  // Spot clustering by category. Disk-overlap criterion: derive a
  // meters-radius from a fixed pixel threshold so the clustering
  // adapts naturally to zoom (aggressive at zoom 16, near-noop at
  // zoom 18+). Singletons + the actively-selected spot always
  // render as solo PoiMarkers; groups of 2+ collapse to a PoiCluster
  // that the user can expand by tap (and re-stack via the floating
  // collapse pill).
  const spotClusters = useMemo(() => {
    if (!spotsVisible && !selectedSpotId && !walkRouteMeta?.spotId) return [];
    const renderSet = new Set<string>();
    if (spotsVisible) {
      for (const s of spots) {
        if (
          spotsCategoryFilter === 'all' ||
          s.category === spotsCategoryFilter
        ) {
          renderSet.add(s.id);
        }
      }
    }
    if (selectedSpotId) renderSet.add(selectedSpotId);
    if (walkRouteMeta?.spotId) renderSet.add(walkRouteMeta.spotId);
    const live = spots.filter((s) => renderSet.has(s.id));
    if (live.length === 0) return [];
    const mPerPx =
      (MPP_EQUATOR_Z0 * Math.cos((mapCenterLat * Math.PI) / 180)) /
      Math.pow(2, mapZoom);
    const radiusM = SPOT_OVERLAP_PX * mPerPx;
    // Cluster within each category separately so a cafe + restaurant
    // sitting on the same street don't get smushed into a generic
    // "stack" — the user wants category-distinct stacks.
    const byCat = new Map<string, typeof live>();
    for (const s of live) {
      const arr = byCat.get(s.category) ?? [];
      arr.push(s);
      byCat.set(s.category, arr);
    }
    const out: Array<{
      key: string;
      category: string;
      center: { lat: number; lng: number };
      items: typeof live;
    }> = [];
    for (const [cat, list] of byCat) {
      const raw = clusterByDistance(
        list.map((s) => ({ id: s.id, position: s.position })),
        radiusM,
      );
      for (const c of raw) {
        const ids = c.items.map((i) => i.id).sort();
        const items = list.filter((s) => ids.includes(s.id));
        out.push({
          key: `${cat}:${ids.join('|')}`,
          category: cat,
          center: { ...c.center },
          items,
        });
      }
    }

    // Spread pass: even after category-clustering, multiple stacks
    // (e.g. cafe + bar + restaurant) can land on the same street and
    // their badges visually overlap. Iteratively push any pair that
    // sits within the same disk-overlap radius apart, weighted so the
    // smaller stack moves more (anchors the dense pile, drifts the
    // less-populated chip outward). Capped iterations — converges in
    // 4-6 for typical Kyiv neighbourhoods.
    if (out.length > 1) {
      // Per-cluster effective radius — multi-item stacks render the
      // 54px PoiCluster badge, singles render the 44px PoiMarker.
      // Use a slightly larger min-separation so even neighbouring
      // singles get a touch of breathing room.
      const stackPx = 58; // 54 cluster badge with 4px breathing
      const stackM = stackPx * mPerPx;
      const ITER = 8;
      for (let it = 0; it < ITER; it++) {
        let moved = false;
        for (let i = 0; i < out.length; i++) {
          for (let j = i + 1; j < out.length; j++) {
            const ci = out[i]!.center;
            const cj = out[j]!.center;
            // Convert delta to meters (linear approx around mapCenterLat).
            const cosLat = Math.cos((ci.lat * Math.PI) / 180);
            const dM_lat = (cj.lat - ci.lat) * 111320;
            const dM_lng = (cj.lng - ci.lng) * 111320 * cosLat;
            const mag = Math.sqrt(dM_lat * dM_lat + dM_lng * dM_lng);
            if (mag >= stackM) continue;
            // Use a tiny epsilon nudge if they're exactly on top so
            // subsequent iterations have a direction to push along.
            const ux = mag > 1e-3 ? dM_lat / mag : 1;
            const uy = mag > 1e-3 ? dM_lng / mag : 0;
            const overlap = stackM - mag;
            const ni = out[i]!.items.length;
            const nj = out[j]!.items.length;
            const wI = nj / (ni + nj);
            const wJ = ni / (ni + nj);
            const halfM = overlap * 0.5;
            const lngScale = 1 / (111320 * cosLat);
            const latScale = 1 / 111320;
            ci.lat -= ux * halfM * 2 * wI * latScale;
            ci.lng -= uy * halfM * 2 * wI * lngScale;
            cj.lat += ux * halfM * 2 * wJ * latScale;
            cj.lng += uy * halfM * 2 * wJ * lngScale;
            moved = true;
          }
        }
        if (!moved) break;
      }
    }
    return out;
  }, [
    spots,
    spotsVisible,
    spotsCategoryFilter,
    selectedSpotId,
    walkRouteMeta?.spotId,
    mapZoom,
    mapCenterLat,
  ]);

  // Each pet gets a deterministic display offset inside its own
  // searchZoneRadiusM. Posted location is landmark-level and the zone
  // radius is the parser's uncertainty; jitter picks a stable point in
  // that circle based on the pet's id hash.
  //
  // Strictly hash-derived — no cluster-fanned override. Previously pets
  // in a shared cluster got an evenly-fanned angle instead of the hash
  // one; any sync that shifted cluster membership (user walks, new
  // scrape lands nearby, sighting moves a pin) re-fanned the group and
  // each pet teleported to a new base position. Hash-by-id keeps the
  // base rock-stable across syncs; two pets at the same landmark still
  // end up at different angles because their ids hash differently.
  const displayPositions = useMemo(() => {
    const map = new Map<string, { lat: number; lng: number }>();
    for (const d of lostDogs) {
      map.set(d.id, jitterInRadius(d.lastSeen.position, d.searchZoneRadiusM, d.id));
    }
    return map;
  }, [lostDogs]);

  // Stable per-id tap handlers so memoized markers don't re-render every
  // time the map re-renders. Without this, inline `() => setSelectedDog(id)`
  // is a new function every render and defeats React.memo entirely — which
  // is why scrolling felt slow: every pan re-ran every overlay.
  const petTapHandlers = useMemo(() => {
    const m = new Map<string, () => void>();
    for (const d of lostDogs) m.set(d.id, () => setSelectedDog(d.id));
    return m;
  }, [lostDogs, setSelectedDog]);

  // Taps pass force=true so a visible paw/bone is always collectable
  // regardless of distance — auto-collect (the 100ms loop further up)
  // calls without the flag so the server gate still applies there.
  const tokenTapHandlers = useMemo(() => {
    const m = new Map<string, () => void>();
    for (const t of tokens) m.set(t.id, () => collectToken(t.id, true));
    return m;
  }, [tokens, collectToken]);

  const foodTapHandlers = useMemo(() => {
    const m = new Map<string, () => void>();
    for (const f of foodItems) m.set(f.id, () => eatFood(f.id, true));
    return m;
  }, [foodItems, eatFood]);

  // Per-cluster stable callback maps. Inline `() => handleClusterTap(c.items)`
  // / `(id) => setSelectedDog(id)` would be a fresh function on every parent
  // render, defeating LostDogCluster's React.memo. By keying by cluster.key
  // (which is itself stable per the cluster-construction memo above), each
  // callback is a const reference until the underlying cluster set changes.
  const clusterToggleHandlers = useMemo(() => {
    const m = new Map<string, () => void>();
    for (const c of clusters) {
      const key = c.key;
      m.set(key, () =>
        setExpandedClusterKey((prev) => (prev === key ? null : key)),
      );
    }
    return m;
  }, [clusters]);
  const clusterSelectHandlers = useMemo(() => {
    const m = new Map<string, (id: string) => void>();
    for (const c of clusters) {
      m.set(c.key, (id: string) => {
        setExpandedClusterKey(null);
        setSelectedDog(id);
      });
    }
    return m;
  }, [clusters, setSelectedDog]);

  // When the Spots tab routes the user here with a selection, pan + zoom
  // to that spot once per selection change.
  useEffect(() => {
    if (!selectedSpotId) return;
    const spot = spots.find((s) => s.id === selectedSpotId);
    const map = mapRef.current;
    if (!spot || !map) return;
    map.panTo(spot.position as unknown as google.maps.LatLngLiteral);
    const current = map.getZoom() ?? balance.mapZoomDefault;
    if (current < 17) map.setZoom(17);
  }, [selectedSpotId, spots]);

  if (!env.googleMapsApiKey) {
    return (
      <View style={styles.msg}>
        <Text style={styles.t}>missing EXPO_PUBLIC_GOOGLE_MAPS_API_KEY</Text>
        <Text style={styles.s}>copy app/.env.example → app/.env</Text>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.msg}>
        <Text style={styles.t}>google maps failed to load</Text>
        <Text style={styles.s}>{String(loadError.message ?? loadError)}</Text>
      </View>
    );
  }

  // Off-screen lost-pet edge-chip layout. Memoised so the per-pet
  // ray-cast / spread pass doesn't re-run on every companion lerp
  // tick (3.3Hz) — that loop iterating over visibleLostDogs (50+
  // pets in dense Kyiv) was the most likely cause of the lag the
  // user reported showing up after the second map-rendering pass.
  // Early-skip when sniff mode is off AND not in the toggle window
  // means chips don't even render in normal-mode steady state. The
  // `sniffJustChanged` window keeps them mounted long enough for
  // the bubble-out animation to complete on toggle off.
  const offscreenDogIndicators = useMemo(() => {
    if (!sniffMode && !sniffJustChanged) return [];
    if (!mapBounds || !userPos) return [];
    const { n, s, e, w } = mapBounds;
    // Reserves clear the actual UI elements:
    // - top: small bump to clear the OS status bar (chips can sit
    //   under the HUD logo's row to the right of it without conflict
    //   since the logo lives in the top-left corner only).
    // - bottom: clears the dashboard tab bar (~10% of typical phone
    //   viewport including the home-indicator strip).
    // - sides: small padding so chips don't graze the screen edges.
    // Not perfectly symmetric, but the asymmetry follows the actual
    // UI footprint instead of being arbitrary.
    const sideReserve = 0.05;
    const topReserve = 0.08;
    const bottomReserve = 0.10;
    const chipHalfPct = 0.04;
    const SPACING_ALONG = 0.12;

    type EdgeName = 'top' | 'right' | 'bottom' | 'left';
    interface Chip {
      id: string;
      emoji: string;
      photoUrl: string | null;
      urgency: UrgencyLevel;
      name: string;
      distanceM: number;
      target: LatLng;
      edge: EdgeName;
      along: number;
      crossPct: number;
    }

    const chips: Chip[] = [];
    for (const d of visibleLostDogs) {
      // Use the JITTERED display position for both the bound check
      // AND the ray-cast — that's where the on-screen LostDogMarker
      // actually renders, so chip and pin agree on visibility:
      // when the pin is in viewport, no chip; when it's out, chip
      // points to where the pin actually is (not the raw lastSeen
      // coord, which can be hundreds of meters away after jitter).
      // The previous bound check used `lastSeen.position` and was
      // the cause of "tap chip → both chip and pin showing".
      const p = displayPositions.get(d.id) ?? d.lastSeen.position;
      if (p.lat <= n && p.lat >= s && p.lng <= e && p.lng >= w) continue;
      const nx = (p.lng - w) / (e - w);
      const ny = (n - p.lat) / (n - s);
      const dx = nx - 0.5;
      const dy = ny - 0.5;
      const xBound = dx > 0 ? (1 - sideReserve) - 0.5 : 0.5 - sideReserve;
      const yBound = dy > 0 ? (1 - bottomReserve) - 0.5 : 0.5 - topReserve;
      const tx = Math.abs(xBound / Math.max(Math.abs(dx), 1e-6));
      const ty = Math.abs(yBound / Math.max(Math.abs(dy), 1e-6));
      let edge: EdgeName;
      let along: number;
      let crossPct: number;
      if (tx < ty) {
        edge = dx > 0 ? 'right' : 'left';
        along = 0.5 + dy * tx;
        crossPct = edge === 'right' ? 1 - sideReserve : sideReserve;
      } else {
        edge = dy > 0 ? 'bottom' : 'top';
        along = 0.5 + dx * ty;
        crossPct = edge === 'bottom' ? 1 - bottomReserve : topReserve;
      }
      chips.push({
        id: d.id,
        emoji: d.emoji,
        photoUrl: d.photoUrl ?? null,
        urgency: d.urgency,
        name: d.name,
        distanceM: distanceMeters(userPos, p),
        // p is already the jittered display position (see top of loop).
        target: p,
        edge,
        along,
        crossPct,
      });
    }
    chips.sort((a, b) => a.distanceM - b.distanceM);
    const limited = chips.slice(0, 8);

    const groups: Record<EdgeName, Chip[]> = {
      top: [], right: [], bottom: [], left: [],
    };
    for (const c of limited) groups[c.edge].push(c);
    const edges: EdgeName[] = ['top', 'right', 'bottom', 'left'];
    for (const edgeName of edges) {
      const g = groups[edgeName];
      if (g.length === 0) continue;
      g.sort((a, b) => a.along - b.along);
      const lo =
        edgeName === 'left' || edgeName === 'right'
          ? topReserve + chipHalfPct
          : sideReserve + chipHalfPct;
      const hi =
        edgeName === 'left' || edgeName === 'right'
          ? 1 - bottomReserve - chipHalfPct
          : 1 - sideReserve - chipHalfPct;
      for (let i = 1; i < g.length; i++) {
        g[i]!.along = Math.max(g[i]!.along, g[i - 1]!.along + SPACING_ALONG);
      }
      if (g[g.length - 1]!.along > hi) {
        g[g.length - 1]!.along = hi;
        for (let i = g.length - 2; i >= 0; i--) {
          g[i]!.along = Math.min(g[i]!.along, g[i + 1]!.along - SPACING_ALONG);
        }
      }
      if (g[0]!.along < lo) {
        g[0]!.along = lo;
        for (let i = 1; i < g.length; i++) {
          g[i]!.along = Math.max(g[i]!.along, g[i - 1]!.along + SPACING_ALONG);
        }
      }
    }

    return limited.map((c) => {
      const leftPct = c.edge === 'left' || c.edge === 'right' ? c.crossPct : c.along;
      const topPct = c.edge === 'left' || c.edge === 'right' ? c.along : c.crossPct;
      return {
        id: c.id,
        emoji: c.emoji,
        photoUrl: c.photoUrl,
        urgency: c.urgency,
        name: c.name,
        distanceM: c.distanceM,
        target: c.target,
        edge: c.edge,
        left: `${leftPct * 100}%`,
        top: `${topPct * 100}%`,
      };
    });
  }, [
    mapBounds,
    userPos?.lat,
    userPos?.lng,
    visibleLostDogs,
    displayPositions,
    sniffMode,
    sniffJustChanged,
  ]);

  if (!isLoaded || !userPos) {
    return (
      <View style={styles.msg}>
        <Text style={styles.t}>locating…</Text>
        {location.usingFallback ? <Text style={styles.s}>using kyiv fallback</Text> : null}
      </View>
    );
  }

  // Off-screen companion indicator: when the companion drifts (or the
  // user pans away) outside the map's visible bounds, a small icon
  // sticks to the screen edge nearest to the companion. Tap recenters.
  // `mapBounds` is the latest snapshot from the map's `idle` event; the
  // edge position is computed against the current companion lat/lng.
  // `topReserve` is 0 — chip anchors to the actual top edge of the
  // screen via a per-edge transform so it isn't clipped, regardless
  // of sniff mode (the HUD has been pushed down to make room).
  const offscreenIndicator = (() => {
    if (!mapBounds || !companionPos) return null;
    const { n, s, e, w } = mapBounds;
    if (
      companionPos.lat <= n &&
      companionPos.lat >= s &&
      companionPos.lng <= e &&
      companionPos.lng >= w
    ) {
      return null;
    }
    const nx = (companionPos.lng - w) / (e - w);
    const ny = (n - companionPos.lat) / (n - s);
    const dx = nx - 0.5;
    const dy = ny - 0.5;
    const sideReserve = 0.03;
    const topReserve = 0;
    const bottomReserve = 0.14;
    const xBound = dx > 0 ? 1 - sideReserve - 0.5 : 0.5 - sideReserve;
    const yBound = dy > 0 ? 1 - bottomReserve - 0.5 : 0.5 - topReserve;
    const tx = Math.abs(xBound / Math.max(Math.abs(dx), 1e-6));
    const ty = Math.abs(yBound / Math.max(Math.abs(dy), 1e-6));
    let edge: 'top' | 'right' | 'bottom' | 'left';
    let leftPct: number;
    let topPct: number;
    if (tx < ty) {
      edge = dx > 0 ? 'right' : 'left';
      leftPct = edge === 'right' ? 1 - sideReserve : sideReserve;
      topPct = 0.5 + dy * tx;
    } else {
      edge = dy > 0 ? 'bottom' : 'top';
      leftPct = 0.5 + dx * ty;
      topPct = edge === 'bottom' ? 1 - bottomReserve : topReserve;
    }
    return { left: `${leftPct * 100}%`, top: `${topPct * 100}%`, edge };
  })();

  const recenterOnCompanion = () => {
    if (!companionPos || !mapRef.current) return;
    mapRef.current.panTo(companionPos as unknown as google.maps.LatLngLiteral);
  };


  const formatDistance = (m: number): string => {
    if (m < 1000) return `${Math.round(m / 10) * 10}m`;
    return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)}km`;
  };

  const panToDog = (target: LatLng) => {
    if (!mapRef.current) return;
    mapRef.current.panTo(target as unknown as google.maps.LatLngLiteral);
  };

  return (
    <div style={{ flex: 1, position: 'relative', width: '100%', height: '100%' }}>
      <GoogleMap
        mapContainerStyle={CONTAINER_STYLE as unknown as React.CSSProperties}
        options={mapOptions}
        onLoad={(map) => {
          mapRef.current = map;
          // Center + zoom are applied once on load and then left uncontrolled.
          // Passing `center` as a prop made the map re-pan on every GPS tick
          // and fought our cluster-tap setZoom calls.
          map.setCenter(userPos as unknown as google.maps.LatLngLiteral);
          map.setZoom(balance.mapZoomDefault);
        }}
        onUnmount={() => {
          mapRef.current = null;
        }}
        onIdle={() => {
          // Sync mapBounds for the off-screen indicator math. Fires
          // after every pan / zoom completes, plus once on initial load.
          const b = mapRef.current?.getBounds();
          if (!b) return;
          const ne = b.getNorthEast();
          const sw = b.getSouthWest();
          setMapBounds({
            n: ne.lat(),
            s: sw.lat(),
            e: ne.lng(),
            w: sw.lng(),
          });
          // Same hook syncs zoom + centre lat for the spot-cluster
          // pixel-to-meter conversion.
          const z = mapRef.current?.getZoom();
          if (typeof z === 'number') setMapZoom(z);
          const c = mapRef.current?.getCenter();
          if (c) setMapCenterLat(c.lat());
        }}
        onClick={() => {
          // Suppress when the click came right after a companion tap —
          // Google fires the map-level click independently of DOM
          // propagation, which would otherwise close the menu we just
          // opened (very visible at low zoom where the companion sits
          // on top of the map surface).
          if (Date.now() - companionTappedAtRef.current < SUPPRESS_MAP_CLICK_MS) {
            return;
          }
          setExpandedClusterKey(null);
          // Tapping the map background collapses the companion's radial
          // menu too — matches the prototype's "tap anywhere else to
          // dismiss" pattern.
          useGameStore.getState().setMenuOpen(false);
          // Tapping background also dismisses an active walking route.
          // Quest routes are sticky to the active quest and aren't
          // touched here.
          setWalkRoute(null, null);
        }}
      >
        <UserMarker position={userPos} />

        {/* Zone is only drawn for the currently-selected pet — otherwise
            overlapping circles turn dense neighborhoods (Podil, Pechersk)
            into a lava lamp. Tapping a pin blooms the zone for that pet. */}
        {lostDogs
          .filter((d) => d.id === selectedDogId)
          .map((d) => (
            <SearchZoneCircle
              key={`zone-${d.id}`}
              center={d.lastSeen.position}
              radiusM={d.searchZoneRadiusM}
              urgency={d.urgency}
            />
          ))}

        {clusters.flatMap((c) => {
          if (c.items.length === 1) {
            const d = c.items[0]!.dog;
            const pos = displayPositions.get(d.id) ?? d.lastSeen.position;
            const inView =
              !mapBounds ||
              (pos.lat <= mapBounds.n &&
                pos.lat >= mapBounds.s &&
                pos.lng <= mapBounds.e &&
                pos.lng >= mapBounds.w);
            return [
              <LostDogMarker
                key={d.id}
                position={pos}
                emoji={d.emoji}
                name={d.name}
                urgency={d.urgency}
                photoUrl={d.photoUrl}
                onTap={petTapHandlers.get(d.id)!}
                active={inView}
                inverted={sniffMode}
              />,
            ];
          }
          // Small groups: no cluster badge, each pet renders at its own
          // zone-jittered position. Because every pet has its own radius
          // and hash, 4 pets all reported at "Podil center" fan out across
          // their respective zones instead of stacking.
          if (c.items.length < CLUSTER_BADGE_THRESHOLD) {
            return c.items.map((item) => {
              const d = item.dog;
              const pos = displayPositions.get(d.id) ?? d.lastSeen.position;
              const inView =
                !mapBounds ||
                (pos.lat <= mapBounds.n &&
                  pos.lat >= mapBounds.s &&
                  pos.lng <= mapBounds.e &&
                  pos.lng >= mapBounds.w);
              return (
                <LostDogMarker
                  key={d.id}
                  position={pos}
                  emoji={d.emoji}
                  name={d.name}
                  urgency={d.urgency}
                  photoUrl={d.photoUrl}
                  onTap={petTapHandlers.get(d.id)!}
                  active={inView}
                  inverted={sniffMode}
                />
              );
            });
          }
          // Stable derived data + callback refs from the cluster
          // construction memo + handler maps above; React.memo on
          // LostDogCluster now actually skips noop renders.
          const expanded = expandedClusterKey === c.key;
          return [
            <LostDogCluster
              key={`cluster-${c.key}`}
              position={c.center}
              items={c.dogs}
              dominantUrgency={c.dominantUrgency}
              emojiHint={c.emojiHint}
              expanded={expanded}
              onToggle={clusterToggleHandlers.get(c.key)!}
              onSelectItem={clusterSelectHandlers.get(c.key)!}
            />,
          ];
        })}

        {visibleTokens.map((t) => (
          <TokenMarker
            key={t.id}
            position={t.position}
            onTap={tokenTapHandlers.get(t.id)!}
            inverted={sniffMode}
          />
        ))}

        {visibleFood.map((f) => (
          <FoodMarker
            key={f.id}
            position={f.position}
            onTap={foodTapHandlers.get(f.id)!}
            inverted={sniffMode}
          />
        ))}

        {/* Spots layer. Toggle off hides the ambient field; the
            spots-tab category filter further restricts which markers
            show when the layer IS on. Two spots always render
            regardless of toggle/filter — the current selection (so
            the modal's pin shows) and the walk-route destination (so
            the polyline always points at a visible marker) — they're
            the user's explicit focus. */}
        {spotClusters.flatMap((c) => {
          // Singles + the actively-selected spot + the active walk
          // destination always render expanded — collapsing the
          // currently-focused pin would feel broken.
          const expanded =
            c.items.length === 1 ||
            expandedSpotKeys.has(c.key) ||
            c.items.some(
              (s) => s.id === selectedSpotId || s.id === walkRouteMeta?.spotId,
            );
          if (expanded) {
            return c.items.map((s) => (
              <PoiMarker
                key={s.id}
                position={s.position}
                emoji={s.icon ?? '📍'}
                category={s.category}
                name={s.name}
                selected={s.id === selectedSpotId}
                onTap={() => setSelectedSpot(s.id === selectedSpotId ? null : s.id)}
              />
            ));
          }
          return [
            <PoiCluster
              key={c.key}
              position={c.center}
              category={c.category}
              emoji={c.items[0]?.icon ?? '📍'}
              count={c.items.length}
              onTap={() =>
                setExpandedSpotKeys((prev) => {
                  const next = new Set(prev);
                  next.add(c.key);
                  return next;
                })
              }
            />,
          ];
        })}

        {activeQuest ? (
          <>
            {/* Walking route through the waypoints. When the Directions
                API answers, we draw the street-hugging path — a bit
                heavier and clearly "walk here". Otherwise (Directions
                still in flight / failed / quota), fall back to a thin
                straight line between waypoints so the user always sees
                *some* ordering hint. clickable=false on both so the
                line never steals taps from overlays on top. */}
            {questRoute && questRoute.length > 1 ? (
              <PolylineF
                path={questRoute}
                options={{
                  strokeColor: '#0000ff',
                  strokeOpacity: 0.55,
                  strokeWeight: 4,
                  clickable: false,
                }}
              />
            ) : (
              <PolylineF
                path={activeQuest.waypoints.map((w) => ({
                  lat: w.position.lat,
                  lng: w.position.lng,
                }))}
                options={{
                  strokeColor: '#0000ff',
                  strokeOpacity: 0.35,
                  strokeWeight: 2,
                  clickable: false,
                }}
              />
            )}
            {activeQuest.waypoints.map((w, i) => {
              const state =
                i < activeQuest.currentWaypoint
                  ? 'reached'
                  : i === activeQuest.currentWaypoint
                  ? 'active'
                  : 'future';
              return (
                <WaypointMarker
                  key={`${activeQuest.id}-${i}`}
                  position={w.position}
                  index={i}
                  state={state}
                  // Tap-to-complete on the active pin only. Bypasses the
                  // server's 60m check (force=true) so we can walk
                  // through the flow from a desk. Passive pins (reached
                  // / future) don't get a handler — nothing to do on tap.
                  onTap={
                    state === 'active'
                      ? async () => {
                          const { advanced, completed, narration } =
                            await forceAdvanceActiveWaypoint();
                          if (completed) {
                            showBubble(
                              narration ?? `found something! quest complete 🎉`,
                              6000,
                            );
                          } else if (advanced) {
                            showBubble(
                              narration ?? `paw print here — let's keep going 🐾`,
                              5000,
                            );
                          }
                        }
                      : undefined
                  }
                />
              );
            })}
          </>
        ) : null}

        {/* Walking route from the companion's "walk" radial leaf.
            Distinct visual from quest routes: thinner + slightly more
            transparent so it reads as "suggested route" not "active
            mission." Roundtrip and one-way share the same styling
            today; if we ever differentiate, dashed for one of them
            would be the move. clickable=false so taps go through. */}
        {walkRoute && walkRoute.length > 1 ? (
          <PolylineF
            path={walkRoute}
            options={{
              strokeColor: '#0000ff',
              strokeOpacity: 0.4,
              strokeWeight: 3,
              clickable: false,
            }}
          />
        ) : null}

        {companionPos ? (
          <Companion
            position={companionPos}
            bubble={bubble}
            onTap={() => {
              companionTappedAtRef.current = Date.now();
            }}
            onTapCompanion={() => showBubble('woof 🐾', 4000)}
          />
        ) : null}
      </GoogleMap>

      {/* Off-screen companion bookmark. Sticks to the viewport edge
          along the line from map center to the companion's position
          so the user can always see where they are even after panning
          far away. Tap recenters the map. Per-edge transform anchors
          the chip's edge-side to the screen edge so dropping
          topReserve to 0 doesn't clip half the chip. */}
      {offscreenIndicator ? (
        <div
          onClick={recenterOnCompanion}
          role="button"
          aria-label="recenter on companion"
          style={{
            position: 'absolute',
            left: offscreenIndicator.left,
            top: offscreenIndicator.top,
            transform:
              offscreenIndicator.edge === 'top'
                ? 'translate(-50%, 0)'
                : offscreenIndicator.edge === 'bottom'
                  ? 'translate(-50%, -100%)'
                  : offscreenIndicator.edge === 'left'
                    ? 'translate(0, -50%)'
                    : 'translate(-100%, -50%)',
            transition:
              'left 380ms cubic-bezier(0.22, 1, 0.36, 1), top 380ms cubic-bezier(0.22, 1, 0.36, 1)',
            zIndex: 25,
            cursor: 'pointer',
            background: '#ffffff',
            borderRadius: '50%',
            width: 44,
            height: 44,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
            border: '2px solid rgba(0,0,0,0.06)',
          }}
        >
          <Image
            source={logoNose}
            style={{ width: 30, height: 30 }}
            resizeMode="contain"
          />
        </div>
      ) : null}

      {/* Off-screen lost-pet bookmarks (sniff mode only). Three nested
          divs:
            1. Outer — absolute position + edge-anchor transform +
               smooth `left`/`top` transition while panning.
            2. Pop-anim — runs the bubble-pop scale keyframe on mount
               so chips bubble in when sniff mode flips on.
            3. Disc-wrapper — sized to the chip; the actual disc
               (with `overflow: hidden` for image cropping) lives
               here as one child, the urgency-coloured distance
               badge sits next to it as a SIBLING — i.e. NOT inside
               the overflow-hidden disc, so the bottom-right badge
               doesn't get cropped at the disc edge. */}
      {offscreenDogIndicators.map((d) => {
        // Mirror the on-screen LostDogMarker halo so chips visually
        // echo the actual map pins. Medium-urgency BADGE swapped from
        // amber `rgba(217,160,48,...)` (read as gold + clashed with
        // the photo edges) to a vibrant orange `rgba(255,140,0,...)`
        // — same "warning" bucket but doesn't read as a gold rim.
        // The disc's GLOW stays amber so the on-screen ↔ off-screen
        // urgency cue still ties together.
        const halo =
          d.urgency === 'urgent'
            ? {
                glow: '0 0 14px rgba(232,64,64,0.45), 0 2px 8px rgba(0,0,0,0.12)',
                badge: 'rgba(232,64,64,0.95)',
              }
            : d.urgency === 'medium'
              ? {
                  glow: '0 0 14px rgba(217,160,48,0.45), 0 2px 8px rgba(0,0,0,0.12)',
                  badge: 'rgba(255,140,0,0.95)',
                }
              : {
                  glow: '0 0 10px rgba(160,160,160,0.3), 0 2px 6px rgba(0,0,0,0.1)',
                  badge: 'rgba(120,120,120,0.92)',
                };
        const edgeTransform =
          d.edge === 'top'
            ? 'translate(-50%, 0)'
            : d.edge === 'bottom'
              ? 'translate(-50%, -100%)'
              : d.edge === 'left'
                ? 'translate(0, -50%)'
                : 'translate(-100%, -50%)';
        return (
          <div
            key={`offscreen-dog-${d.id}`}
            onClick={() => panToDog(d.target)}
            role="button"
            aria-label={`pan to ${d.name}, ${formatDistance(d.distanceM)} away`}
            style={{
              position: 'absolute',
              left: d.left,
              top: d.top,
              transform: edgeTransform,
              transition:
                'left 380ms cubic-bezier(0.22, 1, 0.36, 1), top 380ms cubic-bezier(0.22, 1, 0.36, 1)',
              zIndex: 24,
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <div
              style={{
                position: 'relative',
                width: 54,
                height: 54,
                // Static styles match the steady state for the current
                // sniff mode. Animation only attached during the
                // toggle window — see the `sniffJustChanged` comment
                // above for why (mid-session chip mounts in normal
                // mode were flashing visible-then-fade).
                opacity: sniffMode ? 1 : 0,
                transform: sniffMode ? 'scale(1)' : 'scale(0)',
                animation: sniffJustChanged
                  ? sniffMode
                    ? 'chip-pop-in 360ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards'
                    : 'chip-pop-out 280ms ease-in forwards'
                  : 'none',
                pointerEvents: sniffMode ? 'auto' : 'none',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: '50%',
                  background: '#ffffff',
                  // No urgency-coloured ring border — that read as a
                  // gold rim around medium-urgency chips and dominated
                  // the chip's look. The urgency-coloured glow + the
                  // distance badge carry the urgency signal alone, same
                  // as the on-screen LostDogMarker.
                  boxShadow: halo.glow,
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 27,
                }}
              >
                <span style={{ position: 'absolute' }}>{d.emoji}</span>
                {d.photoUrl ? (
                  <img
                    src={d.photoUrl}
                    alt={d.name}
                    draggable={false}
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    style={{
                      position: 'relative',
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      transform: 'scale(1.2)',
                    }}
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : null}
              </div>
              {/* Distance badge — same shape language as the spot
                  cluster count chip but urgency-coloured. Sibling of
                  the disc so the negative offset isn't clipped by
                  `overflow: hidden`. */}
              <div
                style={{
                  position: 'absolute',
                  bottom: -4,
                  right: -6,
                  minWidth: 22,
                  height: 18,
                  paddingLeft: 5,
                  paddingRight: 5,
                  borderRadius: 9,
                  background: halo.badge,
                  color: '#ffffff',
                  fontFamily: SYSTEM_FONT,
                  fontSize: 10,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.18)',
                }}
              >
                {formatDistance(d.distanceM)}
              </div>
            </div>
          </div>
        );
      })}

      {/* Bubble keyframes for the off-screen chips — pop-in overshoots
          ~12% past target then settles, pop-out briefly grows ~10%
          before collapsing. Applied via the `animation` prop on the
          chip wrapper based on sniffMode. */}
      <style>{`
        @keyframes chip-pop-in {
          0%   { transform: scale(0);    opacity: 0; }
          70%  { transform: scale(1.12); opacity: 1; }
          100% { transform: scale(1);    opacity: 1; }
        }
        @keyframes chip-pop-out {
          0%   { transform: scale(1);    opacity: 1; }
          25%  { transform: scale(1.10); opacity: 1; }
          100% { transform: scale(0);    opacity: 0; }
        }
        @keyframes hud-pop-in {
          0%   { transform: scale(0);    opacity: 0; }
          70%  { transform: scale(1.08); opacity: 1; }
          100% { transform: scale(1);    opacity: 1; }
        }
        @keyframes hud-pop-out {
          0%   { transform: scale(1);    opacity: 1; }
          25%  { transform: scale(1.10); opacity: 1; }
          100% { transform: scale(0);    opacity: 0; }
        }
      `}</style>

      {/* Floating "stack all" affordance — visible only while at
          least one spot cluster is expanded. Pinned to the right
          edge of the screen and vertically centred so it stays
          out of the way until the user actually has clusters open.
          Three little horizontal bars draw a generic "stack" glyph;
          no text — keeps it minimal and language-agnostic. */}
      {expandedSpotKeys.size > 0 ? (
        <div
          onClick={() => setExpandedSpotKeys(new Set())}
          role="button"
          aria-label="restack all expanded spot clusters"
          style={{
            position: 'absolute',
            top: '50%',
            right: 0,
            transform: 'translateY(-50%)',
            zIndex: 25,
            cursor: 'pointer',
            background: 'rgba(255,255,255,0.92)',
            backdropFilter: 'blur(14px) saturate(160%)',
            WebkitBackdropFilter: 'blur(14px) saturate(160%)',
            // Round on the LEFT side only so it reads as docked to
            // the screen edge.
            borderTopLeftRadius: 28,
            borderBottomLeftRadius: 28,
            width: 56,
            height: 56,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 3,
            boxShadow: '0 6px 20px rgba(0,0,0,0.14), 0 2px 6px rgba(0,0,0,0.08)',
            userSelect: 'none',
          }}
        >
          {/* Three stacked bars — the longer bottom bar reads as
              "stack" the way a hamburger-but-tapered glyph does. */}
          <div style={{ width: 18, height: 3, background: '#1a1a1a', borderRadius: 2 }} />
          <div style={{ width: 22, height: 3, background: '#1a1a1a', borderRadius: 2 }} />
          <div style={{ width: 26, height: 3, background: '#1a1a1a', borderRadius: 2 }} />
        </div>
      ) : null}

      <LostDogModal
        dog={lostDogs.find((d) => d.id === selectedDogId) ?? null}
        onClose={() => setSelectedDog(null)}
        searchActive={!!activeQuest && activeQuest.dogId === selectedDogId}
        onPrev={selectedDogId ? (() => {
          // Cycle by distance from user — pressing ‹ walks through the
          // nearby list in order so the closest pet comes first, the
          // farthest last. Wraps at the ends.
          if (!userPos || !selectedDogId) return;
          const sorted = [...lostDogs].sort(
            (a, b) =>
              distanceMeters(userPos, a.lastSeen.position) -
              distanceMeters(userPos, b.lastSeen.position),
          );
          const idx = sorted.findIndex((d) => d.id === selectedDogId);
          if (idx < 0) return;
          const prev = sorted[(idx - 1 + sorted.length) % sorted.length]!;
          setSelectedDog(prev.id);
        }) : undefined}
        onNext={selectedDogId ? (() => {
          if (!userPos || !selectedDogId) return;
          const sorted = [...lostDogs].sort(
            (a, b) =>
              distanceMeters(userPos, a.lastSeen.position) -
              distanceMeters(userPos, b.lastSeen.position),
          );
          const idx = sorted.findIndex((d) => d.id === selectedDogId);
          if (idx < 0) return;
          const next = sorted[(idx + 1) % sorted.length]!;
          setSelectedDog(next.id);
        }) : undefined}
        onReportSighting={async (d) => {
          setSelectedDog(null);
          const res = await useGameStore.getState().reportSighting(d.id);
          if (res?.ok && res.trusted) {
            showBubble(`thanks — moved ${d.name}'s pin 📍`, 5000);
          } else if (res?.ok) {
            showBubble(`thanks — sighting logged 👀`, 5000);
          } else {
            showBubble(`couldn't report that one — try again`, 5000);
          }
        }}
        onStartSearch={async (d) => {
          setSelectedDog(null);
          const { quest, narration } = await useGameStore
            .getState()
            .startQuest(d.id);
          if (quest) {
            showBubble(
              narration ??
                `on it — ${quest.waypoints.length} spots to check for ${d.name} 🔍`,
              6000,
            );
          } else {
            showBubble("couldn't start the search — try again", 5000);
          }
        }}
      />

      <SpotModal
        spot={spots.find((s) => s.id === selectedSpotId) ?? null}
        onClose={() => setSelectedSpot(null)}
        onWalkHere={async (spot, shape) => {
          if (!userPos) {
            showBubble("can't walk without knowing where we are", 5000);
            return;
          }
          // Generate the walking polyline first, then close the modal
          // — closing first would briefly show a bare map before the
          // route lands. Bubble announces intent immediately so the
          // user has feedback while Directions fetches.
          showBubble(
            shape === 'roundtrip'
              ? `roundtrip to ${spot.name} 🚶`
              : `walking to ${spot.name} 🚶`,
            3000,
          );
          const waypoints =
            shape === 'roundtrip' ? [spot.position, userPos] : [spot.position];
          const route = await fetchWalkingRoute(userPos, waypoints);
          if (route) {
            useGameStore.getState().setWalkRoute(route, { shape, spotId: spot.id });
          }
          setSelectedSpot(null);
        }}
      />
    </div>
  );
}

const styles = StyleSheet.create({
  msg: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.greyBg,
    padding: 20,
  },
  t: { fontSize: 16, color: colors.black },
  s: { fontSize: 12, color: colors.grey, marginTop: 6, textAlign: 'center' },
});
