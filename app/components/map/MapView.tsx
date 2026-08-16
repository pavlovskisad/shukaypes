import type { CSSProperties } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFocusEffect } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { View, Text, StyleSheet, Image, Pressable } from 'react-native';
import type { UrgencyLevel } from '@shukajpes/shared';
import { colors } from '../../constants/colors';
import { balance } from '../../constants/balance';
import { R } from '../../constants/radius';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
import { DEV_TOOLS } from '../../constants/devTools';
import { useGameStore } from '../../stores/gameStore';
import { MapContext } from './MapContext';
import {
  LIGHT_PALETTE,
  applyCrayonOverride,
  setStreetLabelsVisible,
  fetchCrayonStyleSpec,
} from './crayonStyle';
import type { Spot } from '../../services/places';
import { useLocation, isSimulatedWalk } from '../../hooks/useLocation';
import { useCompanion } from '../../hooks/useCompanion';
import { useGameLoop } from '../../hooks/useGameLoop';
import {
  distanceMeters,
  formatDistance,
  pointAheadOnRoute,
  remainingRouteMeters,
} from '../../utils/geo';
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
import { LostDogCardStack, LostDogCardView } from '../ui/LostDogCardStack';
import { DogPrompt } from './DogPrompt';
import { createBuildingAvoider } from './buildingAvoider';
import { GAME_RENDER, MULTIPLAYER, DOG_CAM, LOST_DOG_PINS } from '../../constants/experiments';
import { LostDogMarker } from './LostDogMarker';
import { LostDogCluster, URGENCY_RANK } from './LostDogCluster';
import { LostDogModal } from '../ui/LostDogModal';
import { SpotModal } from '../ui/SpotModal';
import { getDeepLinkDogId } from '../../services/telegram';
import { useStrings } from '../../i18n/useStrings';
import { useLangStore } from '../../stores/langStore';
import { fetchWalkingRoute } from '../../services/directions';
import { api, type NearbyLostDog } from '../../services/api';
import { PoiMarker } from './PoiMarker';
import { PoiCluster } from './PoiCluster';
import { WaypointMarker } from './WaypointMarker';
import { clusterByDistance, jitterInRadius } from '../../utils/cluster';
import { SniffPress } from './SniffPress';
import { TerritoryLayer } from './TerritoryLayer';
import type { LatLng } from '@shukajpes/shared';
import { Z } from '../../constants/z';
import { VOICE } from '../../constants/voice';
import { SYSTEM_FONT } from '../../constants/fonts';

const TOKEN_REFRESH_MS = 15000;
// Extra syncs while actually walking, so a fast mover isn't looking at a
// fifteen-second-old city. Both gates have to pass: 30m of real ground
// covered AND 4s since the last one. The time gate is the important half
// — /sync/map takes over a second to answer, so anything tighter puts a
// second request on the wire before the first has landed, and then the
// newest response is not reliably the last one applied.
const SYNC_MOVE_M = 30;
const SYNC_MIN_GAP_MS = 4000;
// How often other dogs' positions refresh. Matched to the bot simulation
// tick (3.5s) — polling faster cannot return anything newer.
const PRESENCE_MS = 3000;

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
const DOGCAM_PITCH = 70;
const DOGCAM_ZOOM = 18.6;
const DOGCAM_TICK = 350;
const DOGCAM_MIN_MOVE_M = 0.6;
// Preview (carousel-swipe) camera: keep the immersive 3D tilt and look FROM you
// TOWARD the dog's zone, so the zone sits out in the distance/horizon where the
// fog layer washes it brand-blue — rather than a flat zoomed-out overview.
// Close + tilted (near the dog-cam feel) — eased less steep so the horizon sits
// lower and the shot feels less cramped. Zoomed in ~20% vs before (16.3 → 16.55)
// so the tighter framing pushes the beacon farther up the screen, opening a gap
// above the dog for its speech bubble before the beacon.
const PREVIEW_PITCH = 68;
const PREVIEW_ZOOM = 16.55;
// The dog rides at true screen CENTRE in supersniff — same as every other
// camera framing (hint snaps, radial-menu open). We used to reserve 24% top
// padding for a car-nav "dog low" feel, but the padded centre (62% of map
// height) landed the dog ON the carousel on short viewports (iPhone Safari
// with its URL bar showing) and only cleared it once Safari's chrome
// collapsed — read as a framing bug. Centre clears the carousel everywhere.
// How far ahead along the route the committed cam looks — it faces this point so
// the view runs DOWN the route (not perpendicular to it) and tracks its curves.
const ROUTE_LOOK_AHEAD_M = 90;

// Cinematic lost-dog view (pin tapped / quests-tab jump): the camera pulls
// back and tilts, the pet's PIN snaps to the true screen centre (its story
// bubble stacks above it), the whole search zone lights up with the
// supersniff-preview-style blue beacon, and the pin grows to the big photo
// pin. Pitch sits well under the street-level game pitch (74) so the shot
// reads as a helicopter establishing view.
const DOG_VIEW_PITCH = 57;
// Fixed district-level zoom — the pet's part of the city with the zone
// glow spreading around it, without collapsing into a full-city overview.
const DOG_VIEW_ZOOM = 14.6;
// Where the pin's FOOT lands on screen, measured from below the safe-area
// inset: the story-bubble stack top (122, see LostDogModal.STACK_TOP) +
// the bubble/pills block (~145) + a small gap + the pin's own artwork
// above its foot (~120 at the 110px disc, no name label). Together with
// the top-anchored stack this makes HUD → bubble → pills → pin one snug
// centred column.
const DOG_VIEW_PIN_TOP_PX = 405;
// THE GAME CAMERA'S TILT. One constant, used by the map's opening pitch,
// the return from a dog view, and the return from supersniff — those were
// three separate literals until they disagreed.
//
// 74° was chosen when the map opened at zoom 17.5, right down among the
// buildings, where a steep tilt is what gave the street any depth at all.
// Pulling the default back to 15.6 changed the arithmetic: at that
// distance 74° stacks a kilometre of city into the top third of the
// screen and everything past the near blocks reads as haze. 65° spreads
// the same ground over more of the frame, so the neighbours you are
// meant to be looking at have room to be seen.
//
// Still a tilt, not a plan view. The point is a world you look ACROSS.
const GAME_PITCH = 65;

