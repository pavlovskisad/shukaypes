// Tinder-style swipeable card stack for lost pets. One big card at a
// time, two behind it peeking, swipe left/right to cycle through the
// nearby pets. Tap the top card to open the existing LostDogModal —
// the action sheet logic stays unchanged.
//
// Built on react-native-reanimated (3.x) + gesture-handler (2.x).
// Pan gesture drives translation + rotation; release past
// SWIPE_COMMIT_PX (or any decent velocity) flies the card off-screen
// and advances the index. Otherwise it springs back. A short release
// with little travel is treated as a tap and forwards to onTap.
//
// Prototype scope: just lost pets on the tasks tab, behind a toggle.
// If the feel lands, the same shape can drop into spots / profile.

import { useState, useEffect, useMemo, useCallback } from 'react';
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
import type { NearbyLostDog } from '../../services/api';
import { colors } from '../../constants/colors';
import { SYSTEM_FONT } from '../../constants/fonts';
import { useStrings } from '../../i18n/useStrings';

const CARD_W = 320;
// Dropped from 420 → 320 → 280 as the lost-pets card kept
// eating too much of the viewport in Safari iOS, leaving the
// daily-quests title invisible in the bottom peek. 280 is a
// bit shorter than wide and still reads clearly for the photo.
const CARD_H = 280;
const SWIPE_COMMIT_PX = 100;
const VELOCITY_COMMIT = 600;
const TAP_TRAVEL_MAX = 6;

// Animation timings. Bumped from the first prototype's snappier
// 220ms to a calmer 320-380ms range — the user wanted "smoother /
// slower" through the deck and the cubic ease keeps it from
// feeling sluggish (most of the motion lands quickly, the tail
// glides into place).
const FLY_OFF_MS = 320;
const SLIDE_IN_MS = 380;
const REVEAL_MS = 280;
const FLY_EASE = Easing.out(Easing.cubic);
const SLIDE_EASE = Easing.out(Easing.cubic);

interface Props {
  dogs: NearbyLostDog[];
  onTap: (dog: NearbyLostDog) => void;
}

