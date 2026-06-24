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

import { useState, useEffect, useMemo, useCallback, memo, type ReactNode } from 'react';
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
const TAP_TRAVEL_MAX = 16;
// Projection-based commit (iOS-style paged scroll). At onEnd we
// project where the swipe would naturally land if its release
// velocity decelerated over ~PROJECTION_MS ms — basically
// "if you let go, where does the carousel end up under inertia".
// Commit if that projected endpoint crosses COMMIT_RATIO * STEP
// from the start. Catches both heavy slow drags AND quick light
// flicks with one rule, without juggling separate px / velocity
// thresholds that always misclassified one or the other.
const PROJECTION_MS = 0.15;     // 150 ms of inertia, iOS-ish
const COMMIT_RATIO = 0.25;      // commit if projection > 25 % of a card-step

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
//
// Wrapped in React.memo so a CardStack re-render (which happens on
// every advance) doesn't re-run useAnimatedStyle for the four
// slots whose props haven't changed — just the newly-mounting
// far buffer rebuilds. Cuts the per-advance worklet upload cost
// down to a single slot.
function ItemSlotImpl<T>({
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

// `memo` keeps the generic — the cast preserves <T> inference at
// the call site (React.memo strips generics by default).
const ItemSlot = memo(ItemSlotImpl) as typeof ItemSlotImpl;

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

  // Pre-warm photos for upcoming items. On web we use
  // HTMLImageElement.decode() instead of RN's Image.prefetch:
  // decode() forces the browser to decode the bitmap off-main-
  // thread, so by the time the slot mounts the photo is GPU-ready
  // and the first paint of the new card doesn't stall on decode.
  // Native falls back to Image.prefetch (cache warm only — RN
  // doesn't expose a decode API).
  useEffect(() => {
    if (!getPhotoUrl || N === 0) return;
    const canDecode =
      typeof window !== 'undefined' &&
      typeof HTMLImageElement !== 'undefined' &&
      'decode' in HTMLImageElement.prototype;
    [1, 2, 3, 4, -1, -2].forEach((o) => {
      const idx = ((topItemIndex + o) % N + N) % N;
      const item = items[idx];
      if (!item) return;
      const url = getPhotoUrl(item);
      if (!url) return;
      if (canDecode) {
        const img = new window.Image();
        img.decoding = 'async';
        img.src = url;
        // .decode() returns a promise; both branches swallow —
        // best-effort prefetch, never user-facing.
        img.decode().catch(() => {
          /* swallow */
        });
      } else {
        Image.prefetch(url).catch(() => {
          /* swallow */
        });
      }
    });
  }, [topItemIndex, items, N, getPhotoUrl]);

  // Window of 5 items centred on virtualBase. Each entry carries
  // its virtualIdx (stable per item-in-position) and the resolved
  // item. Keyed by virtualIdx so React preserves the same DOM
  // node for persisting items across an advance.
  //
  // Named `slotWindow` (not `window`) so it doesn't shadow the
  // browser's global `window` — the prefetch effect above relies
  // on `new window.Image()` for the off-thread decode path.
  const slotWindow = useMemo(() => {
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
  // The pop animation is fired at the START of the settle (in
  // pan.onEnd) so it builds during the slide instead of starting
  // after — see the comment on the popPhase trigger there.
  const advance = useCallback(
    (delta: number) => {
      setVirtualBase((b) => b + delta);
    },
    [],
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
    // Activate on as little as 5 px of horizontal travel. The
    // gesture is racing the Tap, and gesture-handler's default
    // activation can be late enough on web that a quick flick
    // ends before Pan claims the touch — Tap wins, the flick is
    // misread as a tap, and the carousel springs back to the
    // same card. 5 px is well above incidental finger jitter
    // and well below TAP_TRAVEL_MAX so the two intents stay
    // mutually exclusive.
    .activeOffsetX([-5, 5])
    .onUpdate((e) => {
      // 1:1 finger follow: dragging by STEP pixels shifts the
      // carousel by exactly one card.
      currentPos.value = virtualBaseSV.value - e.translationX / STEP;
    })
    .onEnd((e) => {
      const travel = Math.abs(e.translationX) + Math.abs(e.translationY);
      // Project where the swipe would land if its release
      // velocity decelerated naturally over ~150 ms. This single
      // rule catches deliberate drags (translation dominates)
      // AND quick flicks (velocity dominates) without needing
      // separate px / velocity thresholds that always
      // misclassified one or the other. Direction comes from
      // the sign of the projection — so a flick that reversed
      // mid-gesture goes the way the finger was actually heading
      // at release.
      const projection = e.translationX + e.velocityX * PROJECTION_MS;
      const shouldCommit = N > 1 && Math.abs(projection) > STEP * COMMIT_RATIO;
      if (shouldCommit) {
        const isForward = projection < 0;
        const delta = isForward ? 1 : -1;
        const target = virtualBaseSV.value + delta;
        // Kick the pop NOW (alongside the settle) instead of
        // after — that way the lift + scale build during the
        // last leg of the slide and the pop feels like a
        // continuation of the snap, not a separate event after
        // it. Magnitudes scale by per-slot centrality so only
        // the slot currently arriving at the centre actually
        // rises; everything else stays put.
        popPhase.value = 0;
        popPhase.value = withSequence(
          withTiming(1, { duration: 328, easing: Easing.bezier(0.22, 0.61, 0.36, 1) }),
          withTiming(0, { duration: 492, easing: Easing.bezier(0.33, 1, 0.68, 1) }),
        );
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
        return;
      }
      // No commit and the finger barely moved → treat as a tap
      // on the centre card. Spring whatever drift currentPos
      // picked up back to rest.
      if (travel < TAP_TRAVEL_MAX) {
        runOnJS(handleTap)();
        currentPos.value = withSpring(virtualBaseSV.value);
        return;
      }
      // Real drag but not enough to commit → rebound.
      currentPos.value = withSpring(virtualBaseSV.value);
    });

  // Stable reference so the memoed ItemSlot doesn't see a "new"
  // slotSize object every render and discard the memo.
  const slotSize = useMemo(
    () => ({ width: CARD_W, height: cardHeight }),
    [cardHeight],
  );

  if (!topItem) return null;

  const counterIndex = topItemIndex + 1;

  return (
    <View style={styles.wrap}>
      <GestureDetector gesture={Gesture.Race(tap, pan)}>
        <View style={[styles.deck, slotSize, { marginBottom: 24 * peekScale }]}>
          {slotWindow.map(({ virtualIdx, item }) => (
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
    // Critical for web: tell the browser "vertical pan is yours
    // (scroll the snap container), horizontal pan is JS's
    // (carousel)". Without this, the browser's touch-action
    // default (`auto`) lets it claim fast horizontal flicks as
    // scroll candidates BEFORE gesture-handler can read them —
    // and no amount of activeOffset / threshold tuning on the
    // Pan gesture matters because the events never reach it.
    // This is the actual root cause of "swipe fast → returns
    // to previous card".
    touchAction: 'pan-y',
  } as unknown as object,
  deck: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardSlot: {
    position: 'absolute',
    // Web-only: promote each slot to its own compositing layer
    // so the per-frame transform / scale during a swipe is a
    // cheap GPU blit rather than a full repaint with shadow
    // re-rasterization. RN ignores this property on native;
    // browsers that don't support `will-change` ignore it too.
    willChange: 'transform, opacity',
  } as unknown as object,
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
