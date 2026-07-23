import type { CSSProperties } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFocusEffect } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { View, Text, StyleSheet, Image } from 'react-native';
import type { UrgencyLevel } from '@shukajpes/shared';
import { colors } from '../../constants/colors';
import { balance } from '../../constants/balance';
import { R } from '../../constants/radius';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
import { useGameStore } from '../../stores/gameStore';
import { MapContext } from './MapContext';
import {
  LIGHT_PALETTE,
  DARK_PALETTE,
  applyCrayonOverride,
  setStreetLabelsVisible,
  fetchCrayonStyleSpec,
  generatePaperTextureUrl,
  installPaperOverlaySync,
} from './crayonStyle';
import type { Spot } from '../../services/places';
import { useLocation } from '../../hooks/useLocation';
import { useCompanion } from '../../hooks/useCompanion';
import { useGameLoop } from '../../hooks/useGameLoop';
import { distanceMeters, pointAheadOnRoute } from '../../utils/geo';
import { playPop } from '../../utils/popOnTap';
import { Companion } from './Companion';
import { CrayonRoute } from './CrayonRoute';
import logoNose from '../../assets/logo-nose.png';
import { UserMarker } from './UserMarker';
import { TokenMarker } from './TokenMarker';
import { FoodMarker } from './FoodMarker';
import { CollectBurst } from './CollectBurst';
import { createDepthFogLayer, DEPTH_FOG_LAYER_ID } from './fogLayer';
import {
  createThreeBuildingsLayer,
  THREE_BUILDINGS_LAYER_ID,
} from './threeBuildingsLayer';
import { createGroundFogLayer, GROUND_FOG_LAYER_ID } from './groundFogLayer';
import { OtherWalker } from './OtherWalker';
import { PokeToast } from './PokeToast';
import { LostDogCardStack } from '../ui/LostDogCardStack';
import { createBuildingAvoider } from './buildingAvoider';
import { GAME_RENDER, MULTIPLAYER, DOG_CAM } from '../../constants/experiments';
import { LostDogMarker } from './LostDogMarker';
import { LostDogCluster, URGENCY_RANK } from './LostDogCluster';
import { SearchZoneCircle } from './SearchZoneCircle';
import { LostDogModal } from '../ui/LostDogModal';
import { SpotModal } from '../ui/SpotModal';
import { getDeepLinkDogId } from '../../services/telegram';
import { useStrings } from '../../i18n/useStrings';
import { useLangStore } from '../../stores/langStore';
import { fetchWalkingRoute } from '../../services/directions';
import type { NearbyLostDog } from '../../services/api';
import { PoiMarker } from './PoiMarker';
import { PoiCluster } from './PoiCluster';
import { WaypointMarker } from './WaypointMarker';
import { clusterByDistance, jitterInRadius } from '../../utils/cluster';
import { SniffPress } from './SniffPress';
import type { LatLng } from '@shukajpes/shared';
import { Z } from '../../constants/z';
import { VOICE } from '../../constants/voice';
import { SYSTEM_FONT } from '../../constants/fonts';

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

// On the NORMAL (non-sniff) map, only show lost pets this close so they don't
// clutter the world — the full lost-pet view is the sniff/locate flow.
const NORMAL_LOSTDOG_RADIUS_M = 500;

// Above this pitch the camera is in "game view" — street names tilt into
// the perspective and clutter the distance, so they're hidden until the
// user flattens the camera back out. Matches the marker horizon-cull gate.
const STREET_LABEL_HIDE_PITCH = 60;

// Dog-cam (prototype): a low, close chase camera locked on the companion.
// DOGCAM_PITCH sits near maxPitch (80) for a street-level look; DOGCAM_ZOOM is
// closer than the default; DOGCAM_TICK is the follow cadence (a touch above the
// companion's 300ms roam tick so consecutive linear eases chain into a smooth
// glide). Below DOGCAM_MIN_MOVE_M of dog travel we hold the heading so the
// camera doesn't swing on GPS/idle micro-jitter.
const DOGCAM_PITCH = 74;
const DOGCAM_ZOOM = 18.6;
const DOGCAM_TICK = 350;
const DOGCAM_MIN_MOVE_M = 0.6;
// Preview (carousel-swipe) camera: keep the immersive 3D tilt and look FROM you
// TOWARD the dog's zone, so the zone sits out in the distance/horizon where the
// fog layer washes it brand-blue — rather than a flat zoomed-out overview.
// Close + tilted (near the dog-cam feel) — a touch less steep than before so the
// horizon sits a bit lower and the shot feels less cramped.
const PREVIEW_PITCH = 72;
const PREVIEW_ZOOM = 16.3;
// The dog rides in the LOWER part of the screen (car-nav feel) so its speech
// bubble — anchored just above it — clears the horizon/beacon instead of
// covering it. Achieved with TOP map padding (a fraction of the container
// height): padding shifts the centred point down, so the dog sits ~this-frac
// below screen centre. (Bottom padding only ever lifts it UP toward centre.)
const DOGCAM_TOP_RESERVE_FRAC = 0.24;
// How far ahead along the route the committed cam looks — it faces this point so
// the view runs DOWN the route (not perpendicular to it) and tracks its curves.
const ROUTE_LOOK_AHEAD_M = 90;
// Preview beacon fragment: rather than lighting the whole (up-to-1.25km) search
// zone, we pick one candidate quest spot and glow a small patch around it — the
// bit of the zone the quest point will actually come from. Target distance keeps
// the beacon a little out on the horizon (clear of the dog's speech bubble).
const PREVIEW_FRAGMENT_RADIUS_M = 320;
const PREVIEW_TARGET_DIST_M = 430;

// Preview zoom adapts to how far the fragment is from the dog, so a distant
// beacon still lands on-screen instead of falling off the horizon. Near spots
// keep the close PREVIEW_ZOOM; far ones ease out.
function previewZoomFor(distM: number): number {
  const z = PREVIEW_ZOOM - Math.log2(Math.max(distM, 300) / 300) * 0.9;
  return Math.max(14.0, Math.min(PREVIEW_ZOOM, z));
}

