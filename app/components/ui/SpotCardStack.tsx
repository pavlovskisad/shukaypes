// Sister of LostDogCardStack — same Tinder-style swipe deck, but
// the card content is icon-led instead of photo-led: a big
// category glyph as the hero, name + rating + address arranged
// below on a clean white card. Powers the per-category snap
// cards on the spots tab (one stack per category).
//
// Built on the same react-native-reanimated + gesture-handler
// foundation as LostDogCardStack; the deck-shift / advance /
// gesture mechanics are identical. Copy-paste over abstraction
// because the only real axis of variation is renderCard — once
// a third stack lands the shared CardStack hook designs itself.

import { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
  Easing,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import type { Spot } from '../../services/places';
import { colors } from '../../constants/colors';
import { SYSTEM_FONT } from '../../constants/fonts';
import { useStrings } from '../../i18n/useStrings';
import { Icon, iconForCategory } from './Icon';

const CARD_W = 320;
const CARD_H = 280;
const SWIPE_COMMIT_PX = 100;
const VELOCITY_COMMIT = 600;
const TAP_TRAVEL_MAX = 6;

const FLY_OFF_MS = 320;
const SLIDE_IN_MS = 380;
const REVEAL_MS = 280;
const FLY_EASE = Easing.out(Easing.cubic);
const SLIDE_EASE = Easing.out(Easing.cubic);

interface Props {
  spots: Spot[];
  onTap: (spot: Spot) => void;
}

export function SpotCardStack({ spots, onTap }: Props) {
  const t = useStrings();
  const [index, setIndex] = useState(0);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);

  // Reset to start when the deck changes (filter switch, refetch).
  const spotIds = useMemo(() => spots.map((s) => s.id).join(','), [spots]);
  useEffect(() => {
    setIndex(0);
    tx.value = 0;
    ty.value = 0;
  }, [spotIds]);

  const deckShift = useSharedValue(0);
  const topAppearOpacity = useSharedValue(1);
  const revealProgress = useSharedValue(0);

  const advance = useCallback(
    (delta: number) => {
      setIndex((i) => Math.max(0, i + delta));
      requestAnimationFrame(() => {
        ty.value = 0;
        revealProgress.value = 0;
        topAppearOpacity.value = 0;
        topAppearOpacity.value = withTiming(1, {
          duration: REVEAL_MS,
          easing: SLIDE_EASE,
        });
        if (delta < 0) {
          tx.value = -(CARD_W + 100);
          tx.value = withTiming(0, { duration: SLIDE_IN_MS, easing: SLIDE_EASE });
        } else {
          tx.value = 0;
          deckShift.value = withTiming(0, {
            duration: REVEAL_MS,
            easing: SLIDE_EASE,
          });
        }
      });
    },
    [tx, ty, revealProgress, topAppearOpacity, deckShift],
  );

  const indexSV = useSharedValue(index);
  useEffect(() => {
    indexSV.value = index;
  }, [index, indexSV]);

  const handleTap = useCallback(
    (spot: Spot) => {
      onTap(spot);
    },
    [onTap],
  );

  const topSpot = spots[index];
  const next1 = spots[index + 1];
  const next2 = spots[index + 2];
  const next3 = spots[index + 3];

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      tx.value = e.translationX;
      ty.value = e.translationY * 0.3;
      if (e.translationX < 0) {
        const p = Math.min(Math.abs(e.translationX) / CARD_W, 1);
        deckShift.value = p;
        revealProgress.value = p;
      } else {
        deckShift.value = 0;
        revealProgress.value = 0;
      }
    })
    .onEnd((e) => {
      const travel = Math.abs(e.translationX) + Math.abs(e.translationY);
      const passedPx = Math.abs(e.translationX) > SWIPE_COMMIT_PX;
      const passedVel = Math.abs(e.velocityX) > VELOCITY_COMMIT;
      if (travel < TAP_TRAVEL_MAX && topSpot) {
        runOnJS(handleTap)(topSpot);
        tx.value = withSpring(0);
        ty.value = withSpring(0);
        deckShift.value = withSpring(0);
        revealProgress.value = withSpring(0);
        return;
      }
      if (passedPx || passedVel) {
        const isForward = e.translationX < 0;
        if (!isForward && indexSV.value === 0) {
          tx.value = withSpring(0);
          ty.value = withSpring(0);
          deckShift.value = withSpring(0);
          return;
        }
        const dir = isForward ? -1 : 1;
        const delta = isForward ? 1 : -1;
        if (isForward) {
          deckShift.value = withTiming(1, {
            duration: FLY_OFF_MS,
            easing: FLY_EASE,
          });
          revealProgress.value = withTiming(1, {
            duration: REVEAL_MS,
            easing: SLIDE_EASE,
          });
        }
        tx.value = withTiming(
          dir * (CARD_W + 100),
          { duration: FLY_OFF_MS, easing: FLY_EASE },
          () => {
            runOnJS(advance)(delta);
          },
        );
        ty.value = withTiming(ty.value + 40, { duration: FLY_OFF_MS, easing: FLY_EASE });
      } else {
        tx.value = withSpring(0);
        ty.value = withSpring(0);
        deckShift.value = withSpring(0);
        revealProgress.value = withSpring(0);
      }
    });

  const topStyle = useAnimatedStyle(() => {
    const rotate = interpolate(tx.value, [-200, 0, 200], [-12, 0, 12], Extrapolation.CLAMP);
    return {
      transform: [
        { translateX: tx.value },
        { translateY: ty.value },
        { rotate: `${rotate}deg` },
      ],
      opacity: topAppearOpacity.value,
    };
  });

  const SLOT_POSES = {
    middle: { rest: { scale: 0.94, ty: 30 }, promoted: { scale: 1.0,  ty: 0  } },
    bottom: { rest: { scale: 0.88, ty: 60 }, promoted: { scale: 0.94, ty: 30 } },
    buffer: { rest: { scale: 0.82, ty: 90 }, promoted: { scale: 0.88, ty: 60 } },
  } as const;

  const middleStyle = useAnimatedStyle(() => {
    const s = interpolate(deckShift.value, [0, 1], [SLOT_POSES.middle.rest.scale, SLOT_POSES.middle.promoted.scale]);
    const y = interpolate(deckShift.value, [0, 1], [SLOT_POSES.middle.rest.ty, SLOT_POSES.middle.promoted.ty]);
    return { transform: [{ scale: s }, { translateY: y }] };
  });
  const bottomStyle = useAnimatedStyle(() => {
    const s = interpolate(deckShift.value, [0, 1], [SLOT_POSES.bottom.rest.scale, SLOT_POSES.bottom.promoted.scale]);
    const y = interpolate(deckShift.value, [0, 1], [SLOT_POSES.bottom.rest.ty, SLOT_POSES.bottom.promoted.ty]);
    return { transform: [{ scale: s }, { translateY: y }] };
  });
  const bufferStyle = useAnimatedStyle(() => {
    const s = interpolate(deckShift.value, [0, 1], [SLOT_POSES.buffer.rest.scale, SLOT_POSES.buffer.promoted.scale]);
    const y = interpolate(deckShift.value, [0, 1], [SLOT_POSES.buffer.rest.ty, SLOT_POSES.buffer.promoted.ty]);
    const o = interpolate(deckShift.value, [0, 1], [0, 1], Extrapolation.CLAMP);
    return { transform: [{ scale: s }, { translateY: y }], opacity: o };
  });

  if (!topSpot) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyText}>{t.spots.nearbySpots}</Text>
        <Pressable
          onPress={() => setIndex(0)}
          style={({ pressed }) => [styles.resetBtn, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.resetText}>{t.tasks.showFewer}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.deck}>
        {next3 ? (
          <Animated.View
            key="buffer"
            style={[styles.cardSlot, styles.greyDeckCard, bufferStyle]}
          />
        ) : null}
        {next2 ? (
          <Animated.View
            key="bottom"
            style={[styles.cardSlot, styles.greyDeckCard, bottomStyle]}
          />
        ) : null}
        {next1 ? (
          <Animated.View
            key="middle"
            style={[styles.cardSlot, styles.greyDeckCard, middleStyle]}
          />
        ) : null}
        <GestureDetector gesture={pan}>
          <Animated.View style={[styles.cardSlot, topStyle]}>
            {renderCard(topSpot, t)}
          </Animated.View>
        </GestureDetector>
      </View>
      <Text style={styles.counter}>
        {index + 1} / {spots.length}
      </Text>
    </View>
  );
}

