// Generic Tinder-style swipeable card stack. One big card at a
// time, two grey peeks behind, a third fading-in buffer behind
// those. Forward swipe (left) cycles to the next item with the
// deck promoting up; backward swipe (right) cycles to the
// previous with the deck demoting (sinking) one position. Tap
// the top card to fire onTap. Both directions wrap.
//
// Used by:
//   - LostDogCardStack (NearbyLostDog items, photo cards)
//   - SpotCardStack    (Spot items, icon cards)
//   - profile.tsx      ({id, content} sections — heterogeneous)
//
// Built on react-native-reanimated v3 + gesture-handler v2. The
// deck-shift / advance / gesture mechanics moved here from
// LostDogCardStack after the third use case made the duplication
// hard to justify.

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
// Bumped 6 → 16 — the previous threshold was so tight that a normal
// finger-tap (which always wiggles a few px) registered as a swipe
// or got eaten by the pan handler. 16px combined travel still
// leaves the swipe commit (100px) plenty of headroom while making
// "tap the card" a forgiving target across the whole card area.
const TAP_TRAVEL_MAX = 16;

const FLY_OFF_MS = 320;
const SLIDE_IN_MS = 380;
const REVEAL_MS = 280;
const FLY_EASE = Easing.out(Easing.cubic);
const SLIDE_EASE = Easing.out(Easing.cubic);

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
  // is already decoded by the time the deck shifts and renders it.
  // Spots / profile sections skip this — no photos to prefetch.
  getPhotoUrl?: (item: T) => string | null | undefined;
  // Show the "1 / N" counter under the deck. Defaults to true.
  showCounter?: boolean;
  // Override the deck's height. Defaults to CARD_H (280). Lets
  // callers like the profile section deck use a denser slot when
  // the per-card content (stat rows) doesn't need the full height
  // of a photo/icon card. Width stays CARD_W.
  cardHeight?: number;
  // Multiplier on the peek ty offsets — < 1 tightens the stack
  // (peeks closer to the top card), > 1 spreads it out. Default
  // 1 keeps the calibration set against the default 280-tall
  // card. Smaller card heights want a smaller peek so the stack
  // doesn't dominate the card's footprint visually.
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
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);

  // Reset to start when the underlying list changes (e.g. the
  // screen refetches and the order shifts).
  const ids = useMemo(() => items.map(getId).join(','), [items, getId]);
  useEffect(() => {
    setIndex(0);
    tx.value = 0;
    ty.value = 0;
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

  // deckShift range [-1, 1]:
  //   forward drag (left, negative tx)  → positive (promote)
  //   backward drag (right, positive tx) → negative (demote)
  // Drives each slot's transform symmetrically across the range.
  const deckShift = useSharedValue(0);

  // Fade-in on the top slot after `advance` (in either direction).
  // 1 at rest, snaps to 0 inside advance, then ramps back to 1.
  const topAppearOpacity = useSharedValue(1);

  const advance = useCallback(
    (delta: number) => {
      setIndex((i) => {
        const n = items.length;
        if (n === 0) return 0;
        // Cycle in either direction.
        return ((i + delta) % n + n) % n;
      });
      requestAnimationFrame(() => {
        ty.value = 0;
        topAppearOpacity.value = 0;
        topAppearOpacity.value = withTiming(1, {
          duration: REVEAL_MS,
          easing: SLIDE_EASE,
        });
        // Always settle the deck back to rest. Forward came from +1
        // (promoted), backward from -1 (demoted) — same settle.
        deckShift.value = withTiming(0, {
          duration: REVEAL_MS,
          easing: SLIDE_EASE,
        });
        if (delta < 0) {
          // BACKWARD: top swings in from off-screen LEFT.
          tx.value = -(CARD_W + 100);
          tx.value = withTiming(0, { duration: SLIDE_IN_MS, easing: SLIDE_EASE });
        } else {
          tx.value = 0;
        }
      });
    },
    [items.length, tx, ty, topAppearOpacity, deckShift],
  );

  const handleTap = useCallback(
    (item: T) => {
      onTap?.(item);
    },
    [onTap],
  );

  const topItem = items[index];
  // Deck slot occupancy via modular indexing — cycling means the
  // deck stays full as long as there are at least N+1 items.
  const N = items.length;
  const next1 = N > 1 ? items[(index + 1) % N] : undefined;
  const next2 = N > 2 ? items[(index + 2) % N] : undefined;
  const next3 = N > 3 ? items[(index + 3) % N] : undefined;

  // Dedicated Tap gesture composed with Pan via Race — Pan's
  // onEnd-with-low-travel branch worked for finger drags that
  // released near the start point, but very short / still taps
  // sometimes got eaten because Pan needs a brief activation
  // window before any events fire. Race(Tap, Pan) lets a clean
  // tap commit immediately; any real movement defers to Pan.
  const tap = Gesture.Tap().onEnd(() => {
    if (topItem) runOnJS(handleTap)(topItem);
  });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      tx.value = e.translationX;
      ty.value = e.translationY * 0.3;
      const p = Math.min(Math.abs(e.translationX) / CARD_W, 1);
      if (e.translationX < 0) {
        deckShift.value = p;
      } else {
        deckShift.value = -p;
      }
    })
    .onEnd((e) => {
      const travel = Math.abs(e.translationX) + Math.abs(e.translationY);
      const passedPx = Math.abs(e.translationX) > SWIPE_COMMIT_PX;
      const passedVel = Math.abs(e.velocityX) > VELOCITY_COMMIT;
      if (travel < TAP_TRAVEL_MAX && topItem) {
        runOnJS(handleTap)(topItem);
        tx.value = withSpring(0);
        ty.value = withSpring(0);
        deckShift.value = withSpring(0);
        return;
      }
      if (passedPx || passedVel) {
        const isForward = e.translationX < 0;
        const dir = isForward ? -1 : 1;
        const delta = isForward ? 1 : -1;
        // Drive the deck to its commit-end pose over the fly-off
        // window — promoted (+1) on forward, demoted (-1) on
        // backward. `advance` then settles it back to 0.
        deckShift.value = withTiming(isForward ? 1 : -1, {
          duration: FLY_OFF_MS,
          easing: FLY_EASE,
        });
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
      }
    });

  // Top card transform + fade-in opacity.
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

  // Three-keyframe poses (demoted at -1, rest at 0, promoted at +1)
  // so each slot interpolates symmetrically across the forward /
  // backward range. Buffer also drives opacity (invisible at rest
  // and below, fades in only above 0 — backward doesn't reveal a
  // new bottom card, the deck just sinks).
  // Peek poses — ty values multiplied by peekScale so callers
  // with smaller cardHeights (profile) can tighten the stack
  // without affecting the photo-card stacks (tasks / spots).
  const SLOT_POSES = {
    middle: {
      demoted:  { scale: 0.85, ty: 75 * peekScale },
      rest:     { scale: 0.92, ty: 40 * peekScale },
      promoted: { scale: 1.0,  ty: 0 },
    },
    bottom: {
      demoted:  { scale: 0.78, ty: 110 * peekScale },
      rest:     { scale: 0.85, ty: 75 * peekScale },
      promoted: { scale: 0.92, ty: 40 * peekScale },
    },
    buffer: {
      demoted:  { scale: 0.72, ty: 145 * peekScale },
      rest:     { scale: 0.78, ty: 110 * peekScale },
      promoted: { scale: 0.85, ty: 75 * peekScale },
    },
  } as const;

  const middleStyle = useAnimatedStyle(() => {
    const s = interpolate(deckShift.value, [-1, 0, 1], [SLOT_POSES.middle.demoted.scale, SLOT_POSES.middle.rest.scale, SLOT_POSES.middle.promoted.scale]);
    const y = interpolate(deckShift.value, [-1, 0, 1], [SLOT_POSES.middle.demoted.ty, SLOT_POSES.middle.rest.ty, SLOT_POSES.middle.promoted.ty]);
    return { transform: [{ scale: s }, { translateY: y }] };
  });
  const bottomStyle = useAnimatedStyle(() => {
    const s = interpolate(deckShift.value, [-1, 0, 1], [SLOT_POSES.bottom.demoted.scale, SLOT_POSES.bottom.rest.scale, SLOT_POSES.bottom.promoted.scale]);
    const y = interpolate(deckShift.value, [-1, 0, 1], [SLOT_POSES.bottom.demoted.ty, SLOT_POSES.bottom.rest.ty, SLOT_POSES.bottom.promoted.ty]);
    return { transform: [{ scale: s }, { translateY: y }] };
  });
  const bufferStyle = useAnimatedStyle(() => {
    const s = interpolate(deckShift.value, [-1, 0, 1], [SLOT_POSES.buffer.demoted.scale, SLOT_POSES.buffer.rest.scale, SLOT_POSES.buffer.promoted.scale]);
    const y = interpolate(deckShift.value, [-1, 0, 1], [SLOT_POSES.buffer.demoted.ty, SLOT_POSES.buffer.rest.ty, SLOT_POSES.buffer.promoted.ty]);
    const o = interpolate(deckShift.value, [-1, 0, 1], [0, 0, 1], Extrapolation.CLAMP);
    return { transform: [{ scale: s }, { translateY: y }], opacity: o };
  });

  // Defensive — callers gate empty lists outside the stack.
  if (!topItem) return null;

  // Deck slots in deepest-first paint order: buffer → bottom →
  // middle → top. Each peek is a plain grey rectangle (no content)
  // so backward swipes never leak the next item's content through.
  // Deck container + slot heights come from the cardHeight prop so
  // the same component handles both the photo cards (280) and the
  // denser profile section cards (~200).
  const slotSize = { width: CARD_W, height: cardHeight };
  return (
    <View style={styles.wrap}>
      <View style={[styles.deck, slotSize, { marginBottom: 80 * peekScale }]}>
        {next3 ? (
          <Animated.View
            key="buffer"
            style={[styles.cardSlot, slotSize, styles.greyDeckCard, bufferStyle]}
          />
        ) : null}
        {next2 ? (
          <Animated.View
            key="bottom"
            style={[styles.cardSlot, slotSize, styles.greyDeckCard, bottomStyle]}
          />
        ) : null}
        {next1 ? (
          <Animated.View
            key="middle"
            style={[styles.cardSlot, slotSize, styles.greyDeckCard, middleStyle]}
          />
        ) : null}
        <GestureDetector gesture={Gesture.Race(tap, pan)}>
          <Animated.View style={[styles.cardSlot, slotSize, topStyle]}>
            {renderCard(topItem)}
          </Animated.View>
        </GestureDetector>
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
// first paint, before the items fetch comes back. Two stacked
// grey peeks + a top card with a shimmer-sweep gradient on
// repeat. Injects the shimmer keyframe once into <head>.
export function CardStackSkeleton({
  showCounter = true,
  cardHeight = CARD_H,
}: {
  showCounter?: boolean;
  cardHeight?: number;
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

  // Same slotSize pattern as the real CardStack — width / height
  // come from the cardHeight prop (default CARD_H = 280). Without
  // this the skeleton renders at 0×0 because styles.deck /
  // styles.cardSlot no longer carry dimensions.
  const slotSize = { width: CARD_W, height: cardHeight };

  return (
    <View style={styles.wrap}>
      <View style={[styles.deck, slotSize, { marginBottom: 80 }]}>
        <View
          style={[
            styles.cardSlot,
            slotSize,
            styles.greyDeckCard,
            { transform: [{ scale: 0.88 }, { translateY: 60 }] },
          ]}
        />
        <View
          style={[
            styles.cardSlot,
            slotSize,
            styles.greyDeckCard,
            { transform: [{ scale: 0.94 }, { translateY: 30 }] },
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
    // reserve-below-the-deck stays proportional to the peek size
    // — tighter peek (profile) gets less reserve, default peek
    // (tasks / spots) gets the full 80.
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
