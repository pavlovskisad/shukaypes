import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GoogleMap, useJsApiLoader } from '@react-google-maps/api';
import { View, Text, StyleSheet } from 'react-native';
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
import { SearchZoneCircle } from './SearchZoneCircle';
import { LostDogModal } from '../ui/LostDogModal';

const CONTAINER_STYLE = { width: '100%', height: '100%' };
const LIBRARIES: ('places')[] = ['places'];
const TOKEN_REFRESH_MS = 15000;

export default function MapViewWeb() {
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: env.googleMapsApiKey,
    libraries: LIBRARIES,
  });

  const location = useLocation();
  const [bubble, setBubble] = useState<string | null>(null);
  const bubbleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userPos = location.position;

  const companionPos = useCompanion(userPos);
  const tokens = useGameStore((s) => s.tokens);
  const foodItems = useGameStore((s) => s.foodItems);
  const lostDogs = useGameStore((s) => s.lostDogs);
  const selectedDogId = useGameStore((s) => s.selectedDogId);
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
        center={userPos as unknown as google.maps.LatLngLiteral}
        zoom={balance.mapZoomDefault}
        options={mapOptions}
      >
        <UserMarker position={userPos} />

        {lostDogs.map((d) => (
          <SearchZoneCircle
            key={`zone-${d.id}`}
            center={d.lastSeen.position}
            radiusM={d.searchZoneRadiusM}
            urgency={d.urgency}
          />
        ))}

        {lostDogs.map((d) => (
          <LostDogMarker
            key={d.id}
            position={d.lastSeen.position}
            emoji={d.emoji}
            name={d.name}
            urgency={d.urgency}
            onTap={() => setSelectedDog(d.id)}
          />
        ))}

        {tokens
          .filter((t) => !t.collectedAt)
          .map((t) => (
            <TokenMarker
              key={t.id}
              position={t.position}
              onTap={() => collectToken(t.id)}
            />
          ))}

        {foodItems.map((f) => (
          <FoodMarker key={f.id} position={f.position} onTap={() => eatFood(f.id)} />
        ))}

        {companionPos ? (
          <Companion position={companionPos} bubble={bubble} onTapCompanion={() => showBubble('woof 🐾', 2000)} />
        ) : null}
      </GoogleMap>

      <LostDogModal
        dog={lostDogs.find((d) => d.id === selectedDogId) ?? null}
        onClose={() => setSelectedDog(null)}
        onJoinSearch={(d) => {
          setSelectedDog(null);
          showBubble(`looking for ${d.name}… 🐾`, 3000);
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