// Single spot card. White background, big category icon as the
// centred hero, name + address at the bottom on dark text (no
// gradient — there's no photo to darken). Category chip top-left,
// optional rating chip top-right. Compact business-card aesthetic.
function renderCard(spot: Spot, t: ReturnType<typeof useStrings>) {
  const categoryLabel =
    t.modals.spot.categories[spot.category as keyof typeof t.modals.spot.categories] ??
    spot.category;
  const iconSlot = iconForCategory(spot.category);

  return (
    <View style={styles.card}>
      <View style={styles.iconHero}>
        {iconSlot ? (
          <Icon name={iconSlot} size={110} />
        ) : (
          <Text style={styles.heroEmoji}>{spot.icon ?? '📍'}</Text>
        )}
      </View>
      <View style={styles.categoryBadge}>
        <Text style={styles.categoryBadgeText}>{categoryLabel}</Text>
      </View>
      {typeof spot.rating === 'number' ? (
        <View style={styles.ratingBadge}>
          <Text style={styles.ratingBadgeText}>★ {spot.rating.toFixed(1)}</Text>
        </View>
      ) : null}
      <View style={styles.cardBody}>
        <Text style={styles.cardName} numberOfLines={1}>
          {spot.name}
        </Text>
        {spot.address ? (
          <Text style={styles.cardMeta} numberOfLines={1}>
            {spot.address}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// Skeleton variant — same dimensions + deck layout as the real
// stack so the snap card frame doesn't change height when data
// arrives. Two stacked grey peeks + a top card with a shimmer
// sweep that repeats. Reuses the lost-dog shimmer keyframe so
// only one stylesheet is injected.
export function SpotCardStackSkeleton() {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.getElementById('lost-dog-shimmer-style')) return;
    const el = document.createElement('style');
    el.id = 'lost-dog-shimmer-style';
    el.textContent = `
      @keyframes lost-dog-shimmer {
        0%   { background-position: -150% 0; }
        100% { background-position: 250% 0;  }
      }
    `;
    document.head.appendChild(el);
  }, []);

  return (
    <View style={styles.wrap}>
      <View style={styles.deck}>
        <View
          style={[
            styles.cardSlot,
            styles.greyDeckCard,
            { transform: [{ scale: 0.88 }, { translateY: 60 }] },
          ]}
        />
        <View
          style={[
            styles.cardSlot,
            styles.greyDeckCard,
            { transform: [{ scale: 0.94 }, { translateY: 30 }] },
          ]}
        />
        <View
          style={
            {
              ...styles.cardSlot,
              backgroundColor: '#e6e6e6',
              backgroundImage:
                'linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.75) 50%, transparent 70%)',
              backgroundSize: '200% 100%',
              backgroundRepeat: 'no-repeat',
              animation: 'lost-dog-shimmer 1.8s ease-in-out infinite',
              borderRadius: 24,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.18,
              shadowRadius: 20,
            } as unknown as object
          }
        />
      </View>
      <Text style={[styles.counter, { color: 'transparent' }]}>0 / 0</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  deck: {
    width: CARD_W,
    height: CARD_H,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 50,
  },
  cardSlot: {
    position: 'absolute',
    width: CARD_W,
    height: CARD_H,
  },
  greyDeckCard: {
    backgroundColor: '#e6e6e6',
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 2,
  },
  card: {
    width: '100%',
    height: '100%',
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 6,
  },
  iconHero: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroEmoji: {
    fontSize: 90,
    opacity: 0.85,
  },
  categoryBadge: {
    position: 'absolute',
    top: 14,
    left: 14,
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.04)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 2,
  },
  categoryBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'lowercase',
    letterSpacing: 0.4,
    color: '#555',
  },
  ratingBadge: {
    position: 'absolute',
    top: 14,
    right: 14,
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.04)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 2,
  },
  ratingBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#d9a030',
    letterSpacing: 0.3,
  },
  cardBody: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 18,
  },
  cardName: {
    fontFamily: SYSTEM_FONT,
    fontSize: 22,
    fontWeight: '800',
    color: colors.black,
  },
  cardMeta: {
    fontFamily: SYSTEM_FONT,
    fontSize: 13,
    color: '#777',
    marginTop: 4,
  },
  counter: {
    fontSize: 13,
    color: '#777',
    fontWeight: '600',
  },
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: 30,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    color: '#777',
  },
  resetBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: '#1a1a1a',
    borderRadius: 999,
  },
  resetText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
});
