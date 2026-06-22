// Generic carousel card stack. A virtual window of five items
// around `index` is rendered on a horizontal track at offsets
// [-2, -1, 0, +1, +2] * STEP. The whole track translates by
// `trackShift` during a swipe — top + peeks + buffers all slide
// together like a real carousel, not a Tinder-style fly-off.
//
// On commit the track animates by ±STEP (one card-step) then the
// underlying `index` swaps and trackShift snaps back to 0. Crucially,
// each item is keyed by its STABLE id (not by slot position), so
// React reuses the same DOM nodes / images across the index swap —
// the four items that persist across an advance just animate to
// their new offsets, no image remount, no blink. Only the newly-
// arriving farthest item mounts (at an off-screen buffer position).
//
// Used by:
//   - LostDogCardStack (NearbyLostDog items, photo cards)
//   - SpotCardStack    (Spot items, icon cards)
//   - profile.tsx      ({id, content} sections — heterogeneous)
//
// Built on react-native-reanimated v3 + gesture-handler v2.

import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
  Easing,
  type SharedValue,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

export const CARD_W = 320;
export const CARD_H = 280;
const SWIPE_COMMIT_PX = 100;
const VELOCITY_COMMIT = 600;
const TAP_TRAVEL_MAX = 16;

const SETTLE_MS = 360;
const SETTLE_EASE = Easing.out(Easing.cubic);

const TOP_SCALE = 0.88;
const PEEK_SCALE = 0.74;
const OFF_SCALE = 0.62;

interface Props<T> {
  items: T[];
  renderCard: (item: T) => ReactNode;
  getId: (item: T) => string;
  onTap?: (item: T) => void;
  getPhotoUrl?: (item: T) => string | null | undefined;
  showCounter?: boolean;
  cardHeight?: number;
  peekScale?: number;
}

// Per-item slot. Owns its own useAnimatedStyle that derives the
// translateX / scale from the item's current `offset` from the
// centre and the shared `trackShift`. `offset` is a regular React
// prop — it changes when the index advances and that item shifts
// position in the window — but Reanimated re-uploads the worklet
// with the new captured offset, so the position stays consistent.
function ItemSlot<T>({
  item,
  offset,
  trackShift,
  step,
  slotSize,
  renderCard,
}: {
  item: T;
  offset: number;
  trackShift: SharedValue<number>;
  step: number;
  slotSize: { width: number; height: number };
  renderCard: (item: T) => ReactNode;
}) {
  const animStyle = useAnimatedStyle(() => {
    const visualTx = offset * step + trackShift.value;
    const scale = interpolate(
      visualTx,
      [-2 * step, -step, 0, step, 2 * step],
      [OFF_SCALE, PEEK_SCALE, TOP_SCALE, PEEK_SCALE, OFF_SCALE],
      Extrapolation.CLAMP,
    );
    // zIndex follows distance-to-centre so the slot closest to 0
    // paints on top of the peeks. Without this, a peek rising into
    // the centre during a swipe can briefly underlap the outgoing
    // top card.
    const z = interpolate(
      Math.abs(visualTx),
      [0, step, 2 * step],
      [3, 2, 1],
      Extrapolation.CLAMP,
    );
    return { transform: [{ translateX: visualTx }, { scale }], zIndex: z };
  });
  return (
    <Animated.View style={[styles.cardSlot, slotSize, animStyle]}>
      {renderCard(item)}
    </Animated.View>
  );
}

