import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GoogleMap, useJsApiLoader } from '@react-google-maps/api';
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
import { PoiMarker } from './PoiMarker';
import { clusterByDistance, jitterInRadius } from '../../utils/cluster';

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
  const selectedSpotId = useGameStore((s) => s.selectedSpotId);
  const setSelectedSpot = useGameStore((s) => s.setSelectedSpot);
  const collectToken = useGameStore((s) => s.collectToken);
  const eatFood = useGameStore((s) => s.eatFood);
  const setUserPosition = useGameStore((s) => s.setUserPosition);
  const syncTokens = useGameStore((s) => s.syncTokens);
  const syncFood = useGameStore((s) => s.syncFood);
  const syncLostDogs = useGameStore((s) => s.syncLostDogs);
  const setSelectedDog = useGameStore((s) => s.setSelectedDog);

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

  // Auto-collect tokens within 50m of companion.
  useEffect(() => {
    if (!companionPos) return;
    const id = setInterval(() => {
      const { tokens: ts } = useGameStore.getState();
      ts.forEach((t) => {
        if (t.collectedAt) return;
        if (distanceMeters(companionPos, t.position) < balance.autoCollectToken) {
          collectToken(t.id);
        }
      });
    }, balance.roamTick);
    return () => clearInterval(id);
  }, [companionPos?.lat, companionPos?.lng, collectToken]);

  // Auto-eat food within 40m.
  useEffect(() => {
    if (!companionPos) return;
    const id = setInterval(() => {
      const { foodItems: fs } = useGameStore.getState();
      fs.forEach((f) => {
        if (distanceMeters(companionPos, f.position) < balance.autoCollectFood) {
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
  // searchZoneRadiusM — posted location is a landmark-level approximation,
  // and the zone radius is the uncertainty radius the parser already gave us.
  // Positions are STATIC at the lat/lng level — small continuous wander
  // is added inside LostDogMarker via a CSS transform so pets feel alive
  // without the "teleport" of snapping to a new projected pixel.
  //
  // For pets sharing a cluster we override the hash-derived angle with an
  // evenly-fanned one (sorted by id for stability), so pets radiate in
  // different directions even from the same landmark.
  const displayPositions = useMemo(() => {
    const map = new Map<string, { lat: number; lng: number }>();
    for (const c of clusters) {
      if (c.items.length === 1) {
        const d = c.items[0]!.dog;
        map.set(d.id, jitterInRadius(d.lastSeen.position, d.searchZoneRadiusM, d.id));
        continue;
      }
      const sorted = [...c.items].sort((a, b) => a.id.localeCompare(b.id));
      sorted.forEach((item, i) => {
        const angle = -Math.PI / 2 + (i * 2 * Math.PI) / sorted.length;
        const d = item.dog;
        map.set(
          d.id,
          jitterInRadius(d.lastSeen.position, d.searchZoneRadiusM, d.id, angle),
        );
      });
    }
    return map;
  }, [clusters]);

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
        onClick={() => setExpandedClusterKey(null)}
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

        {spots.map((s) => (
          <PoiMarker
            key={s.id}
            position={s.position}
            emoji={s.icon ?? '📍'}
            name={s.name}
            selected={s.id === selectedSpotId}
            onTap={() => setSelectedSpot(s.id === selectedSpotId ? null : s.id)}
          />
        ))}

        {companionPos ? (
          <Companion position={companionPos} bubble={bubble} onTapCompanion={() => showBubble('woof 🐾', 2000)} />
        ) : null}
      </GoogleMap>

      <LostDogModal
        dog={lostDogs.find((d) => d.id === selectedDogId) ?? null}
        onClose={() => setSelectedDog(null)}
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
