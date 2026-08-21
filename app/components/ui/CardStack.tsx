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

import { useState, useEffect, useMemo, useCallback, useRef, memo, type ReactNode } from 'react';
import { View, Text, StyleSheet, Image, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence,
  cancelAnimation,
  runOnJS,
  interpolate,
  Extrapolation,
  Easing,
  type SharedValue,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { R } from '../../constants/radius';
import { INK } from '../../constants/surface';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
import { popPressableEvent } from '../../utils/popOnTap';

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

// Confirmation focus — the deck's answer to "make this one the card".
// The centre card grows past TOP_SCALE while its neighbours slide off
// sideways and fade; reversing the phase walks every card straight
// back. All of it happens WITHOUT unmounting the deck, which is the
// whole point: the old flow swapped the deck for a lone static card
// and the confirmation appeared as a blink instead of as the card you
// tapped stepping forward.
//
// GROW lands the centre on scale 1.0 exactly — the size the lone
// active-quest card renders at — so when a confirmed search swaps the
// deck for that card, nothing on screen changes size. The first cut
// grew to 1.12 and the confirmation photo loomed bigger than the quest
// it became. LIFT is a nudge, not a move: the answers live in the top
// HUD, so the card has nothing at the bottom to clear.
const FOCUS_GROW = 0.12; // centre scale: TOP_SCALE 0.88 -> 1.0
const FOCUS_LIFT = 8;
const FOCUS_SPREAD = 1.8; // how much faster neighbours leave than they came
const FOCUS_MS = 420;

interface Props<T> {
  items: T[];
  renderCard: (item: T) => ReactNode;
  getId: (item: T) => string;
  onTap?: (item: T) => void;
  getPhotoUrl?: (item: T) => string | null | undefined;
  showCounter?: boolean;
  cardWidth?: number;
  cardHeight?: number;
  peekScale?: number;
  // Optional callback fired when the user taps the "N / M" counter.
  // Used by the spots tab to open a fullscreen list of the whole
  // category in big-card form. When provided, the counter renders
  // as a Pressable with a chevron hint; otherwise it's plain text.
  onCounterTap?: () => void;
  // Fired on each committed swipe (the carousel advances ±1) with the item
  // now centred (the new top card). Used to dismiss the swipe hint, and by the
  // search carousel to switch which lost dog is being tracked.
  onSwipe?: (item: T) => void;
  // Start the deck with THIS item's card on top instead of items[0].
  // Read once at mount (the deck mounts fresh per surface); unknown ids
  // fall back to 0, and later list churn keeps the reset-to-0 behavior.
  // Used by the search carousel when supersniff is entered already
  // committed to a dog (modal's "start search").
  initialId?: string;
  // Confirmation focus (see the FOCUS_* constants): true grows and
  // lifts the centre card while the neighbours slide off and fade, and
  // freezes the deck's gestures; false animates everything back. The
  // deck stays mounted throughout — that continuity IS the feature.
  focused?: boolean;
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
  focusPhase,
  step,
  slotSize,
  renderCard,
}: {
  item: T;
  virtualIdx: number;
  currentPos: SharedValue<number>;
  popPhase: SharedValue<number>;
  focusPhase: SharedValue<number>;
  step: number;
  slotSize: { width: number; height: number };
  renderCard: (item: T) => ReactNode;
}) {
  const animStyle = useAnimatedStyle(() => {
    const restTx = (virtualIdx - currentPos.value) * step;
    const baseScale = interpolate(
      restTx,
      [-2 * step, -step, 0, step, 2 * step],
      [OFF_SCALE, PEEK_SCALE, TOP_SCALE, PEEK_SCALE, OFF_SCALE],
      Extrapolation.CLAMP,
    );
    // zIndex follows distance-to-centre so the slot closest to 0
    // paints on top of the peeks during a swipe.
    const z = interpolate(
      Math.abs(restTx),
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
      Math.abs(restTx),
      [0, step * 0.5],
      [1, 0],
      Extrapolation.CLAMP,
    );
    const pop = centrality * popPhase.value;
    // Confirmation focus. Centrality decides each slot's role: the
    // centre grows and lifts, the peeks ride their own translate away
    // and thin out. One phase, every slot on it — which is what makes
    // cancel a perfect rewind.
    const f = focusPhase.value;
    const visualTx = restTx * (1 + FOCUS_SPREAD * f);
    const ty = -10 * pop - FOCUS_LIFT * centrality * f;
    const scale = baseScale * (1 + 0.04 * pop) + FOCUS_GROW * centrality * f;
    return {
      transform: [{ translateX: visualTx }, { translateY: ty }, { scale }],
      opacity: 1 - (1 - centrality) * f,
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
  cardWidth = CARD_W,
  cardHeight = CARD_H,
  peekScale = 1,
  onCounterTap,
  onSwipe,
  initialId,
  focused = false,
}: Props<T>) {
  // Mount-time anchor: index of initialId in the CURRENT items, or 0.
  // useState initializer (not an effect) so the first paint already has
  // the right card on top — no flash of items[0].
  const [initialIndex] = useState(() => {
    if (!initialId) return 0;
    const idx = items.findIndex((it) => getId(it) === initialId);
    return idx > 0 ? idx : 0;
  });
  // virtualBase = the carousel position as an integer index. Grows
  // without bound (we cycle via modulo when picking which item to
  // render at each virtualIdx). currentPos is the float version,
  // animates between integer values, drives the visual translate.
  const [virtualBase, setVirtualBase] = useState(initialIndex);
  const currentPos = useSharedValue(initialIndex);
  // Worklet-side mirror of virtualBase so the pan handler reads
  // the freshest value even when React hasn't re-rendered yet
  // (rare but possible if the user starts a new pan before
  // setVirtualBase commits).
  const virtualBaseSV = useSharedValue(initialIndex);
  // Drives the centre-card pop on every committed advance —
  // 0 at rest, jumps to 1 right after settle, then eases back
  // to 0. ItemSlot multiplies by per-item centrality so only
  // the new centre actually moves.
  const popPhase = useSharedValue(0);
  // Confirmation focus, eased both ways — see the FOCUS_* constants.
  const focusPhase = useSharedValue(0);
  useEffect(() => {
    focusPhase.value = withTiming(focused ? 1 : 0, {
      duration: FOCUS_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [focused, focusPhase]);
  // Snapshot of currentPos at touch-down. All subsequent
  // onUpdate deltas are applied to THIS, not to virtualBaseSV
  // directly — so if the user grabs the carousel mid-settle
  // (or a phantom touch event lands during settle from a fast
  // flick), the grab point doesn't jump back to the resting
  // base. This was the actual cause of "swipe fast → returns
  // to previous card": the second touch from a flick was
  // resetting currentPos to virtualBaseSV - 0 inside onUpdate.
  const dragStartPos = useSharedValue(0);

  // Carousel step — horizontal distance between adjacent slot
  // centres. Scales with cardWidth (290 at the default 320) so the
  // peek gap stays proportional at narrower widths instead of
  // collapsing. 290 with TOP_SCALE 0.88 + PEEK_SCALE 0.74 leaves a
  // ~31 px gap between the centre's right edge and the peek's left.
  const STEP = ((cardWidth * 290) / CARD_W) * peekScale;

  const ids = useMemo(() => items.map(getId).join(','), [items, getId]);
  const idsInitRef = useRef(true);

  const N = items.length;
  const topItemIndex = N > 0 ? ((virtualBase % N) + N) % N : 0;
  const topItem = N > 0 ? items[topItemIndex] : undefined;

  // FOLLOW THE CARD, DON'T RESET TO THE FIRST ONE.
  //
  // `ids` is the ORDERED id list, and these decks are sorted by distance
  // from a moving user. Two pets a few metres apart swap places on an
  // ordinary GPS tick — same pets, same count, different string — and the
  // old behaviour sent the deck back to card 0 for it. That is the "it
  // jumps back to the first dog" report: nothing had appeared or
  // disappeared, the list had merely been re-sorted underneath you.
  //
  // So instead of resetting, find the card that was on top and put it
  // back on top at its new index. A reorder becomes invisible, which is
  // what it should always have been. Only if that card genuinely left the
  // list do we fall back to the front.
  //
  // Declared BEFORE the tracker below on purpose: effects run in
  // declaration order, so this one still sees the PREVIOUS top card when
  // both fire on the same commit.
  const topIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    // Skips the mount run — effects fire after the first paint, and
    // re-anchoring there would clobber the initialId the state
    // initialised with.
    if (idsInitRef.current) {
      idsInitRef.current = false;
      return;
    }
    const wanted = topIdRef.current;
    const found = wanted == null ? -1 : items.findIndex((it) => getId(it) === wanted);
    const anchor = found >= 0 ? found : 0;
    // All three together: the integer state, the float the translate
    // animates from, and the worklet mirror the pan handler reads.
    setVirtualBase(anchor);
    currentPos.value = anchor;
    virtualBaseSV.value = anchor;
    // `items`/`getId` deliberately out of the deps: the store hands back a
    // fresh array every 15s sync, and depending on it would re-anchor on
    // every one of those. `ids` changes exactly when the contents do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  // Remember what is on top, for the next list change to aim at.
  useEffect(() => {
    topIdRef.current = topItem ? getId(topItem) : undefined;
  });

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
      // Report the item now centred (virtualBaseSV was set to the target
      // synchronously on the worklet before this runs, so it's the new base).
      if (onSwipe && N > 0) {
        const nb = Math.round(virtualBaseSV.value);
        const it = items[((nb % N) + N) % N];
        if (it !== undefined) onSwipe(it);
      }
    },
    [onSwipe, items, N, virtualBaseSV],
  );

  const handleTap = useCallback(() => {
    // Pop the centre card on tap — same Reanimated popPhase
    // mechanism used on settle, just kicked from the tap
    // handler. Each ItemSlot's animStyle reads popPhase and
    // scales the slot at visualTx≈0 (centre) by ~4 %.
    popPhase.value = 0;
    popPhase.value = withSequence(
      withTiming(1, { duration: 96, easing: Easing.bezier(0.22, 0.61, 0.36, 1) }),
      withTiming(0, { duration: 144, easing: Easing.bezier(0.33, 1, 0.68, 1) }),
    );
    if (topItem) onTap?.(topItem);
  }, [onTap, topItem, popPhase]);

  // Deck-level gestures — pan drives the carousel, tap fires for
  // any low-travel release. Peek taps also route to onTap(topItem);
  // simpler than per-slot hit-testing and matches carousel
  // expectations ("the centre card is what you interact with").
  // THE PAN freezes while focused: a deck that still swiped under the
  // confirmation's answers could change WHICH dog is centred out from
  // under the question being asked.
  //
  // The tap does not. It was frozen alongside the pan and did not need
  // to be — a tap moves nothing, so the question keeps its pet either
  // way. What it cost was the one card on screen during the question
  // being deaf, when the obvious thing to want from a photo of a lost
  // animal is to read what its owner wrote. The caller decides what a
  // tap means while focused; here it just still arrives.
  const tap = Gesture.Tap()
    .onEnd(() => {
      runOnJS(handleTap)();
    });

  const pan = Gesture.Pan()
    .enabled(!focused)
    // Horizontal / vertical gesture mediation so a carousel
    // can coexist with the tab's vertical scroll-snap container.
    //   activeOffsetX — claim the touch on >5 px horizontal
    //   failOffsetY   — release back to browser on >15 px
    //                   vertical (lets the page scroll)
    .activeOffsetX([-5, 5])
    .failOffsetY([-15, 15])
    .onBegin(() => {
      // Cancel any in-progress settle from the previous swipe.
      // Otherwise the withTiming on currentPos keeps running
      // alongside our finger-driven updates and the visual
      // ends up at whichever assignment fired last. Cancel's
      // completion callback receives finished=false so the
      // virtualBaseSV / advance() bump inside its `if(finished)`
      // guard is skipped — no double-advance.
      cancelAnimation(currentPos);
      // Snapshot where the carousel actually is at touch-down.
      // All onUpdate deltas are applied relative to THIS, not
      // to virtualBaseSV. That way the user can grab a card
      // mid-settle without it jumping back to the resting base.
      dragStartPos.value = currentPos.value;
    })
    .onUpdate((e) => {
      // 1:1 finger follow up to ±1 card-step from the drag
      // origin, then very-light rubber-band (0.08×) past
      // that. Hard clamp felt "blocky" — finger hitting an
      // invisible wall. 0.08 gives a barely-visible give
      // (250 px of overdrag → 6 px of overshoot ≈ 2 % of a
      // card-step) which lets the user feel the limit
      // without producing a perceptible bump-back on the
      // settle. Earlier 0.25× was too generous and that
      // overshoot was visible as backwards motion at the
      // end of a hard swipe.
      const desired = dragStartPos.value - e.translationX / STEP;
      const min = dragStartPos.value - 1;
      const max = dragStartPos.value + 1;
      if (desired > max) {
        currentPos.value = max + (desired - max) * 0.08;
      } else if (desired < min) {
        currentPos.value = min + (desired - min) * 0.08;
      } else {
        currentPos.value = desired;
      }
    })
    .onEnd((e) => {
      const travel = Math.abs(e.translationX) + Math.abs(e.translationY);
      // Intent-based commit: the projection (translation +
      // velocity × inertia) measures the FORCE / DIRECTION of
      // this gesture, regardless of where currentPos happens
      // to be. If the gesture's projected motion crosses 25 %
      // of a card-step in either direction, commit one card.
      //
      // Critically, this works for CHAINED swipes: each
      // gesture's commit is based purely on its own intent
      // and advances virtualBaseSV by ±1 from whatever value
      // virtualBaseSV currently holds. Previous logic used
      // `Math.round(dragStartPos + drag)` and lived in a world
      // where virtualBaseSV only updated AFTER the settle
      // completed — so a second swipe started before the first
      // settle was reading the OLD base and the projection
      // rounded back down to the same target. Two soft chained
      // forwards netted only +1 card. Now we update
      // virtualBaseSV synchronously on commit, and each
      // gesture's intent is what decides ±1.
      const projection = -e.translationX - e.velocityX * PROJECTION_MS;
      const projUnits = projection / STEP;
      let delta = 0;
      if (N > 1) {
        if (projUnits > COMMIT_RATIO) delta = 1;
        else if (projUnits < -COMMIT_RATIO) delta = -1;
      }
      const shouldCommit = delta !== 0;
      if (shouldCommit) {
        const target = virtualBaseSV.value + delta;
        // SYNCHRONOUS base update + JS-side advance — by the
        // next gesture's onEnd, virtualBaseSV is already at
        // the new value so a chained swipe accumulates
        // correctly.
        virtualBaseSV.value = target;
        runOnJS(advance)(delta);
        // Pop fires alongside the settle (same as before) so
        // the lift overlaps the slide.
        popPhase.value = 0;
        popPhase.value = withSequence(
          withTiming(1, { duration: 328, easing: Easing.bezier(0.22, 0.61, 0.36, 1) }),
          withTiming(0, { duration: 492, easing: Easing.bezier(0.33, 1, 0.68, 1) }),
        );
        currentPos.value = withTiming(target, {
          duration: SETTLE_MS,
          easing: SETTLE_EASE,
        });
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
    () => ({ width: cardWidth, height: cardHeight }),
    [cardWidth, cardHeight],
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
              focusPhase={focusPhase}
              step={STEP}
              slotSize={slotSize}
              renderCard={renderCard}
            />
          ))}
        </View>
      </GestureDetector>
      {showCounter ? (
        onCounterTap ? (
          <Pressable
            onPress={onCounterTap}
            onPressIn={popPressableEvent}
            hitSlop={12}
          >
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
              borderWidth: 2,
              borderColor: INK,
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
  // THE PLACEHOLDERS KEEP A PLAIN BORDER. Everything real in this app
  // draws its edge by hand now, and these deliberately do not: a
  // skeleton is a rectangle standing in for a card that has not
  // arrived, and giving it the drawn line — the thing that says "this
  // is a piece of paper somebody made" — would be the loading state
  // claiming to be the content.
  greyDeckCard: {
    backgroundColor: '#e6e6e6',
    borderRadius: R.card,
    borderWidth: 2,
    borderColor: INK,
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
  // Underlined, in ink. It used to be web-hyperlink blue, which made
  // it the only blue control left once the CTA pills went black and
  // white — and blue in this app means the map, not "tap here".
  counterLink: {
    color: INK,
    textDecorationLine: 'underline',
  },
  counterPressed: {
    opacity: 0.55,
  },
});
