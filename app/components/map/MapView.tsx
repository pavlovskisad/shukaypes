import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GoogleMap, PolylineF, useJsApiLoader } from '@react-google-maps/api';
import { View, Text, StyleSheet } from 'react-native';
import type { UrgencyLevel } from '@shukajpes/shared';
import { env } from '../../constants/env';
import { colors } from '../../constants/colors';
import { balance } from '../../constants/balance';
import { greyscaleMapStyle } from '../../constants/mapStyle';
import { useGameStore } from '../../stores/gameStore';
import { useLocation } from '../../hooks/useLocation';
import { useCompanion } from '../../hooks/useCompanion';
import { useGameLoop } from '../../hooks/useGameLoop';
import { distanceMeters } from '../../utils/geo';
import { Companion } from './Companion';
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
import { WaypointMarker } from './WaypointMarker';
import { clusterByDistance, jitterInRadius } from '../../utils/cluster';
import type { LatLng } from '@shukajpes/shared';

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

  const companionPos = useCompanion(userPos);
  const tokens = useGameStore((s) => s.tokens);
  const foodItems = useGameStore((s) => s.foodItems);
  const lostDogs = useGameStore((s) => s.lostDogs);
  const selectedDogId = useGameStore((s) => s.selectedDogId);
  const spots = useGameStore((s) => s.spots);
  const spotsVisible = useGameStore((s) => s.spotsVisible);
  const selectedSpotId = useGameStore((s) => s.selectedSpotId);
  const setSelectedSpot = useGameStore((s) => s.setSelectedSpot);
  const collectToken = useGameStore((s) => s.collectToken);
  const eatFood = useGameStore((s) => s.eatFood);
  const setUserPosition = useGameStore((s) => s.setUserPosition);
  const syncTokens = useGameStore((s) => s.syncTokens);
  const syncFood = useGameStore((s) => s.syncFood);
  const syncLostDogs = useGameStore((s) => s.syncLostDogs);
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

  useEffect(() => {
    if (userPos) setUserPosition(userPos);
  }, [userPos?.lat, userPos?.lng, setUserPosition]);

  // Fetch server state tied to position: spawned tokens + food + nearby lost
  // dogs. All three refresh on the same interval.
  useEffect(() => {
    if (!userPos) return;
    syncTokens(userPos);
    syncFood(userPos);
    syncLostDogs(userPos);
    const id = setInterval(() => {
      const pos = useGameStore.getState().userPosition;
      if (!pos) return;
      syncTokens(pos);
      syncFood(pos);
      syncLostDogs(pos);
    }, TOKEN_REFRESH_MS);
    return () => clearInterval(id);
  }, [userPos?.lat, userPos?.lng, syncTokens, syncFood, syncLostDogs]);

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
        showBubble(narration ?? `found something! quest complete 🎉`, 4000);
      } else if (advanced) {
        showBubble(narration ?? `paw print here — let's keep going 🐾`, 3000);
      }
    }, balance.roamTick);
    return () => clearInterval(id);
  }, [activeQuest?.id, activeQuest?.currentWaypoint, advanceQuestIfNear, showBubble]);

  // Auto-collect tokens. Uses min(user, companion) distance — the
  // companion orbits the walker at ~110m, so paws right at the user's
  // feet would otherwise sit just outside the companion's 90m disk
  // (donut-of-detection bug). Either being in range is enough.
  useEffect(() => {
    const id = setInterval(() => {
      const { tokens: ts, userPosition: u } = useGameStore.getState();
      if (!u && !companionPos) return;
      ts.forEach((t) => {
        if (t.collectedAt) return;
        const dCompanion = companionPos ? distanceMeters(companionPos, t.position) : Infinity;
        const dUser = u ? distanceMeters(u, t.position) : Infinity;
        if (Math.min(dCompanion, dUser) < balance.autoCollectToken) {
          collectToken(t.id);
        }
      });
    }, balance.roamTick);
    return () => clearInterval(id);
  }, [companionPos?.lat, companionPos?.lng, collectToken]);

  // Auto-eat food. Same min(user, companion) trick as paws.
  useEffect(() => {
    const id = setInterval(() => {
      const { foodItems: fs, userPosition: u } = useGameStore.getState();
      if (!u && !companionPos) return;
      fs.forEach((f) => {
        const dCompanion = companionPos ? distanceMeters(companionPos, f.position) : Infinity;
        const dUser = u ? distanceMeters(u, f.position) : Infinity;
        if (Math.min(dCompanion, dUser) < balance.autoCollectFood) {
          eatFood(f.id);
        }
      });
    }, balance.foodCheckInterval);
    return () => clearInterval(id);
  }, [companionPos?.lat, companionPos?.lng, eatFood]);

  const mapOptions = useMemo(
    () => ({
      styles: greyscaleMapStyle,
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
    [],
  );

  // Clustering runs against TRUE positions so "genuinely close reports"
  // are grouped regardless of display jitter. The cluster badge sits at the
  // true centroid; individual pets (singletons + members of small clusters)
  // render at their jittered positions from displayPositions.
  const clusters = useMemo(
    () =>
      clusterByDistance(
        lostDogs.map((d) => ({ id: d.id, position: d.lastSeen.position, dog: d })),
        PIN_CLUSTER_RADIUS_M,
      ),
    [lostDogs],
  );

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

  const tokenTapHandlers = useMemo(() => {
    const m = new Map<string, () => void>();
    for (const t of tokens) m.set(t.id, () => collectToken(t.id));
    return m;
  }, [tokens, collectToken]);

  const foodTapHandlers = useMemo(() => {
    const m = new Map<string, () => void>();
    for (const f of foodItems) m.set(f.id, () => eatFood(f.id));
    return m;
  }, [foodItems, eatFood]);

  // Keys cluster identity on the sorted ids of its members so taps remain
  // stable across re-renders even if the center drifts slightly.
  const clusterKey = useCallback(
    (items: { id: string }[]) => items.map((i) => i.id).sort().join('|'),
    [],
  );

  const handleClusterTap = useCallback(
    (items: { id: string }[]) => {
      const key = clusterKey(items);
      setExpandedClusterKey((prev) => (prev === key ? null : key));
    },
    [clusterKey],
  );

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

  if (!isLoaded || !userPos) {
    return (
      <View style={styles.msg}>
        <Text style={styles.t}>locating…</Text>
        {location.usingFallback ? <Text style={styles.s}>using kyiv fallback</Text> : null}
      </View>
    );
  }

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
            return [
              <LostDogMarker
                key={d.id}
                position={displayPositions.get(d.id) ?? d.lastSeen.position}
                emoji={d.emoji}
                name={d.name}
                urgency={d.urgency}
                photoUrl={d.photoUrl}
                onTap={petTapHandlers.get(d.id)!}
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
              return (
                <LostDogMarker
                  key={d.id}
                  position={displayPositions.get(d.id) ?? d.lastSeen.position}
                  emoji={d.emoji}
                  name={d.name}
                  urgency={d.urgency}
                  photoUrl={d.photoUrl}
                  onTap={petTapHandlers.get(d.id)!}
                />
              );
            });
          }
          const key = clusterKey(c.items);
          const expanded = expandedClusterKey === key;
          const dominantUrgency = c.items
            .map((i) => i.dog.urgency)
            .reduce<UrgencyLevel>(
              (best, u) => (URGENCY_RANK[u] > URGENCY_RANK[best] ? u : best),
              'resolved',
            );
          // Up to two distinct emojis, in the order they appear, so the
          // badge hints "dog + cat" vs "two dogs" without clutter.
          const emojiHint = Array.from(new Set(c.items.map((i) => i.dog.emoji)))
            .slice(0, 2)
            .join('');
          return [
            <LostDogCluster
              key={`cluster-${key}`}
              position={c.center}
              items={c.items.map((i) => i.dog)}
              dominantUrgency={dominantUrgency}
              emojiHint={emojiHint}
              expanded={expanded}
              onToggle={() => handleClusterTap(c.items)}
              onSelectItem={(id) => {
                setExpandedClusterKey(null);
                setSelectedDog(id);
              }}
            />,
          ];
        })}

        {tokens
          .filter((t) => !t.collectedAt)
          .map((t) => (
            <TokenMarker
              key={t.id}
              position={t.position}
              onTap={tokenTapHandlers.get(t.id)!}
            />
          ))}

        {foodItems.map((f) => (
          <FoodMarker key={f.id} position={f.position} onTap={foodTapHandlers.get(f.id)!} />
        ))}

        {/* Spots layer. Toggle off hides the field, but two spots are
            still rendered when relevant: the user's current selection
            (so the modal's pin still shows) and the walk-route
            destination (so the polyline always points to a visible
            marker). Both stay visible even when the layer is "off"
            because they're the user's current focus, not ambient
            decoration. */}
        {(() => {
          const renderSet = new Set<string>();
          if (spotsVisible) {
            for (const s of spots) renderSet.add(s.id);
          } else {
            if (selectedSpotId) renderSet.add(selectedSpotId);
            if (walkRouteMeta?.spotId) renderSet.add(walkRouteMeta.spotId);
          }
          return spots
            .filter((s) => renderSet.has(s.id))
            .map((s) => (
              <PoiMarker
                key={s.id}
                position={s.position}
                emoji={s.icon ?? '📍'}
                name={s.name}
                selected={s.id === selectedSpotId}
                onTap={() => setSelectedSpot(s.id === selectedSpotId ? null : s.id)}
              />
            ));
        })()}

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
                              4000,
                            );
                          } else if (advanced) {
                            showBubble(
                              narration ?? `paw print here — let's keep going 🐾`,
                              3000,
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
            onTapCompanion={() => showBubble('woof 🐾', 2000)}
          />
        ) : null}
      </GoogleMap>

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
            showBubble(`thanks — moved ${d.name}'s pin 📍`, 3000);
          } else if (res?.ok) {
            showBubble(`thanks — sighting logged 👀`, 3000);
          } else {
            showBubble(`couldn't report that one — try again`, 3000);
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
              4000,
            );
          } else {
            showBubble("couldn't start the search — try again", 3000);
          }
        }}
      />

      <SpotModal
        spot={spots.find((s) => s.id === selectedSpotId) ?? null}
        onClose={() => setSelectedSpot(null)}
        onWalkHere={async (spot, shape) => {
          if (!userPos) {
            showBubble("can't walk without knowing where we are", 3000);
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
