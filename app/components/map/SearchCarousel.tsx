import { useEffect, useRef } from 'react';
import {
  ScrollView,
  View,
  Text,
  Image,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import type { LatLng } from '@shukajpes/shared';
import type { NearbyLostDog } from '../../services/api';
import { distanceMeters } from '../../utils/geo';
import { SYSTEM_FONT } from '../../constants/fonts';
import { Z } from '../../constants/z';

// Bottom swipeable carousel of nearby lost dogs — replaces the dashboard while
// search mode is on. The CENTRED card is the dog you're on the trail of; swipe
// to a different one and it hands that dog's trail back via onSelect. Kept in
// sync the other way too: when the mode advances to the next dog on arrival,
// activeDogId changes and we scroll the carousel to it.

const CARD_W = 152;
const GAP = 12;
const STEP = CARD_W + GAP;

interface Props {
  dogs: NearbyLostDog[];
  activeDogId: string | null;
  userPos: LatLng | null;
  onSelect: (dog: NearbyLostDog) => void;
}

const URGENCY_DOT: Record<string, string> = {
  urgent: '#ff4d4f',
  medium: '#ffb020',
  resolved: '#8a8f98',
  rehoming: '#6ea8fe',
};

export function SearchCarousel({ dogs, activeDogId, userPos, onSelect }: Props) {
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView | null>(null);
  const sidePad = Math.max(0, (width - CARD_W) / 2);
  const activeIdx = Math.max(
    0,
    dogs.findIndex((d) => d.id === activeDogId),
  );

  // Scroll to the active card when it changes externally (arrival advance).
  useEffect(() => {
    scrollRef.current?.scrollTo({ x: activeIdx * STEP, animated: true });
  }, [activeIdx]);

  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    const idx = Math.max(0, Math.min(dogs.length - 1, Math.round(x / STEP)));
    scrollRef.current?.scrollTo({ x: idx * STEP, animated: true });
    const dog = dogs[idx];
    if (dog && dog.id !== activeDogId) onSelect(dog);
  };

  if (dogs.length === 0) return null;

  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 22,
        zIndex: Z.HUD_CHIPS,
      }}
      pointerEvents="box-none"
    >
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={STEP}
        snapToAlignment="start"
        decelerationRate="fast"
        onMomentumScrollEnd={settle}
        onScrollEndDrag={settle}
        contentContainerStyle={{ paddingHorizontal: sidePad, gap: GAP }}
      >
        {dogs.map((d) => {
          const active = d.id === activeDogId;
          const dist = userPos
            ? Math.round(distanceMeters(userPos, d.lastSeen.position))
            : null;
          const distLabel =
            dist == null
              ? ''
              : dist >= 1000
                ? `${(dist / 1000).toFixed(1)} km`
                : `${dist} m`;
          return (
            <View
              key={d.id}
              style={{
                width: CARD_W,
                borderRadius: 16,
                overflow: 'hidden',
                backgroundColor: active
                  ? 'rgba(20,20,24,0.94)'
                  : 'rgba(20,20,24,0.72)',
                borderWidth: 2,
                borderColor: active ? '#2f6bff' : 'transparent',
                opacity: active ? 1 : 0.85,
                transform: [{ scale: active ? 1 : 0.94 }],
              }}
            >
              <View
                style={{
                  height: 92,
                  backgroundColor: '#2a2e37',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {d.photoUrl ? (
                  <Image
                    source={{ uri: d.photoUrl }}
                    style={{ width: '100%', height: '100%' }}
                    resizeMode="cover"
                  />
                ) : (
                  <Text style={{ fontSize: 40 }}>{d.emoji || '🐕'}</Text>
                )}
              </View>
              <View style={{ padding: 8 }}>
                <View
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
                >
                  <View
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 4,
                      backgroundColor: URGENCY_DOT[d.urgency] ?? '#ffb020',
                    }}
                  />
                  <Text
                    numberOfLines={1}
                    style={{
                      color: '#fff',
                      fontFamily: SYSTEM_FONT,
                      fontWeight: '700',
                      fontSize: 14,
                      flexShrink: 1,
                    }}
                  >
                    {d.name}
                  </Text>
                </View>
                <Text
                  numberOfLines={1}
                  style={{
                    color: 'rgba(255,255,255,0.75)',
                    fontFamily: SYSTEM_FONT,
                    fontSize: 11,
                    marginTop: 2,
                  }}
                >
                  {d.breed}
                  {distLabel ? ` · ${distLabel}` : ''}
                </Text>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