export function CardStack<T>({
  items,
  renderCard,
  getId,
  onTap,
  getPhotoUrl,
  showCounter = true,
  cardHeight = CARD_H,
  peekScale = 1,
}: Props<T>) {
  const [index, setIndex] = useState(0);
  const trackShift = useSharedValue(0);

  // Carousel step — horizontal distance between adjacent slot
  // centres. 290 with TOP_SCALE 0.88 + PEEK_SCALE 0.74 leaves a
  // ~31 px gap between the centre's right edge and the peek's
  // left edge, ~24 px of visible peek on a 390-wide phone.
  const STEP = 290 * peekScale;

  // Reset to start when the underlying list changes (e.g. the
  // screen refetches and the order shifts).
  const ids = useMemo(() => items.map(getId).join(','), [items, getId]);
  useEffect(() => {
    setIndex(0);
    trackShift.value = 0;
  }, [ids]);

  // Pre-warm photos for neighbouring items so the next card's
  // image is already decoded.
  useEffect(() => {
    if (!getPhotoUrl) return;
    const upcoming = [
      items[index + 1],
      items[index + 2],
      items[index + 3],
      items[index + 4],
      items[index - 1],
      items[index - 2],
    ];
    upcoming.forEach((item) => {
      if (!item) return;
      const url = getPhotoUrl(item);
      if (url) {
        Image.prefetch(url).catch(() => {
          /* swallow — best-effort */
        });
      }
    });
  }, [index, items, getPhotoUrl]);

  const N = items.length;
  const topItem = N > 0 ? items[index] : undefined;

  // Window of 5 items centred on `index`, cycling modulo N. Each
  // entry carries the item, its offset from centre, and the stable
  // id used as React key.
  const window = useMemo(() => {
    if (N === 0) return [];
    return [-2, -1, 0, 1, 2].map((offset) => {
      const item = items[((index + offset) % N + N) % N];
      return { id: getId(item), item, offset };
    });
  }, [index, items, N, getId]);

  const advance = useCallback(
    (delta: number) => {
      // Order matters: zero the track first so the worklet's next
      // frame uses trackShift=0; then setIndex triggers React to
      // reshuffle offsets. Items keyed by id reuse their slots —
      // each persisting item's new offset cancels the snap exactly
      // (offset*step + 0 == old_offset*step + (-step)).
      trackShift.value = 0;
      setIndex((i) => {
        if (N === 0) return 0;
        return ((i + delta) % N + N) % N;
      });
    },
    [N, trackShift],
  );

  const handleTap = useCallback(() => {
    if (topItem) onTap?.(topItem);
  }, [onTap, topItem]);

  // Deck-level gestures. Pan drives the entire track; tap fires
  // for any centre-area touch with low travel. Peek taps also
  // route to onTap(topItem) — peeks aren't independently
  // interactive in a carousel and the simpler model avoids
  // hit-testing per slot.
  const tap = Gesture.Tap().onEnd(() => {
    runOnJS(handleTap)();
  });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      trackShift.value = e.translationX;
    })
    .onEnd((e) => {
      const travel = Math.abs(e.translationX) + Math.abs(e.translationY);
      const passedPx = Math.abs(e.translationX) > SWIPE_COMMIT_PX;
      const passedVel = Math.abs(e.velocityX) > VELOCITY_COMMIT;
      if (travel < TAP_TRAVEL_MAX) {
        runOnJS(handleTap)();
        trackShift.value = withSpring(0);
        return;
      }
      if (N > 1 && (passedPx || passedVel)) {
        const isForward = e.translationX < 0;
        const delta = isForward ? 1 : -1;
        const target = isForward ? -STEP : STEP;
        trackShift.value = withTiming(
          target,
          { duration: SETTLE_MS, easing: SETTLE_EASE },
          () => {
            runOnJS(advance)(delta);
          },
        );
      } else {
        trackShift.value = withSpring(0);
      }
    });

  if (!topItem) return null;

  const slotSize = { width: CARD_W, height: cardHeight };

  return (
    <View style={styles.wrap}>
      <GestureDetector gesture={Gesture.Race(tap, pan)}>
        <View style={[styles.deck, slotSize, { marginBottom: 24 * peekScale }]}>
          {window.map(({ id, item, offset }) => (
            <ItemSlot
              key={id}
              item={item}
              offset={offset}
              trackShift={trackShift}
              step={STEP}
              slotSize={slotSize}
              renderCard={renderCard}
            />
          ))}
        </View>
      </GestureDetector>
      {showCounter ? (
        <Text style={styles.counter}>
          {index + 1} / {items.length}
        </Text>
      ) : null}
    </View>
  );
}

// Skeleton variant — same dimensions + deck layout as the real
// stack so callers can render with stable height from the very
// first paint, before the items fetch comes back.
export function CardStackSkeleton({
  showCounter = true,
  cardHeight = CARD_H,
  peekScale = 1,
}: {
  showCounter?: boolean;
  cardHeight?: number;
  peekScale?: number;
}) {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.getElementById('card-stack-shimmer-style')) return;
    const el = document.createElement('style');
    el.id = 'card-stack-shimmer-style';
    el.textContent = `
      @keyframes card-stack-shimmer {
        0%   { background-position: -150% 0; }
        100% { background-position: 250% 0;  }
      }
    `;
    document.head.appendChild(el);
  }, []);

  const slotSize = { width: CARD_W, height: cardHeight };
  const STEP = 290 * peekScale;

  return (
    <View style={styles.wrap}>
      <View style={[styles.deck, slotSize, { marginBottom: 24 * peekScale }]}>
        <View
          style={[
            styles.cardSlot,
            slotSize,
            styles.greyDeckCard,
            { transform: [{ translateX: -STEP }, { scale: PEEK_SCALE }] },
          ]}
        />
        <View
          style={[
            styles.cardSlot,
            slotSize,
            styles.greyDeckCard,
            { transform: [{ translateX: STEP }, { scale: PEEK_SCALE }] },
          ]}
        />
        <View
          style={
            {
              ...styles.cardSlot,
              ...slotSize,
              backgroundColor: '#e6e6e6',
              backgroundImage:
                'linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.75) 50%, transparent 70%)',
              backgroundSize: '200% 100%',
              backgroundRepeat: 'no-repeat',
              animation: 'card-stack-shimmer 1.8s ease-in-out infinite',
              borderRadius: 28,
              transform: [{ scale: TOP_SCALE }],
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.18,
              shadowRadius: 20,
            } as unknown as object
          }
        />
      </View>
      {showCounter ? (
        <Text style={[styles.counter, { color: 'transparent' }]}>0 / 0</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  deck: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardSlot: {
    position: 'absolute',
  },
  greyDeckCard: {
    backgroundColor: '#e6e6e6',
    borderRadius: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 2,
  },
  counter: {
    fontSize: 13,
    color: '#777',
    fontWeight: '600',
  },
});
