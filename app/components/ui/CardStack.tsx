// Generic carousel card stack. Five slots laid out on a single
// horizontal track [-2*STEP, -STEP, 0, +STEP, +2*STEP]. The whole
// track translates by `trackShift` during a swipe — top + peeks +
// off-screen buffers all slide together like a real carousel, not
// a Tinder-style fly-off-then-settle.
//
// On commit, trackShift animates by ±STEP (one card-step left or
// right) then the underlying `index` swaps and trackShift snaps
// back to 0. The slot that animated into the centre re-binds to
// the new index's centre item — same pixel, same item, no jump.
// Two off-screen buffers are why this is seamless: they pre-render
// the next-next / prev-prev items so nothing pops in.
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
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

export const CARD_W = 320;
export const CARD_H = 280;
const SWIPE_COMMIT_PX = 100;
const VELOCITY_COMMIT = 600;
// Tap tolerance — pan handlers always wiggle a few px even on a
// clean finger-tap; 16 keeps "tap the card" forgiving without
// eating into the 100-px swipe threshold.
const TAP_TRAVEL_MAX = 16;

// One easing for both committed advance and rebound — keeps the
// motion family consistent whether the user completes a swipe or
// just nudges.
const SETTLE_MS = 360;
const SETTLE_EASE = Easing.out(Easing.cubic);

// Scale ladder for the track.
//   TOP_SCALE   — slot at visual tx 0 (the centre / interactive card)
//   PEEK_SCALE  — slot at visual tx ±STEP (left / right peek)
//   OFF_SCALE   — slot at visual tx ±2*STEP (off-screen buffer)
// Interpolated continuously: a slot mid-swipe smoothly grows /
// shrinks as it crosses between positions.
const TOP_SCALE = 0.88;
const PEEK_SCALE = 0.74;
const OFF_SCALE = 0.62;

interface Props<T> {
  items: T[];
  renderCard: (item: T) => ReactNode;
  // Stable per-item ID — drives the "reset to top on list change"
  // detection. Required so we can tell when items shuffled vs grew.
  getId: (item: T) => string;
  // Optional tap handler — short release with no real travel.
  onTap?: (item: T) => void;
  // Optional photo URL extractor. If provided, the stack pre-warms
  // Image.prefetch on neighbouring items so the next card's photo
  // is already decoded by the time the track shifts and renders it.
  // Spots / profile sections skip this — no photos to prefetch.
  getPhotoUrl?: (item: T) => string | null | undefined;
  // Show the "1 / N" counter under the deck. Defaults to true.
  showCounter?: boolean;
  // Override the deck's height. Defaults to CARD_H (280). Lets
  // callers like the profile section deck use a denser slot when
  // the per-card content (stat rows) doesn't need the full height
  // of a photo/icon card. Width stays CARD_W.
  cardHeight?: number;
  // Multiplier on the carousel step (centre→peek distance) and
  // the marginBottom reserve. < 1 tightens the deck (peeks closer
  // to the centre), > 1 spreads it out. Default 1 keeps the
  // calibration set against the default 280-tall card. Profile's
  // smaller deck wants a tighter step so the layout doesn't dwarf
  // the dog scene around it.
  peekScale?: number;
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
  // centres. At 290 with TOP_SCALE 0.88 + PEEK_SCALE 0.74:
  //   top visual right edge   = 0.88 * 160 = 140.8
  //   peek visual left edge   = 290 - 0.74 * 160 = 171.6
  //   gap between centre/peek = ~31 px (clear breathing room)
  //   peek visible strip      = ~24 px on a 390 phone
  const STEP = 290 * peekScale;

  // Reset to start when the underlying list changes (e.g. the
  // screen refetches and the order shifts).
  const ids = useMemo(() => items.map(getId).join(','), [items, getId]);
  useEffect(() => {
    setIndex(0);
    trackShift.value = 0;
  }, [ids]);

  // Pre-warm photos for neighbouring items so the next card's
  // image is already decoded. Only runs when getPhotoUrl is
  // provided.
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

  // Per-slot animated style. Each slot has a fixed base position
  // on the track; visual position = base + trackShift. Scale is a
  // pure function of visual position so any slot at tx=0 gets
  // TOP_SCALE, at ±STEP gets PEEK_SCALE, at ±2*STEP gets OFF_SCALE.
  // CLAMP at the edges so over-drag past the buffer doesn't grow
  // the slot back.
  const makeSlotStyle = (base: number) =>
    useAnimatedStyle(() => {
      const visualTx = base + trackShift.value;
      const scale = interpolate(
        visualTx,
        [-2 * STEP, -STEP, 0, STEP, 2 * STEP],
        [OFF_SCALE, PEEK_SCALE, TOP_SCALE, PEEK_SCALE, OFF_SCALE],
        Extrapolation.CLAMP,
      );
      return { transform: [{ translateX: visualTx }, { scale }] };
    });