export function LostDogCardStack({ dogs, onTap }: Props) {
  const t = useStrings();
  const [index, setIndex] = useState(0);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);

  // Reset to start of the deck when the underlying list changes (e.g.
  // the screen refetches and the order shifts).
  const dogIds = useMemo(() => dogs.map((d) => d.id).join(','), [dogs]);
  useEffect(() => {
    setIndex(0);
    tx.value = 0;
    ty.value = 0;
  }, [dogIds]);

  // Pre-warm the next few photos so they're already decoded by the
  // time the deck shifts and they need to render. Browser caches by
  // URL; Image.prefetch hands it the URL and the decoder picks up.
  useEffect(() => {
    const upcoming = [
      // Forward — what's next in the deck.
      dogs[index + 1],
      dogs[index + 2],
      dogs[index + 3],
      dogs[index + 4],
      // Backward — already-visited dogs the user might swipe back to.
      dogs[index - 1],
      dogs[index - 2],
    ];
    upcoming.forEach((d) => {
      if (d?.photoUrl) {
        Image.prefetch(d.photoUrl).catch(() => {
          /* swallow — best-effort */
        });
      }
    });
  }, [index, dogs]);

  // Deck-shift progress: drives the four deck slots from their rest
  // pose (peek positions behind the top) to their PROMOTED pose
  // (each card one step closer to the top). The 4th slot is
  // invisible at rest and fades into the third's peek position as
  // the shift progresses, so the deck always reads as having a
  // "next" card behind. After a forward commit the value retreats
  // 1 → 0 in lockstep with the new top's fade-in, so the deck
  // visibly settles back into the stack rather than snapping.
  const deckShift = useSharedValue(0);

  // Drives a quick fade-in on the top slot after `advance` (in
  // either direction). 1 at rest, snaps to 0 inside advance, then
  // ramps back to 1.
  const topAppearOpacity = useSharedValue(1);

  // Kept for backward-compat with the spring-back in pan.onEnd —
  // referenced but not visually consumed anywhere now.
  const revealProgress = useSharedValue(0);

  const advance = useCallback(
    (delta: number) => {
      setIndex((i) => {
        const n = dogs.length;
        if (n === 0) return 0;
        // Cycle on overflow in either direction (swipe past the end
        // wraps to the start; swipe back past 0 wraps to the end).
        // No more "end of deck" empty state — the deck just keeps
        // going.
        return ((i + delta) % n + n) % n;
      });
      requestAnimationFrame(() => {
        ty.value = 0;
        revealProgress.value = 0;
        topAppearOpacity.value = 0;
        topAppearOpacity.value = withTiming(1, {
          duration: REVEAL_MS,
          easing: SLIDE_EASE,
        });
        // Always settle the deck back to rest (deckShift=0). Forward
        // came from +1 (promoted), backward came from -1 (demoted) —
        // same settle either way.
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
    [dogs.length, tx, ty, revealProgress, topAppearOpacity, deckShift],
  );

  const handleTap = useCallback(
    (dog: NearbyLostDog) => {
      onTap(dog);
    },
    [onTap],
  );

  const topDog = dogs[index];
  // Deck slot occupancy via modular indexing — cycling means the
  // deck always stays full as long as there are at least N+1 dogs
  // (1 for top + 1 per visible slot). next1 = render middle slot,
  // next2 = bottom slot, next3 = buffer slot.
  const N = dogs.length;
  const next1 = N > 1 ? dogs[(index + 1) % N] : undefined;
  const next2 = N > 2 ? dogs[(index + 2) % N] : undefined;
  const next3 = N > 3 ? dogs[(index + 3) % N] : undefined;

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      tx.value = e.translationX;
      ty.value = e.translationY * 0.3;
      // deckShift range is [-1, 1]:
      //   forward drag (left, negative tx)  → positive (promote)
      //   backward drag (right, positive tx) → negative (demote)
      // Each slot's animated style interpolates across the full
      // range so the deck visibly promotes on forward AND demotes
      // (cards sink one position deeper) on backward.
      const p = Math.min(Math.abs(e.translationX) / CARD_W, 1);
      if (e.translationX < 0) {
        deckShift.value = p;
        revealProgress.value = p;
      } else {
        deckShift.value = -p;
        revealProgress.value = 0;
      }
    })
    .onEnd((e) => {
      const travel = Math.abs(e.translationX) + Math.abs(e.translationY);
      const passedPx = Math.abs(e.translationX) > SWIPE_COMMIT_PX;
      const passedVel = Math.abs(e.velocityX) > VELOCITY_COMMIT;
      if (travel < TAP_TRAVEL_MAX && topDog) {
        // Treat as a tap — no real travel, no swipe.
        runOnJS(handleTap)(topDog);
        tx.value = withSpring(0);
        ty.value = withSpring(0);
        deckShift.value = withSpring(0);
        revealProgress.value = withSpring(0);
        return;
      }
      if (passedPx || passedVel) {
        // Carousel convention: swipe LEFT → forward, swipe RIGHT →
        // backward. The card flies in the drag direction either way.
        // Both directions cycle (no clamp at 0 — wraps to the end).
        const isForward = e.translationX < 0;
        const dir = isForward ? -1 : 1;
        const delta = isForward ? 1 : -1;
        // Drive the deck to its commit-end pose over the fly-off
        // window — promoted (+1) on forward, demoted (-1) on
        // backward. `advance` then settles deckShift back to 0
        // in lockstep with the new top arriving.
        deckShift.value = withTiming(isForward ? 1 : -1, {
          duration: FLY_OFF_MS,
          easing: FLY_EASE,
        });
        if (isForward) {
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
        // No commit — spring everything back to rest.
        tx.value = withSpring(0);
        ty.value = withSpring(0);
        deckShift.value = withSpring(0);
        revealProgress.value = withSpring(0);
      }
    });

  // Top card: full pan-driven transform + a fade-in opacity that
  // ramps after each `advance`. Drag rotation maxes ±12° at ±200px.
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

  // Deck slot poses — each slot has THREE keyframe poses:
  //   demoted  (deckShift = -1): one step deeper into the stack
  //   rest     (deckShift =  0): natural peek position
  //   promoted (deckShift = +1): one step closer to the top
  // The buffer also drives opacity (invisible at rest + below,
  // fades in above 0). Slot styles interpolate over the full
  // [-1, 0, 1] range so forward swipes promote the deck and
  // backward swipes demote it — mirror animations on both sides.
  const SLOT_POSES = {
    middle: {
      demoted:  { scale: 0.88, ty: 60 },
      rest:     { scale: 0.94, ty: 30 },
      promoted: { scale: 1.0,  ty: 0  },
    },
    bottom: {
      demoted:  { scale: 0.82, ty: 90 },
      rest:     { scale: 0.88, ty: 60 },
      promoted: { scale: 0.94, ty: 30 },
    },
    buffer: {
      demoted:  { scale: 0.76, ty: 120 },
      rest:     { scale: 0.82, ty: 90 },
      promoted: { scale: 0.88, ty: 60 },
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
    // Buffer fades in only on forward (positive shift). At rest
    // and on backward it stays invisible — backward doesn't reveal
    // a new bottom card, the deck just sinks.
    const o = interpolate(deckShift.value, [-1, 0, 1], [0, 0, 1], Extrapolation.CLAMP);
    return { transform: [{ scale: s }, { translateY: y }], opacity: o };
  });

  // Defensive only — the parent hides the card frame when
  // dogs.length === 0, and forward / backward swipes cycle so
  // we never actually exhaust the deck.
  if (!topDog) return null;

  // Deck slots in deepest-first paint order: buffer → bottom →
  // middle → top. Each is a plain grey rectangle (no photo, no
  // content) so backward swipes never leak the next dog's image
  // through. Slots are mounted only when there's a corresponding
  // upcoming dog so the deck visibly thins at the end of the list
  // (last card has no buffer behind it).
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
            {renderCard(topDog, t)}
          </Animated.View>
        </GestureDetector>
      </View>
      <Text style={styles.counter}>
        {index + 1} / {dogs.length}
      </Text>
    </View>
  );
}

