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

  // Extra horizontal offset applied to BOTH peeks post-advance so
  // the freshly-rotated-in content slides in from off-screen
  // instead of blinking into existence at the centre. Applied as
  // +entryOffset on the right peek and -entryOffset on the left
  // (signed, so both visually slide outward → in). Snapped to a
  // large positive number right after the index swap, then timed
  // back to 0 over REVEAL_MS.
  const entryOffset = useSharedValue(0);

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
        // Snap the deck back to rest instantly — the visual
        // "slide-in" of the new peeks is driven by entryOffset
        // below so we don't get a half-frame of NEW peek content
        // at the centre slot before it slides out to rest.
        deckShift.value = 0;
        // Both peeks now hold their NEW content. Push them
        // outward past their rest positions so the new content
        // is off-screen, then time the offset back to 0 — peeks
        // visibly slide IN from the outside rather than blinking
        // into existence at the deck centre.
        entryOffset.value = 220;
        entryOffset.value = withTiming(0, {
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
    [items.length, tx, ty, topAppearOpacity, deckShift, entryOffset],
  );

  const handleTap = useCallback(
    (item: T) => {
      onTap?.(item);
    },
    [onTap],
  );

  const topItem = items[index];
  // Two-side carousel — one peek on each side of the top card.
  // Right peek = next item (slides left to center on forward
  // swipe). Left peek = previous item (slides right on backward
  // swipe). Skip the left peek when N === 2 since prev would
  // equal next and the two sides would show the same card,
  // looking weird.
  const N = items.length;
  const next1 = N > 1 ? items[(index + 1) % N] : undefined;
  const prev1 = N > 2 ? items[(index - 1 + N) % N] : undefined;

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
      // Pure horizontal — no vertical drift on swipe. Carousel
      // pattern, not Tinder. ty stays 0 the whole time.
      tx.value = e.translationX;
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
      } else {
        tx.value = withSpring(0);
        ty.value = withSpring(0);
        deckShift.value = withSpring(0);
      }
    });

  // Top card transform + fade-in opacity.
  // Top card — translate + scale only, no rotation, no
  // vertical drift. Carousel pattern: the centre card slides
  // horizontally and lives at a slightly smaller scale (0.90)
  // so there's visible margin between it and the side peeks.
  // The fly-off translate is driven by tx.value during the
  // pan / commit.
  const TOP_SCALE = 0.90;
  const topStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { translateX: tx.value },
        { scale: TOP_SCALE },
      ],
      opacity: topAppearOpacity.value,
    };
  });

  // Three-keyframe poses (demoted at -1, rest at 0, promoted at +1)
  // so each slot interpolates symmetrically across the forward /
  // backward range. Buffer also drives opacity (invisible at rest
  // and below, fades in only above 0 — backward doesn't reveal a
  // new bottom card, the deck just sinks).
  // Two-side carousel — full-size peeks on each side, only the
  // EDGE of the next / previous card visible past the top card.
  // Like SwiftUI's TabView page carousel. Visible strip width =
  // viewport_width - (deck_center + CARD_W/2) — about 20-50 px
  // depending on viewport.
  //   deckShift = +1 (forward complete) → right peek promotes
  //     to top (center), left peek slides off-screen left
  //   deckShift =  0 → both at rest, edges visible
  //   deckShift = -1 (backward complete) → left peek promotes
  //     to top, right peek slides off-screen right
  // Tighter peeks — small visible sliver only, leaving a clear
  // gap between the centre card and each side peek. Math: top
  // visual right edge = 144 (TOP_SCALE 0.90 × CARD_W/2). Peek
  // visual left edge = REST_TX − PEEK_REST_SCALE × CARD_W/2 =
  // 280 − 128 = 152 → ~8 px clean gap.
  const PEEK_REST_SCALE = 0.80;
  const REST_TX = 280 * peekScale;
  const OFF_TX = 340 * peekScale;
  // Promoted scale matches TOP_SCALE so the peek smoothly
  // becomes the new centre card without a visible size jump
  // when advance() swaps the index over.
  const SLOT_POSES = {
    right: {
      demoted:  { scale: 0.70, tx: OFF_TX },           // backward swipe → shrinks + off right
      rest:     { scale: PEEK_REST_SCALE, tx: REST_TX },
      promoted: { scale: TOP_SCALE, tx: 0 },           // forward swipe → becomes top
    },
    left: {
      demoted:  { scale: TOP_SCALE, tx: 0 },           // backward swipe → becomes top
      rest:     { scale: PEEK_REST_SCALE, tx: -REST_TX },
      promoted: { scale: 0.70, tx: -OFF_TX },          // forward swipe → shrinks + off left
    },
  } as const;

  const rightStyle = useAnimatedStyle(() => {
    const s = interpolate(deckShift.value, [-1, 0, 1], [SLOT_POSES.right.demoted.scale, SLOT_POSES.right.rest.scale, SLOT_POSES.right.promoted.scale]);
    const x = interpolate(deckShift.value, [-1, 0, 1], [SLOT_POSES.right.demoted.tx, SLOT_POSES.right.rest.tx, SLOT_POSES.right.promoted.tx]);
    // entryOffset slides the right peek IN from off-screen
    // right after advance() so the new content doesn't blink
    // into the centre. Positive value pushes further right.
    return { transform: [{ scale: s }, { translateX: x + entryOffset.value }] };
  });
  const leftStyle = useAnimatedStyle(() => {
    const s = interpolate(deckShift.value, [-1, 0, 1], [SLOT_POSES.left.demoted.scale, SLOT_POSES.left.rest.scale, SLOT_POSES.left.promoted.scale]);
    const x = interpolate(deckShift.value, [-1, 0, 1], [SLOT_POSES.left.demoted.tx, SLOT_POSES.left.rest.tx, SLOT_POSES.left.promoted.tx]);
    // Mirror — negative entryOffset slides the left peek IN
    // from off-screen left.
    return { transform: [{ scale: s }, { translateX: x - entryOffset.value }] };
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
      <View style={[styles.deck, slotSize, { marginBottom: 24 * peekScale }]}>
        {/* Left + right peeks render the actual prev / next card
            content (not grey rectangles) — user sees a sliver of
            the real upcoming photo / icon poking past the top
            card's edge. Paint behind the top via render order. */}
        {prev1 ? (
          <Animated.View key="left" style={[styles.cardSlot, slotSize, leftStyle]}>
            {renderCard(prev1)}
          </Animated.View>
        ) : null}
        {next1 ? (
          <Animated.View key="right" style={[styles.cardSlot, slotSize, rightStyle]}>
            {renderCard(next1)}
          </Animated.View>
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
      <View style={[styles.deck, slotSize, { marginBottom: 24 }]}>
        {/* Carousel-style skeleton — peeks scale 0.80 at ±280
            tx, matching the real CardStack rest poses. */}
        <View
          style={[
            styles.cardSlot,
            slotSize,
            styles.greyDeckCard,
            { transform: [{ scale: 0.80 }, { translateX: -280 }] },
          ]}
        />
        <View
          style={[
            styles.cardSlot,
            slotSize,
            styles.greyDeckCard,
            { transform: [{ scale: 0.80 }, { translateX: 280 }] },
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
              // Match TOP_SCALE in the real CardStack — 0.90.
              transform: [{ scale: 0.90 }],
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
