import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GoogleMap, useJsApiLoader, OverlayView } from '@react-google-maps/api';
import { View, Text, StyleSheet } from 'react-native';
import { env } from '../../constants/env';
import { colors } from '../../constants/colors';
import { balance } from '../../constants/balance';
import { greyscaleMapStyle } from '../../constants/mapStyle';
import { useGameStore } from '../../stores/gameStore';
import { useLocation } from '../../hooks/useLocation';
import { useCompanion } from '../../hooks/useCompanion';
import { useGameLoop } from '../../hooks/useGameLoop';
import { distanceMeters, scatter } from '../../utils/geo';
import { Companion } from './Companion';
import { UserMarker } from './UserMarker';
import { TokenMarker } from './TokenMarker';
import { FoodMarker } from './FoodMarker';
import type { FoodItem, LatLng, Token } from '@shukajpes/shared';

const CONTAINER_STYLE = { width: '100%', height: '100%' };
const LIBRARIES: ('places')[] = ['places'];

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
  const seedTokens = useGameStore((s) => s.seedTokens);
  const seedFood = useGameStore((s) => s.seedFood);
  const tokens = useGameStore((s) => s.tokens);
  const foodItems = useGameStore((s) => s.foodItems);
  const collectToken = useGameStore((s) => s.collectToken);
  const eatFood = useGameStore((s) => s.eatFood);
  const setUserPosition = useGameStore((s) => s.setUserPosition);

  const showBubble = useCallback((msg: string, duration?: number) => {
    setBubble(msg);
    if (bubbleTimeoutRef.current) clearTimeout(bubbleTimeoutRef.current);
    bubbleTimeoutRef.current = setTimeout(
      () => setBubble(null),
      duration ?? balance.bubbleDuration
    );
  }, []);

  useGameLoop(showBubble);

  // Sync location into gameStore for other screens.
  useEffect(() => {
    if (userPos) setUserPosition(userPos);
  }, [userPos?.lat, userPos?.lng, setUserPosition]);

  // Seed tokens + food once when we first have a position.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!userPos || seededRef.current) return;
    seededRef.current = true;
    const tokenPositions = scatter(userPos, balance.tokenCount, 0.016, 0.016);
    const newTokens: Token[] = tokenPositions.map((pos, i) => ({
      id: `r${i}`,
      type: 'regular',
      position: pos,
      value: 1 + Math.floor(Math.random() * 3),
      spawnedAt: new Date().toISOString(),
    }));
    seedTokens(newTokens);
    const foodPositions = scatter(userPos, balance.foodCount, 0.014, 0.014);
    const newFood: FoodItem[] = foodPositions.map((pos, i) => ({
      id: `f${i}`,
      position: pos,
      value: 1,
      spawnedAt: new Date().toISOString(),
    }));
    seedFood(newFood);
  }, [userPos?.lat, userPos?.lng, seedTokens, seedFood]);

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
    []
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