// Compass bearing (deg, 0=N, clockwise) from point a to point b. Used to point
// the dog-cam "up" along the dog's direction of travel.
function bearingDeg(a: LatLng, b: LatLng): number {
  const D = Math.PI / 180;
  const phi1 = a.lat * D;
  const phi2 = b.lat * D;
  const dLng = (b.lng - a.lng) * D;
  const y = Math.sin(dLng) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

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

// One expanding ring of the long-press "press the map" cue. `delay`
// staggers the two rings into a repeating ripple. Keyframe
// hint-map-pulse lives in MapView's <style> block.
function mapPulseRing(delaySec: number): CSSProperties {
  return {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: '100%',
    height: '100%',
    borderRadius: '50%',
    border: '3px solid rgba(0,0,0,0.30)',
    transform: 'translate(-50%, -50%) scale(0.4)',
    animation: `hint-map-pulse 1.8s ease-out ${delaySec}s infinite`,
  };
}

// Experiment (GAME_RENDER): the id of the first symbol (label) layer, so we
// can insert the 3D buildings + ground fog BELOW the labels. Without this the
// custom layers append on top and the 3D buildings occlude place names
// ("signs sitting under the buildings").
function firstSymbolLayerId(map: maplibregl.Map): string | undefined {
  for (const l of map.getStyle().layers ?? []) {
    if (l.type === 'symbol') return l.id;
  }
  return undefined;
}

// Experiment (GAME_RENDER): hide MapLibre's own flat fill-extrusion
// buildings so the Three.js extruded city owns the building volumes. Called
// after every crayon override (which re-shows / re-opacities them).
function hideMapLibreBuildings(map: maplibregl.Map): void {
  for (const l of map.getStyle().layers ?? []) {
    if (
      (l as { 'source-layer'?: string })['source-layer'] === 'building' &&
      l.type === 'fill-extrusion'
    ) {
      try {
        map.setLayoutProperty(l.id, 'visibility', 'none');
      } catch {
        /* layer not ready — skip */
      }
    }
  }
}

export default function MapViewWeb() {
  const location = useLocation();
  // Top-edge chips have to clear the iOS status bar (clock, signal,
  // battery) — taps inside that strip are intercepted by the system
  // (scroll-to-top), so a chip overlapping it feels dead. The HUD
  // SafeAreaView already accounts for this via edges={['top']}; chip
  // overlays render in a different subtree so we read the same inset
  // from the hook here.
  const insets = useSafeAreaInsets();
  const t = useStrings();
  const lang = useLangStore((s) => s.lang);
  const [bubble, setBubble] = useState<string | null>(null);
  const bubbleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  // Stored in state too so React-tree children (markers) can be wired
  // to the map via MapContext when it's ready.
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);
  const paperOverlayRef = useRef<HTMLDivElement | null>(null);
  // Map fires its own click on the canvas independently of DOM event
  // propagation from markers — `stopPropagation` inside a marker
  // child doesn't reach it. At low zoom the companion overlaps the
  // map surface enough that opening the radial menu also triggers a
  // "background click" that closes it ~1 frame later. Record every
  // companion tap and suppress the map click for a short window.
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
  // Dog-cam prototype (toggled by the old supersniff button — see index.tsx).
  // Drives the low chase-camera follow effect + DOGCAM_* constants below.
  const dogCam = useGameStore((s) => s.dogCam);
  // Sniff-and-lead search mode assignment (which lost dog + spot). Set by the
  // search controller below while dogCam is on.
  const searchTarget = useGameStore((s) => s.searchTarget);
  const setSearchTarget = useGameStore((s) => s.setSearchTarget);
  const searchRoute = useGameStore((s) => s.searchRoute);
  const setSearchRoute = useGameStore((s) => s.setSearchRoute);
  // Preview: the dog whose zone is being framed (swiped-to, not yet committed).
  const searchPreview = useGameStore((s) => s.searchPreview);
  const setSearchPreview = useGameStore((s) => s.setSearchPreview);
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
  // True while the camera is animating (sniff jump, snap, pan, zoom).
  // Hints pause while moving and resume once it settles.
  const [mapMoving, setMapMoving] = useState(false);
  // Active collect-burst FX — one transient pop per paw/bone pickup,
  // keyed by the store's lastCollect.seq. Each self-removes after the
  // animation (~800ms) via the effect below.
  const [collectBursts, setCollectBursts] = useState<
    { seq: number; lng: number; lat: number; kind: 'paw' | 'bone' }[]
  >([]);
  // Which clusters the user has tapped to expand. Stored by cluster
  // key (sorted item ids); cleared by the floating "collapse all" pill
  // that appears at the top of the map while any cluster is open.
  const [expandedSpotKeys, setExpandedSpotKeys] = useState<Set<string>>(() => new Set());
  const tokens = useGameStore((s) => s.tokens);
  const foodItems = useGameStore((s) => s.foodItems);
  const lostDogs = useGameStore((s) => s.lostDogs);
  // Whether the map tab is the active screen. The offscreen companion
  // chip + offscreen dog indicators are portaled to document.body, so
  // they'd otherwise stay painted over the other tabs (tasks, chat,
  // …) — we gate their computation on this so they only show on the
  // map.
  const currentScreen = useGameStore((s) => s.currentScreen);
  const onMapScreen = currentScreen === 'map';
  // Hint cue + radial-menu camera mode, consumed by camera/overlay
  // effects below: the long-press hint draws a "press the map" pulse,
  // and the menu camera mode frames the dog (lower for the first-time
  // explainer, centred otherwise).
  const activeHint = useGameStore((s) => s.activeHint);
  const menuCamera = useGameStore((s) => s.menuCamera);
  const sniffActive = useGameStore((s) => s.sniffActive);
  const selectedDogId = useGameStore((s) => s.selectedDogId);
  const spots = useGameStore((s) => s.spots);
  const spotsVisible = useGameStore((s) => s.spotsVisible);
  const nearbyPlayers = useGameStore((s) => s.nearbyPlayers);
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
  // useLayoutEffect (not useEffect) so `sniffJustChanged` flips in the
  // same paint cycle as sniffMode. With useEffect there's a one-frame
  // gap where the new sniffMode static styles paint without the
  // animation attached — chips/HUD snap to their target state for a
  // frame, then the animation kicks in and re-animates from the 0%
  // keyframe, producing a visible blink before the animation runs.
  useLayoutEffect(() => {
    if (sniffInitRef.current) {
      sniffInitRef.current = false;
      return;
    }
    setSniffJustChanged(true);
    // 700ms covers the staggered timeline: one leg runs 0-320ms,
    // the other leg runs 200-560ms with an animation-delay so HUD
    // and chips don't fight for attention in the same instant.
    const t = setTimeout(() => setSniffJustChanged(false), 700);
    return () => clearTimeout(t);
  }, [sniffMode]);
  const spotsCategoryFilter = useGameStore((s) => s.spotsCategoryFilter);
  const selectedSpotId = useGameStore((s) => s.selectedSpotId);
  const setSelectedSpot = useGameStore((s) => s.setSelectedSpot);
  const collectToken = useGameStore((s) => s.collectToken);
  const eatFood = useGameStore((s) => s.eatFood);
  const lastCollect = useGameStore((s) => s.lastCollect);
  const setUserPosition = useGameStore((s) => s.setUserPosition);
  const syncMap = useGameStore((s) => s.syncMap);
  const syncSpots = useGameStore((s) => s.syncSpots);
  const setViewportCenter = useGameStore((s) => s.setViewportCenter);
  const collectPath = useGameStore((s) => s.collectPath);
  const setSelectedDog = useGameStore((s) => s.setSelectedDog);
  const fetchLostDog = useGameStore((s) => s.fetchLostDog);
  const activeQuest = useGameStore((s) => s.activeQuest);
  const syncActiveQuest = useGameStore((s) => s.syncActiveQuest);
  const advanceQuestIfNear = useGameStore((s) => s.advanceQuestIfNear);
  const forceAdvanceActiveWaypoint = useGameStore((s) => s.forceAdvanceActiveWaypoint);
  const walkRoute = useGameStore((s) => s.walkRoute);
  const walkRouteMeta = useGameStore((s) => s.walkRouteMeta);
  const abandonActiveQuest = useGameStore((s) => s.abandonActiveQuest);

  // Snapshot of the walk-destination Spot. spots refetch when the
  // viewport pans, and viewport-driven fetches don't necessarily
  // include the destination anymore — without this cache the pin at
  // the end of the route silently vanishes. Captured the first time
  // the destination is present in spots after the walk starts, then
  // reused even if subsequent fetches drop it.
  const walkDestRef = useRef<Spot | null>(null);
  useEffect(() => {
    const sid = walkRouteMeta?.spotId;
    if (!sid) {
      walkDestRef.current = null;
      return;
    }
    const found = spots.find((s) => s.id === sid);
    if (found) walkDestRef.current = found;
  }, [walkRouteMeta?.spotId, spots]);
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

  // When a quest starts, ease the camera to cover the user + every
  // waypoint so the human sees themselves relative to the trail at
  // once. Same coordinated easeTo we use for walking routes; padding
  // clears the HUD pills + tab bar so nothing important lands under
  // an overlay. Fires once per quest (deps on activeQuest.id alone).
  useEffect(() => {
    if (!activeQuest || !userPos) return;
    const map = mapRef.current;
    if (!map) return;
    const points: Array<[number, number]> = [
      [userPos.lng, userPos.lat],
      ...activeQuest.waypoints.map(
        (w) => [w.position.lng, w.position.lat] as [number, number],
      ),
    ];
    const bounds = points.reduce(
      (b, p) => b.extend(p),
      new maplibregl.LngLatBounds(points[0]!, points[0]!),
    );
    map.fitBounds(bounds, {
      padding: { top: 110, bottom: 130, left: 40, right: 40 },
      maxZoom: 17,
      duration: 700,
    });
  }, [activeQuest?.id]);

  // Bot deep-link: the Mini App can be opened pointing at a specific
  // lost pet via either Telegram start_param ('lost-<id>') or a
  // ?dog=<id> URL param the in-DM web_app button supplies. Fetch the
  // dog (it may be far from the user's GPS so /dogs/nearby wouldn't
  // catch it), drop it into the store list, ease the map to its pin,
  // and pop the modal. Runs once per app session — the ref gate
  // guards against re-fires when mapBounds ticks on every idle.
  const deepLinkAppliedRef = useRef(false);
  useEffect(() => {
    if (deepLinkAppliedRef.current) return;
    if (!mapBounds) return; // wait until the map has rendered at least once
    const id = getDeepLinkDogId();
    if (!id) return;
    deepLinkAppliedRef.current = true;
    void (async () => {
      const dog = await fetchLostDog(id);
      if (!dog) return;
      // fetchLostDog merges the pet into lostDogs, so selecting it
      // here lets the shared dog-snap effect (below) do the camera
      // tween — same recipe a map-tap or quests-tab jump gets.
      setSelectedDog(dog.id);
    })();
  }, [mapBounds, fetchLostDog, setSelectedDog]);

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
    showBubble(sniffMode ? t.bubbles.sniffOn : t.bubbles.sniffOff, 3500);
  }, [sniffMode, showBubble, t]);

  // Greet on every map-tab focus — pick a random "woof" so it doesn't
  // get repetitive. Same energy as Claude Code's *percolating* /
  // *combobulating* spinner words. The very first focus per session
  // also nudges the user toward the about modal so newcomers find
  // the help affordance (top-left logo tap).
  useFocusEffect(
    useCallback(() => {
      if (!hasGreetedThisSession) {
        hasGreetedThisSession = true;
        showBubble(t.bubbles.greeting, 5500);
        return;
      }
      const { woofs } = t.bubbles;
      const pick = woofs[Math.floor(Math.random() * woofs.length)] ?? t.bubbles.simpleWoof;
      showBubble(pick, 4000);
    }, [showBubble, t]),
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
    // syncSpots is driven separately by the viewport-watcher effect
    // below so the dog finds places where the human is LOOKING, not
    // just where they're standing.
    const id = setInterval(() => {
      const pos = useGameStore.getState().userPosition;
      if (!pos) return;
      void collectPath(pos);
      void syncMap(pos);
    }, TOKEN_REFRESH_MS);
    return () => clearInterval(id);
  }, [userPos?.lat, userPos?.lng, isFocused, collectPath, syncMap]);

  // Viewport-driven spots sync. When the user pans to a new
  // neighborhood we want to surface its cafes / vets / pet stores
  // without making them physically walk there. Fetches are still
  // gated by gameStore.syncSpots' own distance threshold so a small
  // pan doesn't burn a Places quota call.
  useEffect(() => {
    if (!isFocused || !mapBounds) return;
    const center = {
      lat: (mapBounds.n + mapBounds.s) / 2,
      lng: (mapBounds.e + mapBounds.w) / 2,
    };
    setViewportCenter(center);
    syncSpots(center);
  }, [
    isFocused,
    mapBounds?.n,
    mapBounds?.s,
    mapBounds?.e,
    mapBounds?.w,
    setViewportCenter,
    syncSpots,
  ]);

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
        showBubble(narration ?? t.bubbles.questComplete, 6000);
      } else if (advanced) {
        showBubble(narration ?? t.bubbles.questAdvance, 5000);
      }
    }, balance.roamTick);
    return () => clearInterval(id);
  }, [activeQuest?.id, activeQuest?.currentWaypoint, advanceQuestIfNear, showBubble, t]);

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
  // Current user position in a ref for interval callbacks (search nudges).
  const userPosRef = useRef(userPos);
  userPosRef.current = userPos;
  // Same for the lost-dogs list, so the nudge interval can resolve the active
  // search target's name without re-subscribing the effect on every list churn.
  const lostDogsRef = useRef(lostDogs);
  lostDogsRef.current = lostDogs;

  // Dog-cam: while enabled, chase the companion with a low, close camera whose
  // bearing tracks the dog's direction of travel (forward = up), like a
  // car-navigation view. A light follow loop re-eases toward the dog each tick;
  // linear easing + duration≈tick chains the eases into a continuous glide.
  //
  // Look-around: the user can twist to rotate the view any time, freely. Heading
  // stays car-nav "up" (auto-orients along the dog's travel) UNTIL the first
  // manual rotate — from then on the bearing is theirs for the rest of the
  // session and the loop never yanks it back, so rotation feels unlimited.
  //
  // Crucially the follow loop does NOTHING while a rotate gesture is live: any
  // programmatic camera move (easeTo/setCenter) mid-gesture cancels the user's
  // gesture and makes rotation feel stuck. It stands down until a beat after the
  // last rotate event, then the normal ease glides the dog back to centre — no
  // hard snap. On desktop, rotation pivots around screen-centre (= the dog), so
  // the dog stays put on its own; on touch it drifts during the twist and
  // glides home on release. On exit it eases back to the north-up game view.
  useEffect(() => {
    if (!DOG_CAM || !dogCam) return;
    const map = mapRef.current;
    if (!map) return;
    // Sit the dog low on screen (car-nav feel) so its speech bubble clears the
    // horizon/beacon. TOP padding pushes the centred point down; sized as a
    // fraction of the map height so it holds across devices.
    try {
      const h = map.getContainer?.()?.clientHeight ?? 700;
      map.setPadding({
        top: Math.round(h * DOGCAM_TOP_RESERVE_FRAC),
        right: 0,
        bottom: 0,
        left: 0,
      });
    } catch {
      /* style not ready */
    }
    let heading = map.getBearing();
    let lastDog: LatLng | null = null;
    // Latches true the first time the user rotates by hand; once set, the loop
    // stops driving the bearing so the user's rotation is never overridden.
    let userTookBearing = false;
    // Timestamp of the last hand-driven rotate; the loop skips while this is
    // fresh so it never fights the live gesture.
    let lastUserRotateAt = 0;
    // originalEvent is present only for user-driven rotation, not our easeTo.
    const onUserRotate = (e: { originalEvent?: unknown }) => {
      if (!e || !e.originalEvent) return;
      userTookBearing = true;
      lastUserRotateAt = Date.now();
    };
    map.on('rotatestart', onUserRotate);
    map.on('rotate', onUserRotate);
    const id = setInterval(() => {
      const dog = companionPosRef.current;
      if (!dog) return;
      // Rotate gesture still in flight (events arriving) → hands off entirely.
      if (Date.now() - lastUserRotateAt < DOGCAM_TICK) return;
      // Preview → stay TIED to the dog but zoomed out, facing the fragment we're
      // eyeing (so the blue beacon sits up-screen). Committed → tight chase cam
      // with heading-up. Either way the camera is glued to the dog, so it never
      // drifts down into the carousel.
      const preview = useGameStore.getState().searchPreview;
      let moved = false;
      if (lastDog && distanceMeters(lastDog, dog) > DOGCAM_MIN_MOVE_M) {
        // Only auto-orient heading-up until the user has taken the wheel.
        if (!userTookBearing) heading = bearingDeg(lastDog, dog);
        moved = true;
      }
      lastDog = dog;
      if (preview) {
        const toSpot = bearingDeg(dog, preview.spot);
        map.easeTo({
          center: [dog.lng, dog.lat],
          pitch: PREVIEW_PITCH,
          zoom: previewZoomFor(distanceMeters(dog, preview.spot)),
          ...(userTookBearing ? {} : { bearing: toSpot }),
          duration: DOGCAM_TICK,
          easing: (t) => t,
        });
      } else {
        // Committed: face DOWN the route (toward a point ahead of you on it) so
        // the view runs along the way you're being led — never perpendicular to
        // it — and tracks its curves. This also auto-corrects the moment the
        // straight line upgrades to the real walking route. Falls back to the
        // dog's travel heading if there's no route yet.
        let applyBearing = false;
        if (!userTookBearing) {
          const route = useGameStore.getState().searchRoute;
          const up = userPosRef.current;
          if (route && route.length >= 2 && up) {
            heading = bearingDeg(up, pointAheadOnRoute(route, up, ROUTE_LOOK_AHEAD_M));
            applyBearing = true;
          } else if (moved) {
            applyBearing = true; // heading already = dog travel direction
          }
        }
        map.easeTo({
          center: [dog.lng, dog.lat],
          pitch: DOGCAM_PITCH,
          zoom: DOGCAM_ZOOM,
          ...(applyBearing ? { bearing: heading } : {}),
          duration: DOGCAM_TICK,
          easing: (t) => t,
        });
      }
    }, DOGCAM_TICK);
    return () => {
      clearInterval(id);
      map.off('rotatestart', onUserRotate);
      map.off('rotate', onUserRotate);
      try {
        map.setPadding({ top: 0, right: 0, bottom: 0, left: 0 });
      } catch {
        /* map tearing down */
      }
      try {
        map.easeTo({ bearing: 0, pitch: 74, zoom: balance.mapZoomDefault, duration: 500 });
      } catch {
        /* map tearing down */
      }
    };
  }, [dogCam]);

  // ── Sniff-and-lead search mode (Phase 1) ────────────────────────────────
  // While search mode (dogCam) is on, the system assigns the nearest lost dog +
  // a spot inside its search zone; the companion leads you there (useCompanion),
  // the dog-cam follows, and a photo card shows who you're looking for. When you
  // reach the spot you get a reward and it serves the next-closest dog. Endless.
  const SEARCH_REACH_M = 40;
  const visitedDogsRef = useRef<Set<string>>(new Set());
  // Pick a random spot inside a dog's search zone, biased to sit a little away
  // from the user so "arrival" isn't instant.
  const spotInZone = useCallback(
    (center: LatLng, radiusM: number, awayFrom: LatLng | null): LatLng => {
      const r = Math.max(80, radiusM);
      for (let i = 0; i < 6; i++) {
        const rr = r * Math.sqrt(Math.random());
        const th = Math.random() * Math.PI * 2;
        const spot = {
          lat: center.lat + (rr * Math.sin(th)) / 110540,
          lng:
            center.lng +
            (rr * Math.cos(th)) /
              (111320 * Math.cos((center.lat * Math.PI) / 180) || 111320),
        };
        if (!awayFrom || distanceMeters(awayFrom, spot) > SEARCH_REACH_M * 2) {
          return spot;
        }
      }
      return center;
    },
    [],
  );
  // Nearest active lost dog we haven't just visited (resets the exclusion set
  // once they're all seen, so it loops forever).
  const pickNextSearchDog = useCallback((): NearbyLostDog | null => {
    if (!userPos || lostDogs.length === 0) return null;
    let pool = lostDogs.filter((d) => !visitedDogsRef.current.has(d.id));
    if (pool.length === 0) {
      visitedDogsRef.current.clear();
      pool = lostDogs;
    }
    let best: NearbyLostDog | null = null;
    let bestD = Infinity;
    for (const d of pool) {
      const dist = distanceMeters(userPos, d.lastSeen.position);
      if (dist < bestD) {
        bestD = dist;
        best = d;
      }
    }
    return best;
  }, [userPos, lostDogs]);

  // Commit (carousel TAP): draw the route + start the dog leading. This is the
  // only path that spends a Routes API call — swiping just previews (below).
  const assignSearch = useCallback(
    // `announce` is the by-name "on the trail" bark; suppressed on the arrival
    // re-assign (the arrival effect shows its own "found the spot" line).
    (dog: NearbyLostDog, announce = true) => {
      // Reuse the previewed fragment's spot so tapping sends you exactly to the
      // patch the beacon lit up; fall back to a fresh spot (arrival re-assign,
      // or a tap with no matching preview).
      const preview = useGameStore.getState().searchPreview;
      const spot =
        preview && preview.dogId === dog.id
          ? preview.spot
          : spotInZone(dog.lastSeen.position, dog.searchZoneRadiusM, userPos);
      setSearchPreview(null); // leave preview → back to the tight follow cam
      visitedDogsRef.current.add(dog.id);
      setSearchTarget({ dogId: dog.id, spot });
      // Draw a straight line to the spot immediately so the dog can start
      // leading right away, then upgrade to the street-hugging walking route
      // once the Routes API answers (falls back to the straight line if not).
      const origin = userPos ?? dog.lastSeen.position;
      setSearchRoute([origin, spot]);
      void fetchWalkingRoute(origin, [spot]).then((r) => {
        if (r && r.length >= 2) setSearchRoute(r);
      });
      // Recentre on the dog and point the camera along the fresh route so the
      // new direction reads at a glance. One-shot easeTo (no originalEvent, so
      // it doesn't count as the user "taking" the bearing); the follow loop
      // picks up from here. Only in dog-cam so normal map view is untouched.
      const map = mapRef.current;
      if (DOG_CAM && dogCam && map) {
        const focus = companionPosRef.current ?? origin;
        map.easeTo({
          center: [focus.lng, focus.lat],
          bearing: bearingDeg(origin, spot),
          pitch: DOGCAM_PITCH,
          zoom: DOGCAM_ZOOM,
          duration: 500,
        });
      }
      if (announce) {
        const leadLines = [
          `беремо слід ${dog.name}! ходімо 🐾`,
          `шукаємо ${dog.name} — за мною!`,
          `${dog.name} десь тут… чую запах 🐽`,
          `на пошук ${dog.name}, тримайся поруч!`,
          `on the trail of ${dog.name} — this way! 🐾`,
        ];
        showBubble(leadLines[Math.floor(Math.random() * leadLines.length)]!, 3500);
      }
    },
    [setSearchPreview, setSearchTarget, setSearchRoute, spotInZone, userPos, showBubble, dogCam],
  );

  // Preview (carousel SWIPE, or the initial mode-on pick): pick the candidate
  // quest spot now and glow a small FRAGMENT of the zone around it — NO route,
  // NO API call. The camera stays tied to the dog, just zoomed out and turned to
  // face the fragment so the blue beacon sits up-screen. Tapping the card commits
  // it (assignSearch above) and reuses this exact spot.
  const previewSearch = useCallback(
    (dog: NearbyLostDog) => {
      const from = userPosRef.current;
      // Aim the fragment for a comfortable middle distance (~PREVIEW_TARGET_DIST):
      // pick the in-zone sample closest to that target. Keeps the beacon out on
      // the horizon — clear of the dog's speech bubble — yet reachable, instead of
      // hugging the dog (too close) or landing on the far side of a big zone.
      let spot = spotInZone(dog.lastSeen.position, dog.searchZoneRadiusM, from);
      if (from) {
        let bestScore = Math.abs(distanceMeters(from, spot) - PREVIEW_TARGET_DIST_M);
        for (let i = 0; i < 7; i++) {
          const s = spotInZone(dog.lastSeen.position, dog.searchZoneRadiusM, from);
          const score = Math.abs(distanceMeters(from, s) - PREVIEW_TARGET_DIST_M);
          if (score < bestScore) {
            bestScore = score;
            spot = s;
          }
        }
      }
      setSearchPreview({ dogId: dog.id, spot, radiusM: PREVIEW_FRAGMENT_RADIUS_M });
      const map = mapRef.current;
      if (DOG_CAM && dogCam && map) {
        // Tied to the dog (never flies off to the zone, so the dog can't drift
        // into the carousel), just zoomed out and facing the fragment. Zoom eases
        // out for far fragments so the beacon stays on-screen. The follow loop
        // keeps it glued from here.
        const focus = companionPosRef.current ?? from ?? spot;
        try {
          map.easeTo({
            center: [focus.lng, focus.lat],
            zoom: previewZoomFor(distanceMeters(focus, spot)),
            pitch: PREVIEW_PITCH,
            bearing: bearingDeg(focus, spot),
            duration: 700,
          });
        } catch {
          /* style not ready — the beacon still renders */
        }
      }
      showBubble(`${dog.name}? tap to pick up the trail 🐾`, 4000);
    },
    [setSearchPreview, spotInZone, dogCam, showBubble],
  );

  // Engage the mode: on turn-on (nothing committed or previewed yet) frame the
  // nearest dog's zone as a preview — the user taps to actually set off.
  useEffect(() => {
    if (!DOG_CAM || !dogCam) {
      visitedDogsRef.current.clear();
      return;
    }
    if (searchTarget || searchPreview) return;
    const dog = pickNextSearchDog();
    if (dog) previewSearch(dog);
  }, [dogCam, searchTarget, searchPreview, pickNextSearchDog, previewSearch]);

  // Arrival → reward, then a FRESH spot for the SAME dog (keeps you moving
  // within its zone). Switching dogs is the carousel's job (swipe), so we don't
  // auto-jump to a different dog here — that would desync the carousel.
  useEffect(() => {
    if (!DOG_CAM || !dogCam || !searchTarget || !userPos) return;
    if (distanceMeters(userPos, searchTarget.spot) > SEARCH_REACH_M) return;
    const dog = lostDogs.find((d) => d.id === searchTarget.dogId);
    showBubble(
      dog ? `found the spot for ${dog.name} 🐾 sniffing out another…` : 'nice find! 🐾',
      3500,
    );
    if (dog) assignSearch(dog, false);
    else setSearchTarget(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userPos, searchTarget, dogCam]);

  // Call-to-action: when the dog is leading but you're not closing the gap,
  // it barks encouragement (it's up ahead waiting for you to follow). Only
  // nudges when you're NOT progressing, so it never nags while you walk.
  const lastNudgeDistRef = useRef<number | null>(null);
  useEffect(() => {
    if (!DOG_CAM || !dogCam) {
      lastNudgeDistRef.current = null;
      return;
    }
    const NUDGE_MS = 9000;
    // Generic "keep following me" barks (mix of uk + en, matching the app).
    const generic = [
      'сюди! 🐾',
      'ходімо, ніс не бреше!',
      'this way — I caught a scent!',
      'давай, за мною!',
      'нюхом чую, туди!',
      'майже там, не відставай! 🐕',
      'слід свіжий, швидше!',
      'keep up — the trail is warm! 🐾',
      'туди-туди, ще трохи!',
      'не зупиняйся, я веду!',
      'almost there — stay with me!',
      'ще пару кроків, ходімо 🐽',
    ];
    // Name-aware barks — only usable when we can resolve the active dog.
    const named = (name: string) => [
      `${name} десь поруч — за мною! 🐾`,
      `нюхаю ${name}, сюди!`,
      `не губи слід ${name}!`,
      `${name} чекає — ходімо!`,
      `closing in on ${name} — this way!`,
    ];
    const id = setInterval(() => {
      const st = useGameStore.getState().searchTarget;
      const up = userPosRef.current;
      if (!st || !up) return;
      const dist = distanceMeters(up, st.spot);
      if (dist <= SEARCH_REACH_M) return;
      const prev = lastNudgeDistRef.current;
      // Only bark if you haven't meaningfully closed the gap since last check.
      if (prev === null || prev - dist < 12) {
        const name = lostDogsRef.current.find((d) => d.id === st.dogId)?.name;
        // Weave name-aware lines in when we know who we're after.
        const pool = name ? [...generic, ...named(name)] : generic;
        showBubble(pool[Math.floor(Math.random() * pool.length)]!, 3200);
      }
      lastNudgeDistRef.current = dist;
    }, NUDGE_MS);
    return () => clearInterval(id);
  }, [dogCam, showBubble]);

  // Action-based calm gate for the chained map hints
  // (store.hintsAllowed): the user isn't doing anything right now — on
  // the map tab, camera settled (not mid sniff-jump / snap / pan), not
  // in sniff mode, no modal open. Position is NOT a factor: when a hint
  // fires we snap to the dog (below) so the bubble is always framed,
  // wherever the dog had drifted. Each hint's show-delay debounces this
  // out of brief transitions — start doing something and the counter
  // pauses, resuming once you're idle on the map again.
  const hintsAllowed =
    onMapScreen &&
    !mapMoving &&
    !sniffMode &&
    !selectedDogId &&
    !selectedSpotId &&
    // Nothing the user is actively reading/doing on the map: no sniff
    // discovery up, no walking route drawn.
    !sniffActive &&
    !walkRoute;

  const setHintsAllowed = useGameStore((s) => s.setHintsAllowed);
  useEffect(() => {
    setHintsAllowed(hintsAllowed);
  }, [hintsAllowed, setHintsAllowed]);
  useEffect(() => () => setHintsAllowed(false), [setHintsAllowed]);

  // Snap to the dog the moment a chained map hint fires, so its bubble
  // lands framed even if the dog had wandered off-centre. Slight
  // downward offset leaves room above the nose for the bubble, clear of
  // the HUD. The bubble (anchored to the companion marker) glides in
  // with the ease.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !companionPos) return;
    if (activeHint && activeHint.startsWith('map:')) {
      map.easeTo({
        center: [companionPos.lng, companionPos.lat],
        offset: [0, 60],
        duration: 400,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeHint]);

  // Hide street-name labels while the camera is steeply pitched (game
  // view), show them when it flattens. Re-run after every crayon override
  // (which resets label visibility) and on pitchend.
  const syncStreetLabels = useCallback(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    setStreetLabelsVisible(map, map.getPitch() < STREET_LABEL_HIDE_PITCH);
  }, []);

  // Spawn a collect-burst FX whenever a paw/bone is picked up (tap OR
  // auto-collect — both funnel through the store's lastCollect). Keyed on
  // seq so repeat pickups at the same spot still fire; each burst clears
  // itself after the animation window. The ref is seeded with the
  // mount-time seq so returning to the map tab doesn't replay the last
  // pickup's burst at a stale spot.
  const lastBurstSeqRef = useRef(useGameStore.getState().lastCollect?.seq ?? 0);
  useEffect(() => {
    if (!lastCollect || lastCollect.seq === lastBurstSeqRef.current) return;
    const { seq, lng, lat, kind } = lastCollect;
    lastBurstSeqRef.current = seq;
    setCollectBursts((prev) => [...prev, { seq, lng, lat, kind }]);
    const t = setTimeout(() => {
      setCollectBursts((prev) => prev.filter((b) => b.seq !== seq));
    }, 850);
    return () => clearTimeout(t);
  }, [lastCollect]);

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

  // MapLibre viewport restriction. Was a tight 10×10 km box around
  // central Kyiv that cut off the left bank (Троєщина, Воскресенка,
  // Дарниця, Лівобережна) and outer right-bank districts (Виноградар,
  // Троєщина). Widened to a generous Kyiv-wide envelope with a comfy
  // padding so we don't accidentally clip something. ~38 km E-W, ~36
  // km N-S — covers everything between Vynohradar and Troieshchyna
  // and from the southern industrial belt up past Obolon, plus a
  // small ring of "outside the city" buffer so panning to a periphery
  // address never bumps a wall.
  const MAP_MAX_BOUNDS: [[number, number], [number, number]] = [
    [30.28, 50.30],
    [30.85, 50.62],
  ];
  // Paper-tooth overlay URL. Light + dark variants exist; we pick the
  // active one from sniffMode below.
  const paperUrlLight = useMemo(
    () => generatePaperTextureUrl(LIGHT_PALETTE),
    [],
  );
  const paperUrlDark = useMemo(
    () => generatePaperTextureUrl(DARK_PALETTE),
    [],
  );
  const paperUrl = sniffMode ? paperUrlDark : paperUrlLight;
  const paperOpacity = sniffMode
    ? DARK_PALETTE.paperOpacity
    : LIGHT_PALETTE.paperOpacity;
  const paperBlend = sniffMode ? 'screen' : 'multiply';

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
  // Nearest lost dogs for the search-mode carousel (sorted by distance; coarse
  // user-bucket dep so the order doesn't reshuffle on every GPS tick).
  const searchDogs = useMemo(() => {
    const up = userPosRef.current;
    const arr = [...lostDogs];
    if (up) {
      arr.sort(
        (a, b) =>
          distanceMeters(up, a.lastSeen.position) -
          distanceMeters(up, b.lastSeen.position),
      );
    }
    return arr.slice(0, 15);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lostDogs, userLatBucket, userLngBucket]);
  const visibleLostDogs = useMemo(() => {
    if (!userPos) return lostDogs;
    // Lost pets are the SNIFF (locate) flow. On the normal map only show the
    // closest few so they don't clutter it; sniff mode reveals the full set
    // within the render radius (plus the off-screen locate chips).
    const radius = sniffMode ? MAP_RENDER_RADIUS_M : NORMAL_LOSTDOG_RADIUS_M;
    return lostDogs.filter(
      (d) =>
        // Always keep the currently-selected dog visible — when a
        // user opens via the bot deep-link, they might be far from
        // the pet's lastSeen pin (e.g. dog at Lukianivka, user in
        // Pechersk). Without this carve-out the modal opens but the
        // marker is filtered out by the GPS-radius gate below.
        d.id === selectedDogId ||
        distanceMeters(userPos, d.lastSeen.position) <= radius,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bucketed userPos on purpose; see comment above
  }, [lostDogs, userLatBucket, userLngBucket, selectedDogId, sniffMode]);
  // Building avoidance (game render): nudges the DISPLAY position of
  // collectibles + other dogs out of building footprints. Rebuilt on idle as
  // tiles stream; bumping the version re-runs the nudged memos below.
  const buildingAvoiderRef = useRef<ReturnType<typeof createBuildingAvoider> | null>(null);
  const [buildingIndexVersion, setBuildingIndexVersion] = useState(0);

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

  // Display positions nudged out of buildings (game render only). Real
  // positions in the store are untouched — collect distance etc. stay honest.
  const avoidedTokens = useMemo(() => {
    const av = buildingAvoiderRef.current;
    if (!GAME_RENDER || !av) return visibleTokens;
    return visibleTokens.map((t) => ({ ...t, position: av.nudge(t.position) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version drives recompute
  }, [visibleTokens, buildingIndexVersion]);
  const avoidedFood = useMemo(() => {
    const av = buildingAvoiderRef.current;
    if (!GAME_RENDER || !av) return visibleFood;
    return visibleFood.map((f) => ({ ...f, position: av.nudge(f.position) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version drives recompute
  }, [visibleFood, buildingIndexVersion]);

  // Build/refresh the building footprint index once the map exists, and on
  // every idle as more building tiles stream in.
  useEffect(() => {
    if (!GAME_RENDER || !mapInstance) return;
    const av = createBuildingAvoider(mapInstance);
    buildingAvoiderRef.current = av;
    const refresh = () => {
      av.rebuild();
      setBuildingIndexVersion(av.version());
    };
    refresh();
    mapInstance.on('idle', refresh);
    return () => {
      mapInstance.off('idle', refresh);
      buildingAvoiderRef.current = null;
    };
  }, [mapInstance]);

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

  // Each pet gets a deterministic display offset inside its own
  // searchZoneRadiusM. Posted location is landmark-level and the
  // zone radius is the parser's uncertainty; jitter picks a stable
  // point in that circle based on the pet's id hash.
  //
  // Strictly hash-derived — no cluster-fanned override. Previously
  // pets in a shared cluster got an evenly-fanned angle instead of
  // the hash one; any sync that shifted cluster membership re-fanned
  // the group and each pet teleported to a new base position.
  // Hash-by-id keeps the base rock-stable across syncs.
  const displayPositions = useMemo(() => {
    const map = new Map<string, { lat: number; lng: number }>();
    for (const d of lostDogs) {
      map.set(d.id, jitterInRadius(d.lastSeen.position, d.searchZoneRadiusM, d.id));
    }
    return map;
  }, [lostDogs]);

  const clusters = useMemo(() => {
    // Cluster on the JITTERED display position, not the raw DB
    // lastSeen. Many pets share the same parser-landmark coord (e.g.
    // 'somewhere near Maidan' → 50.4503, 30.5234); jitterInRadius
    // scatters their visual pins across the search zone, but if we
    // cluster on the raw coord the pile collapses to a single '10
    // lost pets' badge even though the markers themselves are spread.
    // Using displayPositions makes the cluster threshold see what the
    // map actually shows.
    const raw = clusterByDistance(
      visibleLostDogs.map((d) => ({
        id: d.id,
        position: displayPositions.get(d.id) ?? d.lastSeen.position,
        dog: d,
      })),
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
  }, [visibleLostDogs, displayPositions]);

  // Spot clustering by category. Disk-overlap criterion: derive a
  // meters-radius from a fixed pixel threshold so the clustering
  // adapts naturally to zoom (aggressive at zoom 16, near-noop at
  // zoom 18+). Singletons + the actively-selected spot always
  // render as solo PoiMarkers; groups of 2+ collapse to a PoiCluster
  // that the user can expand by tap (and re-stack via the floating
  // collapse pill).
  const spotClusters = useMemo(() => {
    if (!spotsVisible && !selectedSpotId && !walkRouteMeta?.spotId) return [];
    // Bbox cull: only consider spots inside the visible viewport so the
    // marker count and the clustering pass scale with what's on screen,
    // not the user's lifetime fetch history. Selected + walk-route spots
    // bypass the cull so they don't vanish when the user pans away from
    // them. Padded slightly so spots just past the edge don't pop in
    // mid-pan.
    const inView = (lat: number, lng: number): boolean => {
      if (!mapBounds) return true;
      const padLat = (mapBounds.n - mapBounds.s) * 0.08;
      const padLng = (mapBounds.e - mapBounds.w) * 0.08;
      return (
        lat <= mapBounds.n + padLat &&
        lat >= mapBounds.s - padLat &&
        lng <= mapBounds.e + padLng &&
        lng >= mapBounds.w - padLng
      );
    };
    const renderSet = new Set<string>();
    if (spotsVisible) {
      for (const s of spots) {
        if (
          spotsCategoryFilter === 'all' ||
          s.category === spotsCategoryFilter
        ) {
          if (!inView(s.position.lat, s.position.lng)) continue;
          renderSet.add(s.id);
        }
      }
    }
    if (selectedSpotId) renderSet.add(selectedSpotId);
    if (walkRouteMeta?.spotId) renderSet.add(walkRouteMeta.spotId);
    // Splice the cached walk destination back into the candidate set
    // if a viewport refetch dropped it from `spots` — keeps the
    // route's end pin on the map even when the user pans away.
    let effectiveSpots: Spot[] = spots;
    const sid = walkRouteMeta?.spotId;
    const cachedDest = walkDestRef.current;
    if (sid && cachedDest && cachedDest.id === sid && !spots.find((s) => s.id === sid)) {
      effectiveSpots = [...spots, cachedDest];
    }
    const live = effectiveSpots.filter((s) => renderSet.has(s.id));
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
    mapBounds,
  ]);

  // displayPositions moved above the clusters memo — cluster needs
  // to see the same jittered points the markers will render at,
  // otherwise pets sharing a parser-landmark coord collapse to one
  // badge even though the pins themselves are scattered.
  // (Definition now lives just above `clusters`.)

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

  // When the Spots tab routes the user here with a selection, ease to
  // that spot in ONE coordinated tween. SpotModal covers roughly the
  // top ~460 px (hero 220 + name + address + action pills); the tab
  // bar steals the bottom ~110 px (with safe-area). Padding here
  // biases the camera so the selected spot lands in the vertical
  // centre of the visible map strip between the modal's bottom edge
  // and the tab bar — that's where the eye expects "the spot you
  // tapped" to be, not buried under the modal.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!selectedSpotId) {
      // Modal closed — restore zero padding on the camera so a
      // subsequent panTo / easeTo (companion tap, dog tap, etc.)
      // centres on the geometric viewport instead of the spot-
      // modal-padded region we set below. MapLibre persists
      // `padding` across calls, so leaving 460/110 in place
      // would visibly bias every later recenter low and right.
      map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
      return;
    }
    const spot = spots.find((s) => s.id === selectedSpotId);
    if (!spot) return;
    const current = map.getZoom() ?? balance.mapZoomDefault;
    map.easeTo({
      center: [spot.position.lng, spot.position.lat],
      zoom: Math.max(current, 17),
      padding: { top: 460, bottom: 110, left: 20, right: 20 },
      duration: 500,
    });
  }, [selectedSpotId, spots]);

  // Dog-snap — same coordinated tween the spot gets, so tapping a pet
  // (on the map OR via the quests-tab jump, which routes here with the
  // dog already selected) snaps the camera onto it under the compact
  // LostDogModal. The modal covers the top ~430 px; bias the pin into
  // the visible strip between the sheet's bottom edge and the tab bar
  // with the same padding recipe the spot uses so the two feel
  // identical.
  //
  // The ref gate matters: lostDogs is in the effect deps (we need it
  // to look up the pin once the deep-link / quests-jump merges the pet
  // in), but it also refreshes on every 15 s syncMap tick. Without the
  // gate the camera would re-snap onto the pet every 15 s while the
  // modal is open, fighting the user's panning. So we only tween when
  // the *selection* changes, not when the underlying list does.
  const lastSnappedDogRef = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!selectedDogId) {
      lastSnappedDogRef.current = null;
      // Only reset the camera padding when no spot is driving it —
      // otherwise closing a dog modal would clobber an active spot
      // snap's padding. (In practice only one is ever open, but the
      // guard keeps the two effects from racing.)
      if (!selectedSpotId) {
        map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
      }
      return;
    }
    if (selectedDogId === lastSnappedDogRef.current) return;
    const dog = lostDogs.find((d) => d.id === selectedDogId);
    if (!dog) return; // not merged in yet — retry when lostDogs updates
    // The marker renders at its search-zone-jittered point (which can
    // sit hundreds of metres — up to the zone radius — from the raw
    // last-seen coord), so snap to THAT, not lastSeen.position, or the
    // camera lands on empty map away from the pin. Same lookup the
    // search-zone circle + marker use.
    const pin = displayPositions.get(selectedDogId) ?? dog.lastSeen.position;
    lastSnappedDogRef.current = selectedDogId;
    const current = map.getZoom() ?? balance.mapZoomDefault;
    map.easeTo({
      center: [pin.lng, pin.lat],
      zoom: Math.max(current, 17),
      padding: { top: 460, bottom: 110, left: 20, right: 20 },
      // Extra downward nudge: dog markers are anchored at their foot
      // with the photo chip floating ~90px above the geo point, so the
      // padded centre alone lands the *chip* high in the strip. A fixed
      // pixel offset drops it to the visual centre between the sheet's
      // bottom edge and the tab bar without over-cranking padding
      // (which would invert the camera's region on short viewports).
      offset: [0, 60],
      duration: 500,
    });
  }, [selectedDogId, lostDogs, selectedSpotId, displayPositions]);

  // Prev / next cycling for the LostDogModal. Walks the nearby pets in
  // distance order (closest first) so ‹ › steps through them the same
  // way the quests-tab list is sorted; wraps at the ends. Selecting the
  // neighbour reuses the dog-snap effect above, so the camera follows.
  const cycleSelectedDog = useCallback(
    (dir: 1 | -1) => {
      const id = useGameStore.getState().selectedDogId;
      if (!id) return;
      const list = userPos
        ? [...lostDogs].sort(
            (a, b) =>
              distanceMeters(userPos, a.lastSeen.position) -
              distanceMeters(userPos, b.lastSeen.position),
          )
        : lostDogs;
      const idx = list.findIndex((d) => d.id === id);
      if (idx < 0) return;
      const neighbour = list[(idx + dir + list.length) % list.length];
      if (neighbour) setSelectedDog(neighbour.id);
    },
    [lostDogs, userPos, setSelectedDog],
  );

  // Radial-menu camera: centre the dog on open so the ring is centred.
  // 'explainer' (first tap) also drops it 140px so the explainer bubble
  // clears the ring + HUD; 'center' (later taps) just centres it. On
  // close, settle the dog back to centre. easeTo(center=companion,
  // offset:[0,N]) lands the dog N px below the viewport centre.
  const menuWasOpenRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !companionPos) return;
    const c: [number, number] = [companionPos.lng, companionPos.lat];
    // Both modes just centre the dog now — there's room for the
    // explainer bubble above the ring at the default centre, so we no
    // longer drop the dog lower for it. (menuCamera keeps the two
    // values only so the explainer bubble can still be told apart.)
    if (menuCamera) {
      menuWasOpenRef.current = true;
      map.easeTo({ center: c, offset: [0, 0], duration: 320 });
    } else if (menuWasOpenRef.current) {
      menuWasOpenRef.current = false;
      map.easeTo({ center: c, offset: [0, 0], duration: 320 });
    }
  }, [menuCamera, companionPos?.lat, companionPos?.lng]);

  // MapLibre construction. Idempotent — bails if the map already
  // exists. Deps include `userPos` because on first paint it's null
  // (we render the "locating…" screen, so mapContainerRef.current is
  // also null then), and we need the effect to re-fire once GPS
  // resolves to actually construct the map.
  useEffect(() => {
    if (mapRef.current) return;
    if (!mapContainerRef.current) return;
    if (!userPos) return;
    let cancelled = false;
    (async () => {
      try {
        const style = await fetchCrayonStyleSpec();
        if (cancelled || !mapContainerRef.current || mapRef.current) return;
        // Clamp center within MAX_BOUNDS — MapLibre rejects construction
        // when center is outside maxBounds.
        const clampedCenter: [number, number] = [
          Math.min(
            MAP_MAX_BOUNDS[1][0],
            Math.max(MAP_MAX_BOUNDS[0][0], userPos.lng),
          ),
          Math.min(
            MAP_MAX_BOUNDS[1][1],
            Math.max(MAP_MAX_BOUNDS[0][1], userPos.lat),
          ),
        ];
        const map = new maplibregl.Map({
          container: mapContainerRef.current,
          style: style as maplibregl.StyleSpecification,
          center: clampedCenter,
          zoom: balance.mapZoomDefault,
          minZoom: balance.mapZoomMin,
          maxZoom: balance.mapZoomMax,
          maxBounds: MAP_MAX_BOUNDS,
          // Game-camera tilt: a 3D world you look across, not a flat map.
          // Opens at 74° — steep for real depth + a low horizon with plenty of
          // far city, while still tilted enough that the plaza/foreground
          // reads (the "hero" framing). Users can still tilt up to maxPitch
          // 80. (Default maxPitch is 60, so it must be raised.)
          pitch: 74,
          maxPitch: 80,
          // Drop both attribution branding + the MapLibre wordmark
          // logo. Tile/data attribution is a legal requirement for
          // upstream sources (OFM, OSM, etc.) — those are surfaced
          // elsewhere (about modal). For this product surface a
          // clean map without "MapLibre" or "© ..." chrome reads as
          // a first-class app, not a map embed.
          attributionControl: false,
          // Drag-pan inertia tuning. The finger-follow phase is always
          // 1:1 — these only shape what happens after the user lifts.
          // Linearity 0.7 (default 0.3) makes a flick carry farther and
          // map distance more proportionally to release speed; deceleration
          // 950 (default 2500) lets the glide settle very gradually for a
          // long, smooth slide; maxSpeed 2600 keeps fast flicks from
          // clipping; quintic ease-out gives an even softer, longer tail.
          // Net: pan glides like a sheet on ice rather than a rubber band.
          dragPan: {
            linearity: 0.7,
            deceleration: 950,
            maxSpeed: 2600,
            easing: (t: number) => 1 - Math.pow(1 - t, 5),
          },
        });
        map.on('error', (e) => {
          // eslint-disable-next-line no-console
          console.error('[maplibre]', e?.error || e);
        });
        mapRef.current = map;
        map.on('style.load', () => {
          applyCrayonOverride(map, sniffMode ? DARK_PALETTE : LIGHT_PALETTE, lang);
          syncStreetLabels();
          // The game render (Three.js buildings + one unified mist) needs
          // WebGL2, so it can fail on old devices. We build it defensively:
          // add both custom layers FIRST and only hide MapLibre's own
          // buildings once they're in — if anything throws we tear the
          // partial state down and fall back to the classic screen-space fog
          // with MapLibre's buildings intact, so prod never shows a city with
          // no buildings. Order: ground-fog UNDER buildings UNDER labels.
          let gameOk = false;
          if (GAME_RENDER) {
            try {
              const beforeId = firstSymbolLayerId(map);
              if (!map.getLayer(GROUND_FOG_LAYER_ID)) {
                map.addLayer(createGroundFogLayer(), beforeId);
              }
              if (!map.getLayer(THREE_BUILDINGS_LAYER_ID)) {
                map.addLayer(createThreeBuildingsLayer(), beforeId);
              }
              hideMapLibreBuildings(map);
              gameOk = true;
            } catch (e) {
              // eslint-disable-next-line no-console
              console.error('[game-render] init failed — falling back to classic render', e);
              try {
                if (map.getLayer(THREE_BUILDINGS_LAYER_ID)) {
                  map.removeLayer(THREE_BUILDINGS_LAYER_ID);
                }
              } catch {
                /* ignore */
              }
              try {
                if (map.getLayer(GROUND_FOG_LAYER_ID)) {
                  map.removeLayer(GROUND_FOG_LAYER_ID);
                }
              } catch {
                /* ignore */
              }
            }
          }
          // Classic render (prod default OR game-render fallback): the
          // screen-space depth fog over MapLibre's own buildings.
          if (!gameOk && !map.getLayer(DEPTH_FOG_LAYER_ID)) {
            try {
              map.addLayer(createDepthFogLayer());
            } catch (e) {
              // eslint-disable-next-line no-console
              console.error('[fog] addLayer failed', e);
            }
          }
        });
        // Street names hide at the steep game pitch, return when flat.
        map.on('pitchend', syncStreetLabels);
        map.on('idle', () => {
          const b = map.getBounds();
          setMapBounds({
            n: b.getNorth(),
            s: b.getSouth(),
            e: b.getEast(),
            w: b.getWest(),
          });
          setMapZoom(map.getZoom());
          setMapCenterLat(map.getCenter().lat);
          // Belt-and-suspenders: ensure street names are hidden at the
          // steep default pitch even if a load-time re-style briefly
          // re-showed them.
          syncStreetLabels();
        });
        // Track camera animation so hints can hold off until the map
        // settles (sniff jumps, snaps, pans all fire move start/end).
        map.on('movestart', () => setMapMoving(true));
        map.on('moveend', () => setMapMoving(false));
        map.on('click', () => {
          if (
            Date.now() - companionTappedAtRef.current <
            SUPPRESS_MAP_CLICK_MS
          ) {
            return;
          }
          setExpandedClusterKey(null);
          useGameStore.getState().setMenuOpen(false);
          setWalkRoute(null, null);
        });
        const cleanupPaper = installPaperOverlaySync(
          map,
          paperOverlayRef,
          userPos.lng,
          userPos.lat,
        );
        // Stash the paper cleanup on the map instance so the unmount
        // effect can call it without sharing a closure variable across
        // hooks.
        (map as unknown as { __paperCleanup?: () => void }).__paperCleanup =
          cleanupPaper;
        setMapInstance(map);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[map init failed]', err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // sniffMode read inside but intentionally not a dep — the sniff
    // toggle re-applies the override via its own effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userPos]);

  // Map destruction — runs only on unmount, NOT on every effect re-run.
  useEffect(() => {
    return () => {
      const m = mapRef.current;
      if (m) {
        (m as unknown as { __paperCleanup?: () => void }).__paperCleanup?.();
        m.remove();
      }
      mapRef.current = null;
      setMapInstance(null);
    };
  }, []);

  // Re-apply the crayon override when sniff mode toggles. The override
  // is idempotent — it just rewrites paint properties + tops up any
  // injected layers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Re-apply when sniff palette OR language changes — the override
    // sets both paint colours AND text-field language, so a lang flip
    // from the profile toggle re-localises street/place labels live.
    const apply = () => {
      applyCrayonOverride(map, sniffMode ? DARK_PALETTE : LIGHT_PALETTE, lang);
      // applyCrayonOverride resets transportation_name visibility to
      // 'visible', so re-apply the pitch-based hide right after.
      syncStreetLabels();
      // …and it re-opacities the fill-extrusion buildings; keep them hidden
      // so the Three.js city stays the sole building treatment — but only when
      // the game render actually initialised (the Three layer is present).
      // On a WebGL2-fallback session there's no Three layer, so we must NOT
      // hide MapLibre's buildings or we'd be left with none.
      if (GAME_RENDER && map.getLayer(THREE_BUILDINGS_LAYER_ID)) {
        hideMapLibreBuildings(map);
      }
    };
    // The style is briefly "not loaded" while it's mid-update — which happens
    // exactly during rapid sniff toggles. The old code bailed here, DROPPING
    // that toggle's palette change, so a sequence like on→off→on→off could
    // leave the base map stuck on the previous tone (dark floor under a day
    // sky). Instead of dropping it, apply now if we can, else once the style
    // settles. The cleanup cancels a still-pending apply if sniff/lang flips
    // again first, so we never apply a stale palette.
    if (map.isStyleLoaded()) {
      apply();
      return;
    }
    map.once('idle', apply);
    return () => {
      map.off('idle', apply);
    };
  }, [sniffMode, lang, syncStreetLabels]);

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
    // Portaled to document.body — suppress entirely off the map tab so
    // the chips don't paint over other screens.
    if (!onMapScreen) return [];
    if (!sniffMode && !sniffJustChanged) return [];
    if (!mapBounds || !userPos) return [];
    const { n, s, e, w } = mapBounds;
    // Reserves clear the actual UI elements:
    // - top: small bump to clear the OS status bar / dynamic island.
    //   `topLeftSkip` separately keeps the leftmost chunk of the top
    //   edge clear of the corner logo (which lives at top-left).
    // - bottom: clears the dashboard tab bar (~10% of typical phone
    //   viewport including the home-indicator strip).
    // - sides: small padding so chips don't graze the screen edges.
    // Not perfectly symmetric, but the asymmetry follows the actual
    // UI footprint instead of being arbitrary.
    // Bumped 0.05 → 0.02 — chips on left / right edges sat well
    // inside the viewport before, leaving a visible inset strip
    // between the chip and the screen edge that read as "wasted"
    // margin. 2% sits the chips almost flush with the edge.
    const sideReserve = 0.02;
    // Was 0.04 — chips on the top edge ended up directly under the
    // Chips on the top edge now sit at the actual top of the
    // viewport so 'this pet is far north' reads as far north, not
    // 'just outside the visible area.' Chips have higher z than the
    // HUD pills and the corner logo, so a chip overlapping either
    // catches the tap. Just enough top inset to clear the iPhone
    // dynamic island / status bar.
    const topReserve = 0.02;
    // In sniff mode the dashboard (tab bar) is hidden, so the locate chips get
    // the full screen height — drop the bottom reserve to the same small edge
    // inset as the top. (Outside sniff — the brief toggle-off window — keep the
    // reserve that clears the returning tab bar.)
    const bottomReserve = sniffMode ? 0.02 : 0.10;
    const chipHalfPct = 0.04;
    const SPACING_ALONG = 0.12;
    // Used to be 0.18 to dodge the corner logo. Dropped to a small
    // inset since chip z-index already wins over the logo zone — the
    // chip floats above the logo when they collide. Still skip a
    // tiny edge so chips don't sit flush against the screen corner.
    const topLeftSkip = 0.03;

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

    // Companion bookmark's edge + along position (if it's also
    // off-screen). Treated below as a "no-fly zone" so dog chips
    // don't visually pile on top of the bookmark on a shared
    // edge — they get nudged left or right of it along the edge.
    // Inline computation rather than reading offscreenIndicator
    // because that's an IIFE that runs LATER in the render.
    let companionEdgeAlong: { edge: EdgeName; along: number } | null = null;
    if (
      companionPos &&
      (companionPos.lat > n ||
        companionPos.lat < s ||
        companionPos.lng > e ||
        companionPos.lng < w)
    ) {
      const cnx = (companionPos.lng - w) / (e - w);
      const cny = (n - companionPos.lat) / (n - s);
      const cdx = cnx - 0.5;
      const cdy = cny - 0.5;
      // Companion's own reserves (matches the IIFE below).
      const cSide = 0.01;
      const cTop = 0.02;
      const cBottom = 0.08;
      const cxBound = cdx > 0 ? 1 - cSide - 0.5 : 0.5 - cSide;
      const cyBound = cdy > 0 ? 1 - cBottom - 0.5 : 0.5 - cTop;
      const ctx = Math.abs(cxBound / Math.max(Math.abs(cdx), 1e-6));
      const cty = Math.abs(cyBound / Math.max(Math.abs(cdy), 1e-6));
      if (ctx < cty) {
        companionEdgeAlong = {
          edge: cdx > 0 ? 'right' : 'left',
          along: 0.5 + cdy * ctx,
        };
      } else {
        companionEdgeAlong = {
          edge: cdy > 0 ? 'bottom' : 'top',
          along: 0.5 + cdx * cty,
        };
      }
    }

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
          : edgeName === 'top'
            ? topLeftSkip + chipHalfPct
            : sideReserve + chipHalfPct;
      const hi =
        edgeName === 'left' || edgeName === 'right'
          ? 1 - bottomReserve - chipHalfPct
          : 1 - sideReserve - chipHalfPct;
      // No-fly zone around the companion bookmark on this edge.
      // Dog chips inside the zone are pushed to the nearer side
      // of it; the regular SPACING_ALONG cascade below then
      // re-spaces them so two chips never overlap each other
      // either.
      if (companionEdgeAlong && companionEdgeAlong.edge === edgeName) {
        const COMPANION_NOFLY = SPACING_ALONG; // one slot wide
        const ca = companionEdgeAlong.along;
        for (const c of g) {
          const delta = c.along - ca;
          if (Math.abs(delta) < COMPANION_NOFLY) {
            c.along = delta < 0 ? ca - COMPANION_NOFLY : ca + COMPANION_NOFLY;
          }
        }
        // Re-sort after the shifts so the spacing cascade below
        // walks them in their new along-order.
        g.sort((a, b) => a.along - b.along);
      }
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
        // Push top-edge chips down by the iOS safe-area inset so
        // they clear the system status bar (clock/signal/battery).
        // Taps inside the status-bar strip get intercepted by iOS,
        // so a chip sitting in it feels dead.
        top:
          c.edge === 'top'
            ? `calc(${topPct * 100}% + ${insets.top}px)`
            : `${topPct * 100}%`,
      };
    });
  }, [
    onMapScreen,
    mapBounds,
    userPos?.lat,
    userPos?.lng,
    visibleLostDogs,
    displayPositions,
    sniffMode,
    sniffJustChanged,
    // companionPos so the no-fly zone follows the companion
    // bookmark when the dog wanders along an edge.
    companionPos?.lat,
    companionPos?.lng,
    insets.top,
  ]);

  // Nearby players (real + bots) to render as other dogs — only in view, and
  // capped to the nearest N for perf (each walker runs a glide loop + sprite).
  // MUST stay above the early `!userPos` return below (Rules of Hooks).
  const otherWalkers = useMemo(() => {
    if (!MULTIPLAYER || !onMapScreen || !nearbyPlayers.length) return [];
    let list = nearbyPlayers;
    if (mapBounds) {
      const padLat = (mapBounds.n - mapBounds.s) * 0.15;
      const padLng = (mapBounds.e - mapBounds.w) * 0.15;
      list = list.filter(
        (p) =>
          p.position.lat <= mapBounds.n + padLat &&
          p.position.lat >= mapBounds.s - padLat &&
          p.position.lng <= mapBounds.e + padLng &&
          p.position.lng >= mapBounds.w - padLng,
      );
    }
    const up = userPos;
    if (up && list.length > 24) {
      list = [...list]
        .sort(
          (a, b) =>
            distanceMeters(up, a.position) - distanceMeters(up, b.position),
        )
        .slice(0, 24);
    }
    // Nudge their shown dot out of building footprints (display only).
    const av = buildingAvoiderRef.current;
    if (av) list = list.map((p) => ({ ...p, position: av.nudge(p.position) }));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bucketed userPos; version drives re-nudge
  }, [nearbyPlayers, mapBounds, userPos?.lat, userPos?.lng, onMapScreen, buildingIndexVersion]);

  if (!userPos) {
    return (
      <View style={styles.msg}>
        <Text style={styles.t}>{t.hud.locating}</Text>
        {location.usingFallback ? <Text style={styles.s}>{t.hud.usingKyivFallback}</Text> : null}
      </View>
    );
  }

  // Off-screen companion indicator: when the companion drifts (or the
  // user pans away) outside the map's visible bounds, a small icon
  // sticks to the screen edge nearest to the companion. Tap recenters.
  // `mapBounds` is the latest snapshot from the map's `idle` event; the
  // edge position is computed against the current companion lat/lng.
  // `topReserve` clears the iPhone dynamic island / OS status bar — at
  // 0 the bookmark was clipping under the curved system bar.
  const offscreenIndicator = (() => {
    // Portaled to document.body — suppress off the map tab so the chip
    // doesn't paint over other screens.
    if (!onMapScreen) return null;
    // Dog-cam / search mode: never collapse the dog into an edge chip — it's
    // the star of this view (it's leading you), and the camera keeps it framed.
    // Recentring on each new route (below) keeps it on-screen.
    if (DOG_CAM && dogCam) return null;
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
    // Reserves push the bookmark in from the edge — kept
    // tight per user request so the chip hugs the screen
    // sides + the dashboard.
    const sideReserve = 0.01;
    const topReserve = 0.02;
    const bottomReserve = 0.08;
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
    return {
      left: `${leftPct * 100}%`,
      // Same safe-area shift for top-edge companion chip — keeps
      // it out of the iOS status-bar tap dead-zone.
      top:
        edge === 'top'
          ? `calc(${topPct * 100}% + ${insets.top}px)`
          : `${topPct * 100}%`,
      edge,
    };
  })();

  const recenterOnCompanion = () => {
    if (!companionPos || !mapRef.current) return;
    mapRef.current.panTo(companionPos);
  };


  const formatDistance = (m: number): string => {
    if (m < 1000) return `${Math.round(m / 10) * 10}m`;
    return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)}km`;
  };

  const panToDog = (target: LatLng) => {
    if (!mapRef.current) return;
    mapRef.current.panTo(target);
  };

  return (
    <div style={{ flex: 1, position: 'relative', width: '100%', height: '100%' }}>
      <div
        ref={mapContainerRef}
        style={{ width: '100%', height: '100%' }}
      />
      <div
        ref={paperOverlayRef}
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          backgroundImage: `url(${paperUrl})`,
          backgroundRepeat: 'repeat',
          backgroundSize: '512px 512px',
          mixBlendMode: paperBlend,
          opacity: paperOpacity,
        }}
      />
      {/* Long-press "press the map" cue — lives on open map BELOW the
          dog (not radiating from it), so it reads as "hold the map
          here", not "tap the dog". Shown only while the long-press
          hint's bubble is up. */}
      {onMapScreen && activeHint === 'map:long-press-to-sniff' ? (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: '50%',
            // Sits well below the dog's 140px tap target (the dog snaps
            // to ~centre+60 when the hint fires) so holding ON the cue
            // lands on the bare map and actually starts a sniff — but
            // high enough that the expanding rings clear the tab bar.
            top: '76%',
            transform: 'translate(-50%, -50%)',
            width: 84,
            height: 84,
            pointerEvents: 'none',
          }}
        >
          <div style={mapPulseRing(0)} />
          <div style={mapPulseRing(0.9)} />
          {/* Fingertip dot pressing in the centre. */}
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: 'rgba(0,0,0,0.55)',
              transform: 'translate(-50%, -50%)',
              animation: 'hint-map-press 1.8s ease-in-out infinite',
            }}
          />
        </div>
      ) : null}
      <MapContext.Provider value={mapInstance}>
        {/* Hide the user dot when it's outside the visible bounds — at max
            pitch an off-screen (beyond-horizon) position would otherwise
            project up into the sky. */}
        {!mapBounds ||
        (userPos.lat <= mapBounds.n &&
          userPos.lat >= mapBounds.s &&
          userPos.lng <= mapBounds.e &&
          userPos.lng >= mapBounds.w) ? (
          <UserMarker position={userPos} />
        ) : null}

        {/* Other players' dogs (real + bots) — multiplayer presence. Glide
            between the ~15s presence updates so they read as people walking. */}
        {otherWalkers.map((p) => (
          <OtherWalker key={p.id} player={p} />
        ))}

        {/* Zone is only drawn for the currently-selected pet — otherwise
            overlapping circles turn dense neighborhoods (Podil, Pechersk)
            into a lava lamp. Tapping a pin blooms the zone for that pet.
            Suppressed in dog-cam: the blue beacon fog marks the previewed
            zone there, and the circle fill just washed the area. */}
        {DOG_CAM && dogCam
          ? null
          : lostDogs
              .filter((d) => d.id === selectedDogId)
              .map((d) => (
                <SearchZoneCircle
                  key={`zone-${d.id}`}
                  center={d.lastSeen.position}
                  radiusM={d.searchZoneRadiusM}
                  urgency={d.urgency}
                />
              ))}

        {/* Lost-dog pins are hidden in dog-cam/search mode — the carousel +
            the previewed zone (with its blue beacon) are the focus there, and
            the photo pins just clutter the immersive shot. */}
        {(DOG_CAM && dogCam ? [] : clusters).flatMap((c) => {
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

        {avoidedTokens.map((t) => (
          <TokenMarker
            key={t.id}
            position={t.position}
            onTap={tokenTapHandlers.get(t.id)!}
            inverted={sniffMode}
          />
        ))}

        {avoidedFood.map((f) => (
          <FoodMarker
            key={f.id}
            position={f.position}
            onTap={foodTapHandlers.get(f.id)!}
            inverted={sniffMode}
          />
        ))}

        {/* Collect-burst FX — pops at the spot of each paw/bone pickup. */}
        {collectBursts.map((b) => (
          <CollectBurst
            key={b.seq}
            position={{ lat: b.lat, lng: b.lng }}
            kind={b.kind}
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
              <CrayonRoute
                path={questRoute}
                color="#2f6bff"
                weight={10}
                opacity={0.92}
                autoFit={false}
              />
            ) : (
              <CrayonRoute
                path={activeQuest.waypoints.map((w) => ({
                  lat: w.position.lat,
                  lng: w.position.lng,
                }))}
                color="#2f6bff"
                weight={6.5}
                opacity={0.65}
                autoFit={false}
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
                              narration ?? t.bubbles.questComplete,
                              6000,
                            );
                          } else if (advanced) {
                            showBubble(
                              narration ?? t.bubbles.questAdvance,
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
          <CrayonRoute path={walkRoute} color="#2f6bff" weight={9} opacity={0.8} />
        ) : null}

        {/* Long-press anywhere on the bare map → dog sniffs the area
            and surfaces one nearby kyiv_lore entry with a story and
            a "let's go here" CTA. Past finds excluded so each press
            picks something new. */}
        <SniffPress />

        {companionPos ? (
          <Companion
            position={companionPos}
            bubble={bubble}
            hideBubble={offscreenIndicator != null}
            hidden={offscreenIndicator != null}
            onTap={() => {
              companionTappedAtRef.current = Date.now();
            }}
            onTapCompanion={() => {
              showBubble(t.bubbles.simpleWoof, 4000);
              // Snap the camera back to the dog whenever the user
              // taps him — same easeTo recipe recenterOnCompanion
              // uses, so distant pans don't leave him orphaned in
              // the corner.
              recenterOnCompanion();
            }}
          />
        ) : null}

        {/* Sniff-and-lead: the route the dog is leading you along. */}
        {DOG_CAM && dogCam && searchRoute && searchRoute.length >= 2 ? (
          <CrayonRoute
            path={searchRoute}
            color="#2f6bff"
            weight={9}
            opacity={0.85}
            autoFit={false}
          />
        ) : null}
      </MapContext.Provider>

      {/* "X poked you!" notification (multiplayer). Portaled to body; taps
          fly the camera to the poker if they're still online. */}
      {MULTIPLAYER && onMapScreen ? (
        <PokeToast
          onGoTo={(p) =>
            mapRef.current?.easeTo({
              center: [p.lng, p.lat],
              zoom: Math.max(mapRef.current.getZoom(), 16.5),
              duration: 700,
            })
          }
        />
      ) : null}

      {/* Search mode: the same swipeable card stack as the Quests tab, at the
          bottom in place of the dashboard. The centred card is the dog you're
          on the trail of — swipe or tap to hand yourself that dog's trail. */}
      {DOG_CAM && dogCam && onMapScreen ? (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: -14,
            alignItems: 'center',
            zIndex: Z.HUD_CHIPS,
          }}
          pointerEvents="box-none"
        >
          <LostDogCardStack
            dogs={searchDogs}
            onTap={assignSearch}
            onSwipe={previewSearch}
            cardWidth={200}
            cardHeight={176}
            showCounter={false}
          />
        </View>
      ) : null}

      {/* Cancel pills — small floating chips that drop in below the
          HUD when a route or quest is active. Stacked vertically so
          both can show at once (rare but valid: a walk + a separate
          quest). Tapping a pill clears the corresponding state. */}
      {(walkRoute || activeQuest) ? (
        <div
          style={{
            position: 'absolute',
            top: 100,
            left: 0,
            right: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: S.s,
            zIndex: Z.HUD_PILLS_OVERLAY,
            pointerEvents: 'none',
          }}
        >
          {walkRoute ? (
            <div
              role="button"
              aria-label={t.hud.cancelWalk}
              onClick={() => setWalkRoute(null, null)}
              style={{
                pointerEvents: 'auto',
                cursor: 'pointer',
                padding: '8px 16px',
                background: '#ffffff',
                color: '#1a1a1a',
                borderRadius: R.pill,
                fontFamily: SYSTEM_FONT,
                fontSize: TYPE.small,
                fontWeight: 600,
                boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                border: '1px solid rgba(0,0,0,0.06)',
                userSelect: 'none',
              }}
            >
              × {t.hud.cancelWalk}
            </div>
          ) : null}
          {activeQuest ? (
            <div
              role="button"
              aria-label={t.hud.abandonQuest}
              onClick={() => {
                void abandonActiveQuest();
              }}
              style={{
                pointerEvents: 'auto',
                cursor: 'pointer',
                padding: '8px 16px',
                background: '#ffffff',
                color: '#1a1a1a',
                borderRadius: R.pill,
                fontFamily: SYSTEM_FONT,
                fontSize: TYPE.small,
                fontWeight: 600,
                boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                border: '1px solid rgba(0,0,0,0.06)',
                userSelect: 'none',
              }}
            >
              × {t.hud.abandonQuest}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Off-screen companion bookmark. Sticks to the viewport edge
          along the line from map center to the companion's position
          so the user can always see where they are even after panning
          far away. Tap recenters the map. Per-edge transform anchors
          the chip's edge-side to the screen edge so dropping
          topReserve to 0 doesn't clip half the chip. */}
      {offscreenIndicator && typeof document !== 'undefined' ? createPortal(
        // Portaled to document.body so the chip's z-index lives
        // at the page root. Setting zIndex on the chip inside
        // MapView wasn't enough — the parent stacking contexts
        // (mapLayer, possibly MapLibre's canvas wrapper) trapped
        // it below the HUD container despite z=50 > HUD z=30.
        // The portal already lifts it above the in-#root HUD (it's
        // a later sibling of #root in <body>); HUD_CHIP_COMPANION
        // then keeps it above the lost-pet chips while staying
        // BELOW the modal tiers (MODAL_MAP / MODAL_GLOBAL) so the
        // lost-dog / spot modals cover it.
        //
        // Outer wrapper owns positioning + edge transform. Inner
        // wrapper owns the chip's visual (bg / border / shadow /
        // size) and is what we animate the tap-pop on — keeping
        // the scale off the outer means the position transform
        // doesn't get clobbered.
        <div
          onClick={(e) => {
            playPop(e.currentTarget.firstElementChild as HTMLElement | null);
            recenterOnCompanion();
          }}
          role="button"
          aria-label={t.hud.recenterOnCompanion}
          style={{
            position: 'fixed',
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
            zIndex: Z.HUD_CHIP_COMPANION,
            cursor: 'pointer',
          }}
        >
          <div
            style={{
              // Adaptive to mode — dark chip + inverted white logo
              // on the light map (pops against the pastel bg), light
              // chip + black logo on sniff mode (pops against the
              // dark bg). Matches the corner logo's same recipe.
              background: sniffMode ? '#ffffff' : '#1a1a1a',
              borderRadius: R.pill,
              width: 56,
              height: 56,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 14px rgba(0,0,0,0.22)',
              border: sniffMode
                ? '2px solid rgba(0,0,0,0.06)'
                : '2px solid rgba(255,255,255,0.08)',
            }}
          >
            {/* Wrapper div carries the CSS invert filter when we need
                the logoNose PNG flipped to white. Filter on the
                wrapper (not the <Image> itself) avoids the iOS Safari
                quirk where RN-Web's <Image> drops the filter prop. */}
          <div
            aria-hidden
            style={{
              width: 38,
              height: 38,
              filter: sniffMode ? undefined : 'invert(1)',
            }}
          >
            <Image
              source={logoNose}
              style={{ width: 38, height: 38 }}
              resizeMode="contain"
            />
          </div>
          </div>
        </div>,
        document.body,
      ) : null}

      {/* When the dog is off-screen we mirror his current bubble next
          to the edge chip so the user keeps hearing him while they pan
          around looking at other neighborhoods. Anchored to the same
          edge as the chip but pushed inward so it doesn't clip the
          screen border. */}
      {offscreenIndicator && bubble ? (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: offscreenIndicator.left,
            top: offscreenIndicator.top,
            transform:
              offscreenIndicator.edge === 'top'
                ? 'translate(-50%, 60px)'
                : offscreenIndicator.edge === 'bottom'
                  ? 'translate(-50%, calc(-100% - 60px))'
                  : offscreenIndicator.edge === 'left'
                    ? 'translate(66px, -50%)'
                    : 'translate(calc(-100% - 66px), -50%)',
            transition:
              'left 380ms cubic-bezier(0.22, 1, 0.36, 1), top 380ms cubic-bezier(0.22, 1, 0.36, 1)',
            zIndex: Z.HUD_CHIP_BUBBLE,
            // Same dimensions / type as the in-map SpeechBubble.
            padding: '12px 10px',
            background: VOICE.background,
            color: VOICE.color,
            borderRadius: R.chip,
            fontFamily: VOICE.fontFamily,
            fontSize: TYPE.body,
            lineHeight: 1.4,
            boxShadow: VOICE.shadow,
            border: VOICE.border,
            pointerEvents: 'none',
            maxWidth: 'min(60vw, 320px)' as unknown as number,
            whiteSpace: 'pre-line',
          }}
        >
          {bubble}
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
      {/* Portaled to document.body — same fix as the companion
          chip. Without the portal, these top-edge chips were
          trapped behind the HUD pills (parent stacking context
          capped their z-index) and couldn't be tapped. Position
          changes from absolute to fixed inside the chip; the
          `left` / `top` percentages were already viewport-
          relative via offscreenDogIndicators. */}
      {typeof document !== 'undefined' && offscreenDogIndicators.length > 0
        ? createPortal(
            <>{offscreenDogIndicators.map((d) => {
        // Mirror the on-screen LostDogMarker halo so chips visually
        // echo the actual map pins. Medium-urgency BADGE swapped from
        // amber `rgba(217,160,48,...)` (read as gold + clashed with
        // the photo edges) to a vibrant orange `rgba(255,140,0,...)`
        // — same "warning" bucket but doesn't read as a gold rim.
        // The disc's GLOW stays amber so the on-screen ↔ off-screen
        // urgency cue still ties together.
        // Solid badge fills — no rgba alpha so urgent / medium /
        // low all read as plain coloured pills rather than tinted
        // translucent ones. Low-urgency uses black instead of grey
        // per the "no grey backgrounds" rule.
        // Per-urgency badge fill stays (red / orange / black) —
        // that's the actual urgency signal. The shadow / glow
        // dropped its urgency tint per user request: every chip
        // now uses the same neutral shadow recipe — dark drop
        // shadow on the light map, inverse white halo in
        // supersniff (dark) mode so the chip still lifts off
        // the bg. Family-consistent with companion chip + card
        // shadows across the rest of the app.
        const halo = {
          glow: sniffMode
            ? '0 0 14px rgba(255,255,255,0.35), 0 2px 6px rgba(255,255,255,0.10)'
            : '0 4px 14px rgba(0,0,0,0.22)',
          badge:
            d.urgency === 'urgent'
              ? '#e84040'
              : d.urgency === 'medium'
                ? '#ff8c00'
                : '#1a1a1a',
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
            onClick={(e) => {
              // Pop the FIRST CHILD (the visual wrapper) not the
              // outer — outer holds the position transform
              // (translate(-50%, -100%) etc. for edge anchoring)
              // and a scale on it would teleport the chip to the
              // anchor point. Same pattern as MapLibreMarker.
              playPop(e.currentTarget.firstElementChild as HTMLElement | null);
              panToDog(d.target);
            }}
            role="button"
            aria-label={`pan to ${d.name}, ${formatDistance(d.distanceM)} away`}
            style={{
              position: 'fixed',
              left: d.left,
              top: d.top,
              transform: edgeTransform,
              transition:
                'left 380ms cubic-bezier(0.22, 1, 0.36, 1), top 380ms cubic-bezier(0.22, 1, 0.36, 1)',
              // Portaled to document.body (see wrapping createPortal),
              // so z lives at the page root above the in-#root HUD.
              // HUD_CHIPS (35) sits one tier below the companion chip
              // (HUD_CHIP_COMPANION = 38) so the bookmark wins when both
              // pin to the same edge, and below the modal tiers so the
              // lost-dog / spot modals cover the chips.
              zIndex: Z.HUD_CHIPS,
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
                // Stagger so chips bubble in AFTER the HUD finishes
                // collapsing on sniff-on (200ms delay), and pop OUT
                // immediately on sniff-off (HUD then bubbles back in
                // with its own delay). `both` fill mode applies the
                // 0% keyframe during the delay window so chips don't
                // flash visible before the animation starts.
                animation: sniffJustChanged
                  ? sniffMode
                    ? 'pop-in 360ms cubic-bezier(0.34, 1.56, 0.64, 1) 200ms both'
                    : 'pop-out 280ms ease-in forwards'
                  : 'none',
                pointerEvents: sniffMode ? 'auto' : 'none',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: R.pill,
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
                  fontSize: TYPE.display,
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
                  paddingLeft: S.xs,
                  paddingRight: S.xs,
                  borderRadius: R.sm,
                  background: halo.badge,
                  color: '#ffffff',
                  fontFamily: SYSTEM_FONT,
                  fontSize: TYPE.caption,
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
      })}</>,
            document.body,
          )
        : null}

      {/* Unified bubble keyframes shared by the off-screen chips
          AND the HUD pills (StatusBar / QuestPill). The previous
          `chip-pop-out` / `hud-pop-out` were already identical;
          `chip-pop-in` / `hud-pop-in` differed only in the overshoot
          magnitude (1.12 vs 1.08) which read the same on screen.
          One pair of keyframes, less to keep in sync. */}
      <style>{`
        @keyframes pop-in {
          0%   { transform: scale(0);    opacity: 0; }
          70%  { transform: scale(1.10); opacity: 1; }
          100% { transform: scale(1);    opacity: 1; }
        }
        @keyframes poke-wave {
          0%   { transform: translateY(0) scale(0.6) rotate(-15deg); opacity: 0; }
          25%  { transform: translateY(-6px) scale(1.15) rotate(12deg); opacity: 1; }
          100% { transform: translateY(-20px) scale(1) rotate(-8deg); opacity: 0; }
        }
        @keyframes poke-card-in {
          0%   { transform: translateY(-16px) scale(0.8); opacity: 0; }
          60%  { transform: translateY(0) scale(1.06);    opacity: 1; }
          100% { transform: translateY(0) scale(1);       opacity: 1; }
        }
        @keyframes poke-dog-bounce {
          0%,100% { transform: translateY(0); }
          50%     { transform: translateY(-7px); }
        }
        @keyframes pop-out {
          0%   { transform: scale(1);    opacity: 1; }
          25%  { transform: scale(1.10); opacity: 1; }
          100% { transform: scale(0);    opacity: 0; }
        }
        @keyframes hint-map-pulse {
          0%   { transform: translate(-50%, -50%) scale(0.4); opacity: 0.5; }
          70%  { opacity: 0; }
          100% { transform: translate(-50%, -50%) scale(1.8); opacity: 0; }
        }
        @keyframes hint-map-press {
          0%, 100% { transform: translate(-50%, -50%) scale(1);    }
          50%      { transform: translate(-50%, -50%) scale(0.82); }
        }
        /* Collectible idle "float" — paws/bones gently bob + breathe so
           they read as live game pickups rather than flat map decals. */
        @keyframes collectible-bob {
          0%, 100% { transform: translateY(0)    scale(1);    }
          50%      { transform: translateY(-3px) scale(1.06); }
        }
        /* Collect burst — the picked-up icon pops up, swells and fades. */
        @keyframes collect-burst-icon {
          0%   { transform: translate(-50%, -50%) scale(1);   opacity: 1; }
          35%  { transform: translate(-50%, -120%) scale(1.7); opacity: 1; }
          100% { transform: translate(-50%, -210%) scale(0.6); opacity: 0; }
        }
        /* Expanding shockwave ring at the pickup spot. */
        @keyframes collect-burst-ring {
          0%   { transform: translate(-50%, -50%) scale(0.3); opacity: 0.6; }
          100% { transform: translate(-50%, -50%) scale(2.6); opacity: 0; }
        }
        /* Floating "+1" that rises and fades above the pickup. */
        @keyframes collect-burst-plus {
          0%   { transform: translate(-50%, -60%)  scale(0.6); opacity: 0; }
          25%  { transform: translate(-50%, -120%) scale(1.1); opacity: 1; }
          100% { transform: translate(-50%, -230%) scale(1);   opacity: 0; }
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
            // Bumped to match the chip + companion-bookmark layer so
            // it reliably stacks above the HUD on web/PWA.
            zIndex: Z.HUD_PILLS_OVERLAY,
            cursor: 'pointer',
            background: '#ffffff',
            // Round on the LEFT side only so it reads as docked to
            // the screen edge.
            borderTopLeftRadius: R.card,
            borderBottomLeftRadius: R.card,
            width: 56,
            height: 56,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: S.xs,
            boxShadow: '0 6px 20px rgba(0,0,0,0.14), 0 2px 6px rgba(0,0,0,0.08)',
            userSelect: 'none',
          }}
        >
          {/* Three stacked bars — the longer bottom bar reads as
              "stack" the way a hamburger-but-tapered glyph does. */}
          <div style={{ width: 18, height: 3, background: '#1a1a1a', borderRadius: R.sm }} />
          <div style={{ width: 22, height: 3, background: '#1a1a1a', borderRadius: R.sm }} />
          <div style={{ width: 26, height: 3, background: '#1a1a1a', borderRadius: R.sm }} />
        </div>
      ) : null}

      {/* Both modals portal to document.body, so gate them on the map
          tab — otherwise a sheet left open while you switch tabs stays
          painted over the other screens. Unmounting via `onMapScreen`
          (rather than nulling the prop) drops the portal instantly on
          tab-switch with no slide-out flash over the next tab, while
          the normal X-to-close animation still runs on the map. */}
      {onMapScreen ? (
      <>
      <LostDogModal
        dog={lostDogs.find((d) => d.id === selectedDogId) ?? null}
        onClose={() => setSelectedDog(null)}
        searchActive={!!activeQuest && activeQuest.dogId === selectedDogId}
        onPrev={lostDogs.length > 1 ? () => cycleSelectedDog(-1) : undefined}
        onNext={lostDogs.length > 1 ? () => cycleSelectedDog(1) : undefined}
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
      </>
      ) : null}
    </div>
  );
}

const styles = StyleSheet.create({
  msg: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.greyBg,
    padding: S.xl,
  },
  t: { fontSize: TYPE.body, color: colors.black },
  s: { fontSize: TYPE.small, color: colors.grey, marginTop: 6, textAlign: 'center' },
});
