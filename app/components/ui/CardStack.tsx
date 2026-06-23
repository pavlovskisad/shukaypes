// Generic carousel card stack. The carousel position is a single
// shared value (`currentPos`) measured in card-steps; each rendered
// item has a stable `virtualIdx` and its visual translateX is
// derived as `(virtualIdx - currentPos) * STEP`. There is no
// "snap" on advance — the animation settles at currentPos =
// virtualBase + delta, then virtualBase catches up via setState.
// Persisting items keep the SAME virtualIdx across the advance,
// so the worklet doesn't have to be re-uploaded with a new offset
// and there's no React-vs-UI race that could glitch the position.
//
// Cycling: virtualBase grows / shrinks without bound; the item to
// render at each virtualIdx is `items[(virtualIdx mod N + N) mod N]`.
//
// Used by:
//   - LostDogCardStack (NearbyLostDog items, photo cards)
//   - SpotCardStack    (Spot items, icon cards)
//   - profile.tsx      ({id, content} sections — heterogeneous)
//
// Built on react-native-reanimated v3 + gesture-handler v2.

import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react';
import { View, Text, StyleSheet, Image, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence,
  runOnJS,
  interpolate,
  Extrapolation,
  Easing,
  type SharedValue,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { R } from '../../constants/radius';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';

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
  // Optional callback fired when the user taps the "N / M" counter.
  // Used by the spots tab to open a fullscreen list of the whole
  // category in big-card form. When provided, the counter renders
  // as a Pressable with a chevron hint; otherwise it's plain text.
  onCounterTap?: () => void;
}