// Single-card render. Photo full-bleed top half, dark-to-transparent
// gradient mask carrying name + meta over the bottom of the photo.
// Urgency badge top-left. No photo → soft grey card with the emoji
// centered.
function renderCard(dog: NearbyLostDog, t: ReturnType<typeof useStrings>) {
  const urgent = dog.urgency === 'urgent';
  const badgeText = urgent ? t.tasks.badgeUrgent : t.tasks.badgeSearching;
  const badgeFg = urgent ? '#e84040' : '#d9a030';
  return (
    <View style={styles.card}>
      {dog.photoUrl ? (
        <Image source={{ uri: dog.photoUrl }} style={styles.photo} resizeMode="cover" />
      ) : (
        <View style={[styles.photo, styles.photoFallback]}>
          <Text style={styles.photoEmoji}>{dog.emoji ?? '🐶'}</Text>
        </View>
      )}
      {/* Gradient overlay (CSS linear-gradient on web; passthrough on
          native since RN doesn't ship LinearGradient OOTB). */}
      <View style={styles.gradient} />
      <View style={[styles.badge, { borderColor: 'rgba(0,0,0,0.05)' }]}>
        <Text style={[styles.badgeText, { color: badgeFg }]}>{badgeText}</Text>
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardName} numberOfLines={1}>
          {dog.name}
        </Text>
        {dog.breed ? (
          <Text style={styles.cardMeta} numberOfLines={1}>
            {dog.breed}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// Skeleton variant of the card stack — same dimensions + deck
// layout as the real one so the lost-pets card can render with
// stable height from the very first paint, before the lostDogs
// fetch comes back. Shows two stacked grey rectangles + a top
// card with a shimmer-sweep gradient on repeat. Sits in place
// of <LostDogCardStack> while sortedDogs is empty so the snap
// order stays consistent (no late insertion shoves the daily-
// quests card down once dogs arrive).
export function LostDogCardStackSkeleton() {
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
        {/* Bottom and middle deck slots — plain grey rectangles
            matching the real deck's rest poses (see SLOT_POSES). */}
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
        {/* Top card — grey base + sweeping light gradient via CSS
            animation. Inline backgroundImage + animation since
            RN style typings don't know about them; the runtime
            forwards them straight through to the underlying div. */}
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
      {/* Placeholder counter so the card's total height matches the
          real stack's — keeps the snap target the same size before
          and after data loads. */}
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
    // Reserve room for the bottom card's peek (ty:60 + card-bottom
    // tail) AND breathing room before the counter — was 26, felt
    // glued to the deck. Bumping it also keeps the counter from
    // getting clipped when the next card snaps in over the top.
    marginBottom: 50,
  },
  cardSlot: {
    position: 'absolute',
    width: CARD_W,
    height: CARD_H,
  },
  // Deck slot — plain grey rounded rectangle, no content. Three
  // of these stack behind the top card at fixed peek poses. The
  // shadow is softer than the top card's so the deck reads as
  // "background paper", not floating discs competing with the
  // active card.
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
  photo: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    backgroundColor: '#f0f0f0',
    // RN-Web's `overflow: hidden` on a transformed parent doesn't
    // always clip child <img> tags cleanly — visible as harsh
    // corners at the top of the photo. Match the card's borderRadius
    // on the image itself so it self-clips regardless of parent.
    borderRadius: 24,
  },
  photoFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoEmoji: {
    fontSize: 120,
    opacity: 0.6,
  },
  gradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '50%',
    // RN-Web passes `backgroundImage` straight through to CSS — RN
    // style typings don't know about it but the runtime is happy.
    backgroundImage:
      'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.05) 35%, rgba(0,0,0,0.65) 100%)',
  } as unknown as object,
  badge: {
    position: 'absolute',
    top: 14,
    left: 14,
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 2,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'lowercase',
    letterSpacing: 0.4,
  },
  cardBody: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 18,
  },
  cardName: {
    fontFamily: SYSTEM_FONT,
    fontSize: 28,
    fontWeight: '800',
    color: '#ffffff',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  cardMeta: {
    fontFamily: SYSTEM_FONT,
    fontSize: 14,
    color: 'rgba(255,255,255,0.92)',
    marginTop: 4,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  counter: {
    fontSize: 13,
    color: '#777',
    fontWeight: '600',
  },
});