// Safe-area top inset in CSS px, measured once via an env() probe —
// SafeAreaView values aren't reachable here and the inset differs
// between browser-tab (0) and installed-PWA (notch height) contexts.
let cachedSafeTop: number | null = null;
function safeAreaTopPx(): number {
  if (cachedSafeTop != null) return cachedSafeTop;
  if (typeof document === 'undefined') return 0;
  try {
    const el = document.createElement('div');
    el.style.cssText =
      'position:fixed;top:0;height:0;padding-top:env(safe-area-inset-top, 0px);visibility:hidden;pointer-events:none;';
    document.body.appendChild(el);
    cachedSafeTop = el.getBoundingClientRect().height;
    el.remove();
  } catch {
    cachedSafeTop = 0;
  }
  return cachedSafeTop;
}
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

// Experiment (GAME_RENDER): hide EVERY MapLibre building layer so the
// Three.js extruded city owns the buildings outright. Called after every
// crayon override (which re-shows / re-opacities them).
//
// Every layer, not just the fill-extrusions — and that distinction took
// a live bug to learn. The flat `fill` footprints stayed visible, which
// was harmless at street zoom where the 3D city stands on top of them —
// but the vector tiles carry no `building` layer below ~z13, so on
// zoom-out the 3D city simply has nothing to build and the flat paper
// fills surfaced from under it: a city of white cutouts punched through
// the territory field. (The first fix aimed at the buildings' distance
// fog — wrong layer; the 3D city wasn't even there.)
function hideMapLibreBuildings(map: maplibregl.Map): void {
  for (const l of map.getStyle().layers ?? []) {
    if ((l as { 'source-layer'?: string })['source-layer'] === 'building') {
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
  // A top-edge chip has to clear the iOS status bar (clock, signal,
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
  // When the user last dragged the map by hand (0 = never).
  const userPannedAtRef = useRef(0);
  // Stored in state too so React-tree children (markers) can be wired
  // to the map via MapContext when it's ready.
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);
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
  // Supersniff (the logo toggle — see index.tsx).
  // Drives the low chase-camera follow effect + DOGCAM_* constants below.
  const dogCam = useGameStore((s) => s.dogCam);
  // Sniff-and-lead search mode assignment (which lost dog + spot). Set by the
  // search controller below while dogCam is on.
  const searchTarget = useGameStore((s) => s.searchTarget);
  // WHAT THE DOG IS ASKING RIGHT NOW.
  //
  // One state for every decision point in a search, because they are one
  // interaction wearing four hats: confirm a target, leave early, arrive,
  // and find the owner. Null means the dog is just walking.
  const [prompt, setPrompt] = useState<
    | null
    | { kind: 'confirm'; dog: NearbyLostDog }
    | { kind: 'leave'; dog: NearbyLostDog }
    | { kind: 'arrived'; dog: NearbyLostDog }
    | { kind: 'done'; text: string; sourceUrl: string | null }
  >(null);
  // Read inside effects that must not re-run on every render.
  const promptRef = useRef(prompt);
  promptRef.current = prompt;

  // The words the dog is saying right now, if it is asking something.
  // Derived rather than stored so the line always matches the state it
  // came from — a second copy would be one more thing to keep in step.
  const promptText =
    prompt == null
      ? null
      : prompt.kind === 'confirm'
        ? t.search.confirm(prompt.dog.name)
        : prompt.kind === 'leave'
          ? t.search.leaveAsk
          : prompt.kind === 'arrived'
            ? t.search.arrivedAsk(prompt.dog.name)
            : prompt.text;
  const setSearchTarget = useGameStore((s) => s.setSearchTarget);
  const searchRoute = useGameStore((s) => s.searchRoute);
  const setSearchRoute = useGameStore((s) => s.setSearchRoute);
  // Preview: the dog whose zone is being framed (swiped-to, not yet committed).
  const searchPreview = useGameStore((s) => s.searchPreview);
  const setSearchPreview = useGameStore((s) => s.setSearchPreview);
  // Territory: the ground the dog has claimed, plus the one-shot events
  // for "just marked here" / "not in the mood to mark".
  const territoryMarks = useGameStore((s) => s.territoryMarks);
  const territoryShapes = useGameStore((s) => s.territoryShapes);
  const lastMark = useGameStore((s) => s.lastMark);
  const markMood = useGameStore((s) => s.markMood);
  // …and the PvP half: whoever else holds ground within sight, plus the
  // "somebody took your territory, dawg!" notice.
  const rivalTerritory = useGameStore((s) => s.rivalTerritory);
  const rivalMarks = useGameStore((s) => s.rivalMarks);
  const lastRaid = useGameStore((s) => s.lastRaid);
  const onHomeGround = useGameStore((s) => s.onHomeGround);
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

  // Simulated walk (?sim=1) only: nudge the camera back when the dog
  // leaves the frame, so a simulated walker doesn't stroll off-screen
  // while you watch empty map.
  //
  // Three things this has to avoid, all learned the hard way:
  //   - Reacting to `companionPos` (which ticks ~3×/s) restarted the pan
  //     animation faster than it could finish, so the camera never
  //     arrived and every gesture was fought off mid-drag.
  //   - Reading `mapBounds` state was worse than useless: it only
  //     refreshes on the map's `idle` event, and a constantly-restarting
  //     animation means `idle` never fires — so the bounds stayed stale,
  //     "off-screen" stayed true, and the pan loop wedged itself on
  //     forever. Live `map.getBounds()` has no such feedback path.
  //   - Following unconditionally makes panning around impossible. After
  //     any drag the camera stands down for a while so you can look
  //     wherever you like; it only resumes once you've stopped.
  const simWalk = isSimulatedWalk();
  useEffect(() => {
    if (!simWalk) return;
    const CHECK_MS = 3000;
    const AFTER_GESTURE_MS = 12_000;
    const id = setInterval(() => {
      const map = mapRef.current;
      const dog = companionPosRef.current;
      if (!map || !dog) return;
      if (Date.now() - userPannedAtRef.current < AFTER_GESTURE_MS) return;
      try {
        const b = map.getBounds();
        const inView =
          dog.lat <= b.getNorth() &&
          dog.lat >= b.getSouth() &&
          dog.lng <= b.getEast() &&
          dog.lng >= b.getWest();
        if (inView) return;
        map.easeTo({ center: [dog.lng, dog.lat], duration: 600 });
      } catch {
        /* map tearing down */
      }
    }, CHECK_MS);
    return () => clearInterval(id);
  }, [simWalk]);
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
  // A half-answered question does not survive leaving the mode it was
  // asked in, and neither does a fan of expanded pins. The store drops
  // the search itself on a flip; this drops what MapView holds of its
  // own. Skip the first run so mounting doesn't count as a flip.
  const overlayEpoch = useGameStore((s) => s.overlayEpoch);
  const overlayEpochInitRef = useRef(true);
  useEffect(() => {
    if (overlayEpochInitRef.current) {
      overlayEpochInitRef.current = false;
      return;
    }
    setPrompt(null);
    setExpandedSpotKeys((prev) => (prev.size === 0 ? prev : new Set()));
  }, [overlayEpoch]);
  const tokens = useGameStore((s) => s.tokens);
  const foodItems = useGameStore((s) => s.foodItems);
  const lostDogs = useGameStore((s) => s.lostDogs);
  // Whose card belongs on screen: the pet being confirmed, or the pet
  // being walked to. Null means neither, and the deck comes back.
  const focusDog =
    prompt && prompt.kind !== 'done'
      ? prompt.dog
      : searchTarget
        ? (lostDogs.find((d) => d.id === searchTarget.dogId) ?? null)
        : null;
  // How far is left to walk. Route-remaining rather than crow-flies:
  // walking the long way round a block barely moves a straight line,
  // so the readout would sit still while you were plainly making
  // progress. Falls back to the crow line before the route lands.
  const navDistance =
    searchTarget && userPos
      ? formatDistance(
          remainingRouteMeters(searchRoute, userPos) ??
            distanceMeters(userPos, searchTarget.spot),
        )
      : null;
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
  const spotsCategoryFilter = useGameStore((s) => s.spotsCategoryFilter);
  const selectedSpotId = useGameStore((s) => s.selectedSpotId);
  const setSelectedSpot = useGameStore((s) => s.setSelectedSpot);
  const collectToken = useGameStore((s) => s.collectToken);
  const eatFood = useGameStore((s) => s.eatFood);
  const lastCollect = useGameStore((s) => s.lastCollect);
  const setUserPosition = useGameStore((s) => s.setUserPosition);
  const syncMap = useGameStore((s) => s.syncMap);
  const syncPresence = useGameStore((s) => s.syncPresence);
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
  // Readiness, not the position itself — see the note on the deps below.
  // Declared here rather than reusing the `hasPos` further down the file,
  // which is defined 270 lines after these effects need it.
  const questPosReady = !!userPos;
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
    // `hasPos`, not `userPos`. Depending on the position OBJECT would
    // refetch a walking route on every GPS fix — a Directions call per
    // second. Depending on the id alone was the bug: start a quest before
    // GPS resolves, which is the ordinary cold-launch-on-cellular path,
    // and this bails on `!userPos` and never runs again for that quest.
    // No route line, for its whole duration.
  }, [activeQuest?.id, questPosReady]);

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
    // Same fix, plus map readiness: mapRef.current is null until the
    // instance is built, so a quest that starts during map init lost its
    // camera framing entirely. `mapInstance` is the state mirror of that
    // ref and re-runs this once the map exists.
  }, [activeQuest?.id, questPosReady, mapInstance]);

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

  // Dev affordance: `?terrReset=1` wipes YOUR territory once on load, so
  // the mechanic can be re-tested from a clean slate without hunting rows
  // in the database. Ref-guarded so a re-render can't fire it twice, and
  // it only ever touches the caller's own ground.
  //
  // DEV_TOOLS-gated since the beta: it destroys real progress, and a
  // tester who is handed the link has no way to know that before clicking.
  const terrResetRef = useRef(false);
  useEffect(() => {
    if (!DEV_TOOLS) return;
    if (terrResetRef.current) return;
    if (typeof window === 'undefined') return;
    try {
      if (new URLSearchParams(window.location.search).get('terrReset') !== '1') return;
    } catch {
      return;
    }
    terrResetRef.current = true;
    void api
      .resetTerritory()
      .then(() => {
        useGameStore.setState({ territoryMarks: [], territoryShapes: [] });
        showBubble('*починаємо з чистого аркуша* 🐾', 3000);
      })
      .catch(() => {
        /* dev-only convenience — a failure just means nothing was wiped */
      });
  }, [showBubble]);

  // Dev affordance: `?terrRaid=1` sends a bot onto your newest mark, so
  // the raid notice can be checked without waiting for one to wander
  // there. The notice itself still arrives the normal way, on the next
  // sync — this only causes the raid, it doesn't fake it.
  const terrRaidRef = useRef(false);
  useEffect(() => {
    if (!DEV_TOOLS) return;
    if (terrRaidRef.current) return;
    if (typeof window === 'undefined') return;
    try {
      if (new URLSearchParams(window.location.search).get('terrRaid') !== '1') return;
    } catch {
      return;
    }
    terrRaidRef.current = true;
    void api.raidTest().catch(() => {
      /* dev-only convenience — nothing to hold means nothing to raid */
    });
  }, []);


  // Mode-relevant bark on EVERY supersniff toggle. Exit: "back to walks"
  // lines. Entry: the FIRST entry per session is announced by the swipe/tap
  // intro hint (Companion) so we stay quiet then; every later entry gets a
  // short "nose is on" line — without it, repeat entries either said nothing
  // or (on a quick off→on) left the stale exit line up, so the bubble read
  // as the wrong mode. A pre-committed entry (modal's "start search" flips
  // the mode with a target already set) announces itself with the by-name
  // lead bark, so the generic line stands down. Init-guarded so no line
  // fires on the first mount.
  const dogCamBubbleInitRef = useRef(true);
  const dogCamEnteredOnceRef = useRef(false);
  useEffect(() => {
    if (dogCamBubbleInitRef.current) {
      dogCamBubbleInitRef.current = false;
      return;
    }
    if (dogCam) {
      const firstEntry = !dogCamEnteredOnceRef.current;
      dogCamEnteredOnceRef.current = true;
      if (firstEntry) return; // intro hint owns the bubble
      if (useGameStore.getState().searchTarget) return; // lead bark owns it
      const lines = t.bubbles.supersniffOn;
      showBubble(lines[Math.floor(Math.random() * lines.length)]!, 3500);
    } else {
      const lines = t.bubbles.backToWalks;
      showBubble(lines[Math.floor(Math.random() * lines.length)]!, 3500);
    }
  }, [dogCam, showBubble, t]);

  // Territory: the dog announces its own claims. Seq-keyed (the store
  // bumps it once per server-confirmed mark) and init-guarded so a
  // mark that happened before this mount doesn't replay on focus.
  const markSeqRef = useRef(lastMark?.seq ?? 0);
  useEffect(() => {
    if (!lastMark || lastMark.seq === markSeqRef.current) return;
    markSeqRef.current = lastMark.seq;
    // Most specific outcome wins. Taking a rival's mark outright is the
    // loudest thing that can happen on a walk, then merely contesting one,
    // then closing a ring, then renewing ground we already held — and a
    // plain new mark is the fallback.
    const lines = lastMark.captured
      ? t.bubbles.captured
      : lastMark.stolen > 0
        ? t.bubbles.contested
        : lastMark.enclosed
          ? t.bubbles.enclosed
          : lastMark.renewed
            ? t.bubbles.renewed
            : t.bubbles.marked;
    showBubble(lines[Math.floor(Math.random() * lines.length)]!, 3600);
  }, [lastMark, showBubble, t]);

  // Somebody marked over our ground while we were elsewhere. Seq-keyed
  // like the rest, and init-guarded so a raid delivered on the very first
  // sync after a cold start doesn't fire before the map has settled.
  const raidSeqRef = useRef(lastRaid?.seq ?? 0);
  useEffect(() => {
    if (!lastRaid || lastRaid.seq === raidSeqRef.current) return;
    raidSeqRef.current = lastRaid.seq;
    // Actually losing a mark is a different feeling from someone just
    // sniffing at the edge — the dog should sound like it.
    const lines = lastRaid.killed ? t.bubbles.raidedLost : t.bubbles.raided;
    const line = lines[Math.floor(Math.random() * lines.length)]!;
    showBubble(line.replace('{name}', lastRaid.raiderName), 4200);
  }, [lastRaid, showBubble, t]);

  // Stepping ONTO home ground — where paws are denser and the dog's
  // happiness drains slower. Both perks are passive and server-side; this
  // line is the only thing that tells you they're on. Fires on the
  // transition only (never on the initial value, or every walk would open
  // with it), and no line for leaving: the map going back to normal is
  // its own signal, and a goodbye every time you cross an edge is nagging.
  const homeRef = useRef<boolean | null>(null);
  useEffect(() => {
    const was = homeRef.current;
    homeRef.current = onHomeGround;
    if (was !== false || !onHomeGround) return;
    const lines = t.bubbles.homeGround;
    showBubble(lines[Math.floor(Math.random() * lines.length)]!, 3400);
  }, [onHomeGround, showBubble, t]);

  // …and grumbles when it's too hungry or too glum to bother. Rate-
  // limited hard: the server reports the mood on every sync it would
  // otherwise have marked, so without this the dog would whine every
  // 15 s all the way through a walk.
  const moodSeqRef = useRef(markMood?.seq ?? 0);
  const lastMoodBubbleRef = useRef(0);
  useEffect(() => {
    if (!markMood || markMood.seq === moodSeqRef.current) return;
    moodSeqRef.current = markMood.seq;
    const MOOD_BUBBLE_GAP_MS = 5 * 60 * 1000;
    if (Date.now() - lastMoodBubbleRef.current < MOOD_BUBBLE_GAP_MS) return;
    lastMoodBubbleRef.current = Date.now();
    const lines =
      markMood.reason === 'hungry'
        ? t.bubbles.tooHungryToMark
        : markMood.reason === 'own-ground'
          ? t.bubbles.alreadyOursHere
          : t.bubbles.tooGlumToMark;
    showBubble(lines[Math.floor(Math.random() * lines.length)]!, 3500);
  }, [markMood, showBubble, t]);

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
  //
  // Driven by a timer and by DISTANCE WALKED — never by userPos itself.
  // Listing userPos.lat/lng in the deps meant a new GPS fix tore the
  // effect down and rebuilt it: the 15s interval was cleared before it
  // could ever fire, and the immediate sync at the top ran on every fix
  // instead. Position arrives once a second (watchPosition, and exactly
  // SIM_TICK_MS in sim), so the app was calling /sync/map and
  // /collect/path at 1Hz — fifteen times the intended rate, each round
  // trip taking longer than the gap between them, so several were always
  // in flight at once and the last one to land won regardless of which
  // was newest. Other dogs' positions went backwards as often as
  // forwards, which is why they stopped animating: OtherWalker glides
  // toward its target and sits when it gets there, and a target that
  // keeps being reset to an older fix never ends up more than half a
  // metre away.
  const hasPos = !!userPos;
  useEffect(() => {
    if (!hasPos || !isFocused) return;
    let lastAt = 0;
    let lastPos: { lat: number; lng: number } | null = null;

    const run = () => {
      // A phone in a pocket with the screen off is not a walker looking at
      // a map. This loop is the single most expensive thing the app does
      // — measured at ~54 KB a call against a production-shaped database —
      // and it used to keep running for as long as the tab existed.
      //
      // Note this guards the SYNC only. Position tracking and the local
      // game loop are untouched, so a walk in a pocket still accumulates
      // distance and still sweeps paws when the screen comes back on.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const pos = useGameStore.getState().userPosition;
      if (!pos) return;
      lastAt = Date.now();
      lastPos = pos;
      void collectPath(pos, companionPosRef.current);
      void syncMap(pos);
    };

    run();
    // Waking the tab syncs immediately rather than showing whatever the
    // map looked like when it was backgrounded until the next tick.
    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'hidden') run();
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    // syncSpots is driven separately by the viewport-watcher effect
    // below so the dog finds places where the human is LOOKING, not
    // just where they're standing.
    //
    // The floor: someone standing still still gets fresh tokens and
    // neighbours. The watcher on top of it is what keeps a fast walker
    // current without a request per fix — it needs BOTH real distance
    // and a minimum gap, so a sprint syncs about every four seconds and
    // a stroll simply falls through to the floor.
    const floor = setInterval(run, TOKEN_REFRESH_MS);
    const watcher = setInterval(() => {
      const pos = useGameStore.getState().userPosition;
      if (!pos || !lastPos) return;
      if (Date.now() - lastAt < SYNC_MIN_GAP_MS) return;
      if (distanceMeters(lastPos, pos) < SYNC_MOVE_M) return;
      run();
    }, 1000);
    return () => {
      clearInterval(floor);
      clearInterval(watcher);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisible);
      }
    };
  }, [hasPos, isFocused, collectPath, syncMap]);

  // Other dogs, on their own much faster loop.
  //
  // Positions are 6% of a sync payload and change every few seconds; the
  // territory in the other 94% changes every few minutes and costs most of
  // the sync to compute. Polling the whole thing at this rate to make the
  // dogs smoother would refresh polygons that had not moved, for ~80MB an
  // hour of mobile data. This trip is one Redis read and about 4KB.
  //
  // PRESENCE_MS is not arbitrary: bots step on a 3.5s server tick and real
  // GPS lands about once a second, so below ~3s there is simply nothing
  // newer to fetch.
  useEffect(() => {
    if (!hasPos || !isFocused || !MULTIPLAYER) return;
    const tick = () => {
      const pos = useGameStore.getState().userPosition;
      if (pos) void syncPresence(pos);
    };
    const id = setInterval(tick, PRESENCE_MS);
    return () => clearInterval(id);
  }, [hasPos, isFocused, syncPresence]);

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
  // The dog's clear-orb (threeBuildingsLayer) tracks companionPos, but the dog
  // is a DOM marker — moving it doesn't repaint the WebGL canvas. Nudge a
  // repaint when it moves so the orb follows (cheap: only fires on roam ticks,
  // and dog-cam already repaints itself). Game render only.
  useEffect(() => {
    if (!GAME_RENDER || !onMapScreen) return;
    try {
      mapRef.current?.triggerRepaint();
    } catch {
      /* map tearing down */
    }
  }, [companionPos, onMapScreen]);
  // Current user position in a ref for interval callbacks (search nudges).
  const userPosRef = useRef(userPos);
  userPosRef.current = userPos;
  // Same for the lost-dogs list, so the nudge interval can resolve the active
  // search target's name without re-subscribing the effect on every list churn.
  const lostDogsRef = useRef(lostDogs);
  lostDogsRef.current = lostDogs;
  // Latches true when the user hand-rotates the dog-cam, so the follow loop stops
  // driving the bearing (lets them look around). A ref — not effect-local — so
  // each new preview/commit can RESET it, re-orienting toward the new target
  // instead of staying stuck at the old hand-set angle.
  const userTookBearingRef = useRef(false);

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
    // The dog rides at true centre (see the framing comment on the constants
    // above), so the mode needs NO camera padding of its own — but the
    // pet/spot modal snap eases `padding` onto the transform and MapLibre
    // keeps it across calls, so an entry taken right out of the modal
    // ("start search") could inherit that framing. Zero it once on entry so
    // the mode always starts from a known camera base.
    try {
      map.setPadding({ top: 0, right: 0, bottom: 0, left: 0 });
    } catch {
      /* style not ready */
    }
    // Fresh entry → auto-orient again (don't inherit a hand-set angle from a
    // previous session).
    userTookBearingRef.current = false;
    let heading = map.getBearing();
    let lastDog: LatLng | null = null;
    // Timestamp of the last hand-driven rotate; the loop skips while this is
    // fresh so it never fights the live gesture.
    let lastUserRotateAt = 0;
    // originalEvent is present only for user-driven rotation, not our easeTo.
    const onUserRotate = (e: { originalEvent?: unknown }) => {
      if (!e || !e.originalEvent) return;
      userTookBearingRef.current = true;
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
        if (!userTookBearingRef.current) heading = bearingDeg(lastDog, dog);
        moved = true;
      }
      lastDog = dog;
      if (preview) {
        const toSpot = bearingDeg(dog, preview.spot);
        map.easeTo({
          center: [dog.lng, dog.lat],
          pitch: PREVIEW_PITCH,
          zoom: previewZoomFor(distanceMeters(dog, preview.spot)),
          ...(userTookBearingRef.current ? {} : { bearing: toSpot }),
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
        if (!userTookBearingRef.current) {
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
        map.easeTo({
          bearing: 0,
          pitch: GAME_PITCH,
          zoom: balance.mapZoomDefault,
          duration: 500,
        });
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
      userTookBearingRef.current = false; // re-orient down the new route
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
      // Live store read (not the render closure): the modal's "start search"
      // flips the mode and commits in the same tick, before this component
      // re-renders with dogCam=true.
      const map = mapRef.current;
      if (DOG_CAM && useGameStore.getState().dogCam && map) {
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
    [setSearchPreview, setSearchTarget, setSearchRoute, spotInZone, userPos, showBubble],
  );

  // Closing a search — the same call whether you arrived or gave up, and
  // whether or not you saw anything. The server decides what it is worth;
  // the client only reports what happened.
  const finishSearch = useCallback(
    async (dog: NearbyLostDog, seen: boolean) => {
      setSearchTarget(null);
      setSearchRoute(null);
      let paws = 0;
      let sourceUrl: string | null = null;
      try {
        const res = await api.finishSearch(dog.id, seen, userPosRef.current);
        paws = res.paws;
        sourceUrl = res.sourceUrl;
      } catch {
        // Offline or the server said no. The search still ends — stranding
        // someone in a quest because a request failed is the worse outcome
        // — they just do not get told a number.
      }
      if (seen) useGameStore.getState().tickDailyTask('sightings');
      // THE PAYOUT, ONE PAW AT A TIME.
      //
      // The counter could just jump by twenty, and it would be worth
      // exactly as much and feel like nothing. Firing the same pickup
      // pulse the map uses, staggered, spends those twenty paws across a
      // second and a half — so the reward arrives as a run of pickups
      // rather than a number changing.
      if (paws > 0) useGameStore.getState().awardPaws(paws);
      setPrompt({
        kind: 'done',
        text: seen ? t.search.thanksSeen(paws) : t.search.thanksMissed(paws),
        // Only offered when the pet came from a post that still exists.
        sourceUrl: seen ? sourceUrl : null,
      });
    },
    [setSearchTarget, setSearchRoute, t],
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
      userTookBearingRef.current = false; // re-orient toward the new fragment
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
      // No per-swipe bubble — the one-time "supersniff on! swipe / tap" intro
      // hint (Companion) now teaches the interaction instead.
    },
    [setSearchPreview, spotInZone, dogCam],
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
    // Ask ONCE. This effect re-runs on every GPS tick, and the target
    // stays set until the question is answered, so without this the
    // prompt object is rebuilt every few seconds for as long as you stand
    // there deciding.
    if (promptRef.current) return;
    const dog = lostDogs.find((d) => d.id === searchTarget.dogId);
    // Arriving used to bark "found the spot" and silently deal you the next
    // pet, which threw away the only thing the walk was for: you were just
    // there, and nobody asked you what you saw. Now the dog asks, and the
    // search stays open until you answer.
    if (dog) setPrompt({ kind: 'arrived', dog });
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
  // lands framed even if the dog had wandered off-centre. Dead centre —
  // the bubble has plenty of room above the nose there, and a lowered
  // dog framing leaking into a mode switch (e.g. tapping the pulsing
  // logo into supersniff mid-hint) used to leave the dog sitting on the
  // carousel. The bubble (anchored to the companion marker) glides in
  // with the ease.
  //
  // NOT in supersniff (dogCam): the follow loop owns the camera there. The
  // supersniff intro hint id also starts with "map:", so without this guard
  // its fire would snap the camera with a conflicting framing mid-follow.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !companionPos) return;
    if (DOG_CAM && dogCam) return;
    // The supersniff-exit hint lives INSIDE dogCam; on mode exit its id can
    // outlive dogCam by one commit and would cancel the exit camera ease
    // mid-flight (freezing pitch/zoom partway). It never needs a snap.
    if (activeHint === 'map:supersniff-exit') return;
    if (activeHint && activeHint.startsWith('map:')) {
      map.easeTo({
        center: [companionPos.lng, companionPos.lat],
        duration: 400,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeHint, dogCam]);

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
    // Only the closest few, so the map doesn't clutter.
    const radius = NORMAL_LOSTDOG_RADIUS_M;
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
  }, [lostDogs, userLatBucket, userLngBucket, selectedDogId]);
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

  // Fly to a territory — tapping a row on the standing routes here with
  // the owner's largest piece in the store, and the camera frames it.
  // ONE-SHOT: consumed and cleared, deliberately unlike selectedSpotId.
  // A selection has to be defended from every clear-list and sync in
  // the app; a command is executed and gone, and tapping the same row
  // again later simply issues a new one.
  const focusedTerritory = useGameStore((s) => s.focusedTerritory);
  const setFocusedTerritory = useGameStore((s) => s.setFocusedTerritory);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusedTerritory) return;
    const ring = focusedTerritory.ring;
    if (ring.length >= 3) {
      // Down INTO the territory, not a survey of it — and onto the DOG,
      // freshest source first. The nearby-players list refreshes every
      // 15s and holds the live sprite position when the owner is inside
      // presence range — landing anywhere else visibly disagrees with
      // the sprite on screen. Next, the live presence position the board
      // fetched (right for far owners who are online); then the owner's
      // last mark (minutes stale — the dog kept walking); and only then
      // the ground's geometric middle.
      const live = useGameStore
        .getState()
        .nearbyPlayers.find((p) => p.id === focusedTerritory.ownerId)?.position;
      let target = live ?? focusedTerritory.pos ?? focusedTerritory.mark ?? null;
      if (!target) {
        let clat = 0;
        let clng = 0;
        for (const p of ring) {
          clat += p.lat;
          clng += p.lng;
        }
        target = { lat: clat / ring.length, lng: clng / ring.length };
      }
      // No marker at the landing spot. A scent ping lived here briefly,
      // from the days when the jump aimed at a minutes-stale mark and
      // needed something to point at — now the camera lands on the dog's
      // live position (or its freshest trail), and a dropped dot next to
      // the actual sprite just read as a second, wrong dog.
      map.easeTo({ center: [target.lng, target.lat], zoom: 16, duration: 900 });
    }
    setFocusedTerritory(null);
  }, [focusedTerritory, setFocusedTerritory]);

  // Cinematic dog view — tapping a pet (on the map OR via the quests-tab
  // jump, which routes here with the dog already selected) pulls the
  // camera back and tilts it to frame the pet's WHOLE search zone above
  // the bottom info card. Zoom is computed so the zone circle spans
  // ~DOG_VIEW_ZONE_FRAC of the visible strip; the zone centre (raw
  // last-seen coord) is the frame centre — the jittered pin lies inside
  // the zone by construction, so it's always in shot.
  //
  // The ref gate matters: lostDogs is in the effect deps (we need it
  // to look up the pet once the deep-link / quests-jump merges it in),
  // but it also refreshes on every 15 s syncMap tick. Without the gate
  // the camera would re-frame the zone every 15 s while the card is
  // open, fighting the user's panning. So we only tween when the
  // *selection* changes, not when the underlying list does.
  const lastSnappedDogRef = useRef<string | null>(null);
  // True once the cinematic ease ran — gates the fly-back on close so an
  // unrelated mount/cleanup doesn't yank the camera.
  const dogViewActiveRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!selectedDogId) {
      lastSnappedDogRef.current = null;
      // Only reset the camera when no spot is driving it — otherwise
      // closing a dog card would clobber an active spot snap. (In
      // practice only one is ever open, but the guard keeps the two
      // effects from racing.)
      if (!selectedSpotId) {
        map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
        // Fly back down to the street-level game view — unless supersniff
        // took over (its follow loop owns the camera; "start search"
        // closes the card INTO that mode).
        if (dogViewActiveRef.current && !(DOG_CAM && useGameStore.getState().dogCam)) {
          const anchor = companionPosRef.current ?? userPosRef.current;
          try {
            map.easeTo({
              ...(anchor ? { center: [anchor.lng, anchor.lat] } : {}),
              zoom: balance.mapZoomDefault,
              pitch: GAME_PITCH,
              duration: 800,
            });
          } catch {
            /* map tearing down */
          }
        }
      }
      dogViewActiveRef.current = false;
      return;
    }
    if (selectedDogId === lastSnappedDogRef.current) return;
    const dog = lostDogs.find((d) => d.id === selectedDogId);
    if (!dog) return; // not merged in yet — retry when lostDogs updates
    lastSnappedDogRef.current = selectedDogId;
    dogViewActiveRef.current = true;
    // Frame the PIN (its zone-jittered display point — where the big
    // photo pin actually renders) directly under the top-anchored story
    // bubble, horizontally centred.
    const pin = displayPositions.get(selectedDogId) ?? dog.lastSeen.position;
    const container = map.getContainer?.();
    const h = container?.clientHeight ?? 700;
    map.easeTo({
      center: [pin.lng, pin.lat],
      zoom: DOG_VIEW_ZOOM,
      pitch: DOG_VIEW_PITCH,
      // Zero out any padding a prior spot/modal snap left so the offset
      // below is measured from the true viewport centre.
      padding: { top: 0, bottom: 0, left: 0, right: 0 },
      // Land the pin's foot DOG_VIEW_PIN_TOP_PX below the safe-area
      // inset — right under the story-bubble stack (positive y = down
      // from centre; negative on very tall viewports is fine, the pin
      // just rides above centre, still glued to the stack).
      offset: [0, Math.round(safeAreaTopPx() + DOG_VIEW_PIN_TOP_PX - h / 2)],
      // Slow enough to read as a camera move, not a snap.
      duration: 950,
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
          // See GAME_PITCH for why it is what it is. Users can still tilt
          // all the way to maxPitch 80 — and MapLibre's own default cap is
          // 60, so it has to be raised for that to be possible.
          pitch: GAME_PITCH,
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
          applyCrayonOverride(map, LIGHT_PALETTE, lang);
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
                map.addLayer(
                  createThreeBuildingsLayer(() => companionPosRef.current),
                  beforeId,
                );
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
        // Hand-driven pans. Only used by the simulated-walk follow camera,
        // which stands down for a while after you touch the map so you can
        // look around without being dragged back to the dog.
        map.on('dragstart', () => {
          userPannedAtRef.current = Date.now();
        });
        map.on('dragend', () => {
          userPannedAtRef.current = Date.now();
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
        setMapInstance(map);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[map init failed]', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userPos]);

  // Map destruction — runs only on unmount, NOT on every effect re-run.
  useEffect(() => {
    return () => {
      const m = mapRef.current;
      if (m) {
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
      applyCrayonOverride(map, LIGHT_PALETTE, lang);
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
  }, [lang, syncStreetLabels]);

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
      {/* The paper-tooth speckle overlay lived here — a multiply-blended
          grain tiled over the whole map, position-synced to the
          geography. Retired: under the territory field's own multiply
          stain the two grains compounded, and the map read as dusty
          rather than textured. Plain paper it is. */}
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
            // to centre when the hint fires) so holding ON the cue
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
            between the ~15s presence updates so they read as people walking.
            Hidden in supersniff so the whole focus is the dog search. */}
        {DOG_CAM && dogCam
          ? null
          : otherWalkers.map((p) => <OtherWalker key={p.id} player={p} />)}

        {/* No zone RING in the cinematic dog view — at the close zoom the
            circle cut across mid-screen and read as clutter. The blue
            beacon fog (threeBuildingsLayer, centred on the pin) marks the
            search area on its own. */}

        {/* Lost-dog pins are hidden in dog-cam/search mode — the carousel +
            the previewed zone (with its blue beacon) are the focus there, and
            the photo pins just clutter the immersive shot. They also hide
            while the cinematic dog view is open (a pet selected): only the
            selected pet's BIG pin shows (below), so the framed zone isn't
            cluttered by neighbours. */}
        {(!LOST_DOG_PINS || (DOG_CAM && dogCam) || selectedDogId ? [] : clusters).flatMap((c) => {
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

        {/* Cinematic dog view: the selected pet renders alone as the BIG
            photo pin — every other pin/cluster is hidden above. Rendered
            from `lostDogs` (not the render-radius-gated visible list) so a
            deep-linked far pet still gets its pin. Tap dismisses, same as
            tapping outside the card. */}
        {!(DOG_CAM && dogCam) && selectedDogId
          ? lostDogs
              .filter((d) => d.id === selectedDogId)
              .map((d) => (
                <LostDogMarker
                  key={`selected-${d.id}`}
                  position={displayPositions.get(d.id) ?? d.lastSeen.position}
                  emoji={d.emoji}
                  name={d.name}
                  urgency={d.urgency}
                  photoUrl={d.photoUrl}
                  onTap={() => setSelectedDog(null)}
                  active
                  selected
                  />
              ))
          : null}

        {avoidedTokens.map((t) => (
          <TokenMarker
            key={t.id}
            position={t.position}
            onTap={tokenTapHandlers.get(t.id)!}
          />
        ))}

        {avoidedFood.map((f) => (
          <FoodMarker
            key={f.id}
            position={f.position}
            onTap={foodTapHandlers.get(f.id)!}
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

        {/* Hidden — not cancelled — in supersniff. A detective quest is
            a server-tracked commitment, so tapping the logo must not
            throw it away; it just steps out of the way of the search
            and is still running when you come back. */}
        {activeQuest && !(DOG_CAM && dogCam) ? (
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

        {/* Your dog's scent on the city — a soft wash over the ground it
            has claimed.

            Off in the two views that are ABOUT a specific place rather
            than about the city: supersniff, and the lost-dog view. Both
            put a blue beacon on the ground to say "here", and a city
            carved into a dozen owner colours underneath it turns that
            into one more patch among many. The claims are the subject on
            the ordinary map and noise on top of a search — same paint,
            different job. See threeBuildingsLayer.territoryPaintHidden,
            which mutes the blocks for the same reason. */}
        {!(DOG_CAM && dogCam) && !selectedDogId && onMapScreen ? (
          <TerritoryLayer
            shapes={territoryShapes}
            marks={territoryMarks}
            rivals={rivalTerritory}
            rivalMarks={rivalMarks}
          />
        ) : null}

        {companionPos ? (
          <Companion
            position={companionPos}
            // A question the dog is asking comes out of the DOG, in the
            // same bubble as everything else it says, and stays up until
            // it is answered. The buttons live down in the thumb zone;
            // only the words belong up here.
            bubble={promptText ?? bubble}
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

      {/* THE PET, ALWAYS. Whichever pet is in question — the one being
          confirmed, or the one being walked to — its card sits in the
          slot the carousel used to occupy. What went away is the pets
          on either SIDE of it: a deck to swipe through is an invitation
          to abandon the one you are on, and it covered the map.

          LostDogCardView is width/height 100%, so it has to be given a
          box. Rendered bare it collapses to nothing, which is exactly
          what it did — the card was there the whole time with no size. */}
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
          {focusDog && !(prompt?.kind === 'confirm' && !searchTarget) ? (
            <View style={{ width: 288, height: 252, marginBottom: 30 }} pointerEvents="none">
              {/* No `active` glow here. That pulsing blue ring exists to
                  pick THIS pet out of a deck of others — and there is no
                  deck any more, just the one card. Marking the only
                  thing on screen as the chosen one is noise, and the
                  ring read as a border around the photo. */}
              <LostDogCardView
                dog={focusDog}
                t={t}
                userPos={userPos}
                strongShadow
                chips={false}
              />
            </View>
          ) : (
            // The deck STAYS MOUNTED through the confirm prompt — tapping
            // a card focuses it in place (it grows and lifts, its
            // neighbours slide off) instead of the old swap to a lone
            // static card, which read as a blink. Cancel rewinds the same
            // motion and the deck is simply back.
            <LostDogCardStack
              dogs={searchDogs}
              onTap={(dog) => setPrompt({ kind: 'confirm', dog })}
              onSwipe={previewSearch}
              showCounter={false}
              cardWidth={288}
              cardHeight={252}
              strongShadow
              focused={prompt?.kind === 'confirm' && !searchTarget}
            />
          )}
        </View>
      ) : null}

      {/* THE ANSWERS SIT IN THE TOP HUD, on the corner logo's line —
          the exact slot the nav HUD's distance-and-exit row occupies
          during a running search, and the nav HUD hides while a prompt
          is up, so the two never collide. The dog's words still come
          out of the dog; the buttons stand where every glanceable
          control in supersniff already lives. They floated mid-screen
          once (covered the card) and at the bottom once (covered the
          card's ground and fought the deck) — the logo line is the one
          strip of this mode that is always clear. */}
      {DOG_CAM && dogCam && onMapScreen && prompt ? (
        <View
          style={
            {
              position: 'absolute',
              // Clear of the corner logo; answers hug the right edge,
              // balancing it.
              left: 84,
              right: S.m,
              top: 'calc(env(safe-area-inset-top, 0px) + 25px)',
              alignItems: 'flex-end',
              zIndex: Z.HUD_CHIPS + 1,
            } as unknown as object
          }
          pointerEvents="box-none"
        >
          <DogPrompt
            actions={
              prompt.kind === 'confirm'
                ? [
                    { label: t.search.confirmBack, onPress: () => setPrompt(null) },
                    {
                      label: t.search.confirmGo,
                      primary: true,
                      onPress: () => {
                        const d = prompt.dog;
                        setPrompt(null);
                        assignSearch(d);
                      },
                    },
                  ]
                : prompt.kind === 'leave' || prompt.kind === 'arrived'
                  ? [
                      {
                        label: t.search.no,
                        onPress: () => {
                          const d = prompt.dog;
                          // Leaving early with nothing seen pays nothing:
                          // the walk was not finished, so there is no
                          // walked zone to report. Arriving and seeing
                          // nobody IS a result, and does pay.
                          if (prompt.kind === 'leave') {
                            setSearchTarget(null);
                            setSearchRoute(null);
                            setPrompt(null);
                          } else {
                            void finishSearch(d, false);
                          }
                        },
                      },
                      {
                        label: t.search.yes,
                        primary: true,
                        onPress: () => void finishSearch(prompt.dog, true),
                      },
                    ]
                  : [
                      ...(prompt.sourceUrl
                        ? [
                            {
                              label: t.search.contactOpen,
                              primary: true,
                              onPress: () => {
                                window.open(prompt.sourceUrl!, '_blank', 'noopener');
                                setPrompt(null);
                              },
                            },
                          ]
                        : []),
                      {
                        label: prompt.sourceUrl ? t.search.contactLater : t.search.close,
                        onPress: () => setPrompt(null),
                      },
                    ]
            }
          />
        </View>
      ) : null}

      {/* NAV HUD. A running search is turn-by-turn navigation wearing a
          dog, so it borrows the shape every maps app has trained people
          on: how far is left, up top and centred; the way out in the
          top-right corner. Both were on the card before — the distance
          competing with the pet's face for the same 288px, the ✕ sitting
          on top of it — which read as decoration on a photo rather than
          as a HUD you glance at while walking.

          Only while a search IS running. During a question the buttons
          under the dog are the way out, and there is nothing to walk to
          yet. Offset from the safe-area inset so it clears the notch and
          sits on the corner logo's line. */}
      {DOG_CAM && dogCam && onMapScreen && searchTarget && !prompt ? (
        <div
          style={{
            position: 'absolute',
            // Lands the row's midline on the corner logo's, so the
            // three read as one HUD line rather than three floaters:
            // the HUD's own paddingTop (S.xxl) + half the 59px logo,
            // less half this row's ~40px height.
            top: 'calc(env(safe-area-inset-top, 0px) + 34px)',
            left: S.m,
            right: S.m,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: Z.HUD_PILLS_OVERLAY,
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              padding: '10px 18px',
              background: '#ffffff',
              color: '#1a1a1a',
              borderRadius: R.pill,
              fontFamily: SYSTEM_FONT,
              fontSize: TYPE.body,
              fontWeight: 800,
              letterSpacing: 0.3,
              boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
            }}
          >
            {navDistance ?? '…'}
          </div>
          <div
            role="button"
            aria-label={t.search.close}
            onClick={() => {
              const d = lostDogs.find((x) => x.id === searchTarget.dogId);
              if (d) setPrompt({ kind: 'leave', dog: d });
              else {
                setSearchTarget(null);
                setSearchRoute(null);
              }
            }}
            style={{
              position: 'absolute',
              right: 0,
              pointerEvents: 'auto',
              cursor: 'pointer',
              width: 44,
              height: 44,
              borderRadius: R.pill,
              background: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: SYSTEM_FONT,
              fontSize: 20,
              fontWeight: 700,
              color: '#1a1a1a',
              boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
            }}
          >
            ✕
          </div>
        </div>
      ) : null}

      {/* Cancel pills — small floating chips that drop in below the
          HUD when a route or quest is active. Stacked vertically so
          both can show at once (rare but valid: a walk + a separate
          quest). Tapping a pill clears the corresponding state. */}
      {(walkRoute || activeQuest) && !(DOG_CAM && dogCam) ? (
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
              // Dark chip + inverted white logo, which pops against
              // the pastel map. Matches the corner logo's recipe.
              background: '#1a1a1a',
              borderRadius: R.pill,
              width: 56,
              height: 56,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 14px rgba(0,0,0,0.22)',
              border: '2px solid rgba(255,255,255,0.08)',
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
              filter: 'invert(1)',
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

      {/* Bubble keyframes for the HUD pills (StatusBar / QuestPill),
          which bubble out on entering supersniff and back in on
          leaving. Defined here rather than beside them because this is
          the one component always mounted on the map screen. */}
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
        searchActive={
          // Already on this dog's trail — supersniff lead, or a legacy
          // chat-started quest. Either way the CTA flips to "searching…".
          searchTarget?.dogId === selectedDogId ||
          (!!activeQuest && activeQuest.dogId === selectedDogId)
        }
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
        onStartSearch={(d) => {
          // The generated 4-step quest is retired here for now (chat can
          // still start one) — "start search" drops you straight into
          // supersniff locked on this dog: mode on, its card front-and-
          // centre in the carousel, the dog leading immediately.
          setSelectedDog(null);
          if (!useGameStore.getState().dogCam) {
            useGameStore.getState().toggleDogCam();
            // Arrived without touching the logo — lets the Companion
            // show the "tap the logo to get back to walks" hint.
            useGameStore.getState().setDogCamViaSearch(true);
          }
          assignSearch(d);
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