// Per-item slot. `virtualIdx` is the item's stable position on the
// conceptual infinite carousel track; it does NOT change when the
// React index advances (persisting items keep the same virtualIdx,
// the window just shifts which items it includes). visualTx is
// driven purely by shared values, so position never races React.
function ItemSlot<T>({
  item,
  virtualIdx,
  currentPos,
  popPhase,
  step,
  slotSize,
  renderCard,
}: {
  item: T;
  virtualIdx: number;
  currentPos: SharedValue<number>;
  popPhase: SharedValue<number>;
  step: number;
  slotSize: { width: number; height: number };
  renderCard: (item: T) => ReactNode;
}) {
  const animStyle = useAnimatedStyle(() => {
    const visualTx = (virtualIdx - currentPos.value) * step;
    const baseScale = interpolate(
      visualTx,
      [-2 * step, -step, 0, step, 2 * step],
      [OFF_SCALE, PEEK_SCALE, TOP_SCALE, PEEK_SCALE, OFF_SCALE],
      Extrapolation.CLAMP,
    );
    // zIndex follows distance-to-centre so the slot closest to 0
    // paints on top of the peeks during a swipe.
    const z = interpolate(
      Math.abs(visualTx),
      [0, step, 2 * step],
      [3, 2, 1],
      Extrapolation.CLAMP,
    );
    // Pop on settle — the item closest to the centre gets a
    // brief lift + scale bump driven by popPhase (0 → 1 → 0
    // around the moment of advance). `centrality` falls off
    // quickly past STEP/2 so adjacent peeks barely participate.
    // Magnitudes (translateY -10, scale +4%) match the snap-pop
    // on the tab scroll cards so the two motions feel like the
    // same family.
    const centrality = interpolate(
      Math.abs(visualTx),
      [0, step * 0.5],
      [1, 0],
      Extrapolation.CLAMP,
    );
    const pop = centrality * popPhase.value;
    const ty = -10 * pop;
    const scale = baseScale * (1 + 0.04 * pop);
    return {
      transform: [{ translateX: visualTx }, { translateY: ty }, { scale }],
      zIndex: z,
    };
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
  onCounterTap,
}: Props<T>) {
  // virtualBase = the carousel position as an integer index. Grows
  // without bound (we cycle via modulo when picking which item to
  // render at each virtualIdx). currentPos is the float version,
  // animates between integer values, drives the visual translate.
  const [virtualBase, setVirtualBase] = useState(0);
  const currentPos = useSharedValue(0);
  // Worklet-side mirror of virtualBase so the pan handler reads
  // the freshest value even when React hasn't re-rendered yet
  // (rare but possible if the user starts a new pan before
  // setVirtualBase commits).
  const virtualBaseSV = useSharedValue(0);
  // Drives the centre-card pop on every committed advance —
  // 0 at rest, jumps to 1 right after settle, then eases back
  // to 0. ItemSlot multiplies by per-item centrality so only
  // the new centre actually moves.
  const popPhase = useSharedValue(0);

  // Carousel step — horizontal distance between adjacent slot
  // centres. 290 with TOP_SCALE 0.88 + PEEK_SCALE 0.74 leaves a
  // ~31 px gap between the centre's right edge and the peek's
  // left edge.
  const STEP = 290 * peekScale;

  // Reset when the underlying list changes.
  const ids = useMemo(() => items.map(getId).join(','), [items, getId]);
  useEffect(() => {
    setVirtualBase(0);
    currentPos.value = 0;
    virtualBaseSV.value = 0;
  }, [ids]);

  const N = items.length;
  const topItemIndex = N > 0 ? ((virtualBase % N) + N) % N : 0;
  const topItem = N > 0 ? items[topItemIndex] : undefined;

  // Pre-warm photos for upcoming items.
  useEffect(() => {
    if (!getPhotoUrl || N === 0) return;
    [1, 2, 3, 4, -1, -2].forEach((o) => {
      const idx = ((topItemIndex + o) % N + N) % N;
      const item = items[idx];
      if (!item) return;
      const url = getPhotoUrl(item);
      if (url) {
        Image.prefetch(url).catch(() => {
          /* swallow — best-effort */
        });
      }
    });
  }, [topItemIndex, items, N, getPhotoUrl]);

  // Window of 5 items centred on virtualBase. Each entry carries
  // its virtualIdx (stable per item-in-position) and the resolved
  // item. Keyed by virtualIdx so React preserves the same DOM
  // node for persisting items across an advance.
  const window = useMemo(() => {
    if (N === 0) return [];
    return [-2, -1, 0, 1, 2].map((offset) => {
      const virtualIdx = virtualBase + offset;
      const item = items[((virtualIdx % N) + N) % N];
      return { virtualIdx, item };
    });
  }, [virtualBase, items, N]);

  // Advance React-side virtualBase after the carousel has visually
  // settled at the new position. currentPos is already at the new
  // integer, virtualBaseSV is already updated (worklet did that),
  // so this is just React catching up — no visual change occurs.
  // Also kicks the pop animation so the freshly-settled centre
  // card lifts + scales briefly. Timing + bezier curves match the
  // snap-pop on the tab scroll cards (820 ms total, peak at 40 %,
  // soft ease-out on the rise / smoother ease-out on the settle)
  // so the two motions feel like the same family.
  const advance = useCallback(
    (delta: number) => {
      setVirtualBase((b) => b + delta);
      popPhase.value = 0;
      popPhase.value = withSequence(
        withTiming(1, { duration: 328, easing: Easing.bezier(0.22, 0.61, 0.36, 1) }),
        withTiming(0, { duration: 492, easing: Easing.bezier(0.33, 1, 0.68, 1) }),
      );
    },
    [popPhase],
  );

  const handleTap = useCallback(() => {
    if (topItem) onTap?.(topItem);
  }, [onTap, topItem]);

  // Deck-level gestures — pan drives the carousel, tap fires for
  // any low-travel release. Peek taps also route to onTap(topItem);
  // simpler than per-slot hit-testing and matches carousel
  // expectations ("the centre card is what you interact with").
  const tap = Gesture.Tap().onEnd(() => {
    runOnJS(handleTap)();
  });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      // 1:1 finger follow: dragging by STEP pixels shifts the
      // carousel by exactly one card.
      currentPos.value = virtualBaseSV.value - e.translationX / STEP;
    })
    .onEnd((e) => {
      const travel = Math.abs(e.translationX) + Math.abs(e.translationY);
      const passedPx = Math.abs(e.translationX) > SWIPE_COMMIT_PX;
      const passedVel = Math.abs(e.velocityX) > VELOCITY_COMMIT;
      if (travel < TAP_TRAVEL_MAX) {
        runOnJS(handleTap)();
        currentPos.value = withSpring(virtualBaseSV.value);
        return;
      }
      if (N > 1 && (passedPx || passedVel)) {
        const isForward = e.translationX < 0;
        const delta = isForward ? 1 : -1;
        const target = virtualBaseSV.value + delta;
        currentPos.value = withTiming(
          target,
          { duration: SETTLE_MS, easing: SETTLE_EASE },
          (finished) => {
            if (finished) {
              // Bump the worklet-side base immediately so a
              // back-to-back pan reads the right value, then ask
              // React to catch up.
              virtualBaseSV.value = target;
              runOnJS(advance)(delta);
            }
          },
        );
      } else {
        currentPos.value = withSpring(virtualBaseSV.value);
      }
    });

  if (!topItem) return null;

  const slotSize = { width: CARD_W, height: cardHeight };
  const counterIndex = topItemIndex + 1;

  return (
    <View style={styles.wrap}>
      <GestureDetector gesture={Gesture.Race(tap, pan)}>
        <View style={[styles.deck, slotSize, { marginBottom: 24 * peekScale }]}>
          {window.map(({ virtualIdx, item }) => (
            <ItemSlot
              key={virtualIdx}
              item={item}
              virtualIdx={virtualIdx}
              currentPos={currentPos}
              popPhase={popPhase}
              step={STEP}
              slotSize={slotSize}
              renderCard={renderCard}
            />
          ))}
        </View>
      </GestureDetector>
      {showCounter ? (
        onCounterTap ? (
          <Pressable onPress={onCounterTap} hitSlop={12}>
            {({ pressed }) => (
              <Text style={[styles.counter, styles.counterLink, pressed && styles.counterPressed]}>
                {counterIndex} / {items.length}
              </Text>
            )}
          </Pressable>
        ) : (
          <Text style={styles.counter}>
            {counterIndex} / {items.length}
          </Text>
        )
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
              borderRadius: R.card,
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
    paddingVertical: S.s,
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
    borderRadius: R.card,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 2,
  },
  counter: {
    fontSize: TYPE.small,
    color: '#777',
    fontWeight: '600',
  },
  // Classic web hyperlink — same blue + underline used in the
  // rest of the app (xp bars, sniff toggle, chat accent).
  counterLink: {
    color: 'rgba(0,60,255,0.85)',
    textDecorationLine: 'underline',
  },
  counterPressed: {
    opacity: 0.55,
  },
});