  // Five fixed-position slots. Declared explicitly (not in a loop)
  // to keep `react-hooks/rules-of-hooks` happy.
  const slot0Style = makeSlotStyle(-2 * STEP);
  const slot1Style = makeSlotStyle(-STEP);
  const slot2Style = makeSlotStyle(0);
  const slot3Style = makeSlotStyle(STEP);
  const slot4Style = makeSlotStyle(2 * STEP);
  const slotStyles = [slot0Style, slot1Style, slot2Style, slot3Style, slot4Style];

  // Items bound to each slot — cycles modulo N so the deck wraps
  // forever. With N < 5 the same item can appear in two slots,
  // but the duplicates land at the off-screen buffer positions
  // so the user never sees them at rest.
  const itemAt = (offset: number): T | undefined => {
    if (N === 0) return undefined;
    return items[((index + offset) % N + N) % N];
  };
  const slotItems = [itemAt(-2), itemAt(-1), itemAt(0), itemAt(1), itemAt(2)];
  const topItem = slotItems[2];

  // Advance the index after a committed swipe. trackShift snaps
  // to 0 in the same frame — the slot that animated into the
  // centre position re-binds to the new index's centre item, so
  // the snap is invisible at the pixel level.
  const advance = useCallback(
    (delta: number) => {
      setIndex((i) => {
        if (N === 0) return 0;
        return ((i + delta) % N + N) % N;
      });
      trackShift.value = 0;
    },
    [N, trackShift],
  );

  const handleTap = useCallback(
    (item: T) => {
      onTap?.(item);
    },
    [onTap],
  );

  // Race(Tap, Pan) so a clean finger-tap commits immediately; any
  // real movement (> TAP_TRAVEL_MAX) defers to Pan and drives the
  // carousel.
  const tap = Gesture.Tap().onEnd(() => {
    if (topItem) runOnJS(handleTap)(topItem);
  });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      // 1:1 finger follow — the entire track moves with the
      // drag. Carousel feel: user is dragging the whole strip,
      // not just the top card.
      trackShift.value = e.translationX;
    })
    .onEnd((e) => {
      const travel = Math.abs(e.translationX) + Math.abs(e.translationY);
      const passedPx = Math.abs(e.translationX) > SWIPE_COMMIT_PX;
      const passedVel = Math.abs(e.velocityX) > VELOCITY_COMMIT;
      if (travel < TAP_TRAVEL_MAX && topItem) {
        runOnJS(handleTap)(topItem);
        trackShift.value = withSpring(0);
        return;
      }
      if (N > 1 && (passedPx || passedVel)) {
        const isForward = e.translationX < 0;
        const delta = isForward ? 1 : -1;
        const target = isForward ? -STEP : STEP;
        // Settle to the next snap position (one card-step over),
        // then advance the index and zero the track — visually
        // continuous because the slot that arrives at centre is
        // already showing what becomes the new top item.
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

  // Defensive — callers gate empty lists outside the stack.
  if (!topItem) return null;

  const slotSize = { width: CARD_W, height: cardHeight };

  // Paint order: deepest first so the centre card sits on top of
  // overlapping peeks during a swipe. [0, 4, 1, 3, 2] = far buffers,
  // peeks, then centre last.
  const paintOrder = [0, 4, 1, 3, 2];

  return (
    <View style={styles.wrap}>
      <View style={[styles.deck, slotSize, { marginBottom: 24 * peekScale }]}>
        {paintOrder.map((slotIdx) => {
          const item = slotItems[slotIdx];
          if (!item) return null;
          const animStyle = slotStyles[slotIdx];
          if (slotIdx === 2) {
            // Centre slot — interactive. Pan drives the track,
            // tap fires the row-level callback.
            return (
              <GestureDetector key="center" gesture={Gesture.Race(tap, pan)}>
                <Animated.View style={[styles.cardSlot, slotSize, animStyle]}>
                  {renderCard(item)}
                </Animated.View>
              </GestureDetector>
            );
          }
          return (
            <Animated.View key={slotIdx} style={[styles.cardSlot, slotSize, animStyle]}>
              {renderCard(item)}
            </Animated.View>
          );
        })}
      </View>
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
// first paint, before the items fetch comes back. Three grey
// rects (left peek, right peek, centre with shimmer) matching
// the real CardStack's rest pose.
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
        {/* Peeks — same scale + tx as the real CardStack's rest pose. */}
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
    // Width / height come from the slotSize override (cardHeight
    // prop). marginBottom set inline scaled by peekScale so the
    // reserve below the deck stays proportional to the peek size.
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardSlot: {
    position: 'absolute',
    // Width / height set per-instance via slotSize.
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
