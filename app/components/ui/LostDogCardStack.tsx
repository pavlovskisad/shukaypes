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
import { View, Text, StyleSheet, Pressable, Image } from 'react-native';
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
const CARD_H = 420;
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

  // Reveal progress for the deck overlay (the grey placeholder on
  // middle / bottom / ghost). Decoupled from `tx` so a backward
  // slide-in (which uses negative tx as the slot animates back from
  // off-screen-left) doesn't accidentally reveal the deck content.
  //   - forward drag (tx < 0): driven by drag distance — overlay
  //     fades smoothly as the user pulls.
  //   - backward drag (tx > 0): stays at 0 — deck stays grey.
  //   - aborted gestures: spring back to 0.
  //   - forward commit: snaps to 0 inside `advance` (along with
  //     the rest of the state) so the new middle is covered.
  const revealProgress = useSharedValue(0);

  const advance = useCallback(
    (delta: number) => {
      setIndex((i) => Math.max(0, i + delta));
      // Defer the transform reset to the NEXT animation frame so React
      // commits the index change first — otherwise the transform
      // snaps before the slot's photo src updates, briefly showing
      // the old dog at centre.
      requestAnimationFrame(() => {
        ty.value = 0;
        // Reset reveal to 0 either way: forward commit just rolled
        // the deck → the new middle/bottom/ghost should be back
        // under their grey covers. Backward never lifted them in
        // the first place.
        revealProgress.value = 0;
        if (delta < 0) {
          // BACKWARD: teleport the top slot to off-screen LEFT (the
          // OPPOSITE side of where the old top flew to), then animate
          // it back to centre — the previous dog "swings in" from
          // the left, mirroring the "going back" intent.
          tx.value = -(CARD_W + 100);
          tx.value = withTiming(0, { duration: SLIDE_IN_MS, easing: SLIDE_EASE });
        } else {
          // FORWARD: deck shift already played during the pan, snap
          // tx back to centre.
          tx.value = 0;
        }
      });
    },
    [tx, ty, revealProgress],
  );

  // Index mirrored as a shared value so the worklet can read it
  // synchronously when deciding whether a backward swipe is allowed
  // (clamped at 0 → spring back instead of letting the card commit).
  const indexSV = useSharedValue(index);
  useEffect(() => {
    indexSV.value = index;
  }, [index, indexSV]);

  const handleTap = useCallback(
    (dog: NearbyLostDog) => {
      onTap(dog);
    },
    [onTap],
  );

  const topDog = dogs[index];
  const next1 = dogs[index + 1];
  const next2 = dogs[index + 2];
  // Hidden "ghost" at index+3 — pre-rendered so when the top card
  // flies off and the deck shifts forward, the new bottom slot
  // already has content in place. Without this, the new bottom
  // pops into view on every advance (the "blink"). Ghost animates
  // from opacity 0 + small scale → bottom-slot pose as the top
  // card is dragged, so by commit it IS the new bottom — visually
  // continuous, no jump.
  const next3 = dogs[index + 3];

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      tx.value = e.translationX;
      ty.value = e.translationY * 0.3;
      // Forward drag (left, negative tx) lifts the grey overlay on
      // the deck cards — the next dog's photo reveals as the user
      // pulls. Backward drag leaves the deck alone (it stays grey).
      if (e.translationX < 0) {
        revealProgress.value = Math.min(Math.abs(e.translationX) / CARD_W, 1);
      } else {
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
        revealProgress.value = withSpring(0);
        return;
      }
      if (passedPx || passedVel) {
        // Carousel convention: swipe LEFT → forward (next dog),
        // swipe RIGHT → backward (previous dog). The card flies in
        // the drag direction either way. On a backward swipe while
        // already at the start of the deck, spring back instead of
        // committing (no dog before index 0).
        const isForward = e.translationX < 0;
        if (!isForward && indexSV.value === 0) {
          tx.value = withSpring(0);
          ty.value = withSpring(0);
          return;
        }
        const dir = isForward ? -1 : 1;
        const delta = isForward ? 1 : -1;
        // Forward commit: keep reveal at 1 through the fly-off so
        // the deck stays revealed under the leaving top card; it
        // snaps back to 0 inside `advance` once index has moved.
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
        // No commit — spring back, restore deck cover.
        tx.value = withSpring(0);
        ty.value = withSpring(0);
        revealProgress.value = withSpring(0);
      }
    });

  // Top card: full pan-driven transform. NOT fading the opacity on
  // exit on purpose — the slot's content swaps during the deck
  // advance, and any opacity change in the same frame as the swap
  // looks like a flash. Keeping opacity at 1 throughout means the
  // only thing changing visually on advance is the photo src, and
  // the rAF defer in `advance` makes that happen before the
  // transform resets.
  const topStyle = useAnimatedStyle(() => {
    const rotate = interpolate(tx.value, [-200, 0, 200], [-12, 0, 12], Extrapolation.CLAMP);
    return {
      transform: [
        { translateX: tx.value },
        { translateY: ty.value },
        { rotate: `${rotate}deg` },
      ],
    };
  });

  // Deck-shift progress: only animates on FORWARD swipes (left,
  // negative tx). Backward (right) swipes go to the previous dog
  // and the deck doesn't actually shift forward — so the middle /
  // bottom / ghost shouldn't false-promote during that gesture.
  // Reads tx.value once per worklet run, clamps non-forward to 0.
  function forwardProgress(t: number): number {
    'worklet';
    if (t >= 0) return 0;
    return Math.min(Math.abs(t) / CARD_W, 1);
  }

  // Deck-card grey-cover opacity. At rest the cover is FULLY opaque
  // so the deck slots read as plain grey rectangles — no peek of
  // the real photos behind. Critical for the backward-swipe case:
  // when the index decrements, the deck slots' content shifts down
  // (new middle = old top, etc.) — if the cover were translucent
  // we'd briefly see the OLD top photo through the new middle.
  // Opaque cover hides it entirely.
  //
  // Reveal curve: longer initial delay (0 → 0.35 of progress holds
  // at full opacity) so the cover doesn't move with the user's
  // first few pixels of drag; then a smooth roll to 0 over the
  // remainder. Feels deliberate.
  const REST_OVERLAY = 1;
  function overlayOpacity(reveal: number): number {
    'worklet';
    return interpolate(reveal, [0, 0.35, 1], [REST_OVERLAY, REST_OVERLAY, 0], Extrapolation.CLAMP);
  }

  // Second card pops forward as the top card flies away. Tighter
  // base scale + bigger peek so the deck reads as a deck, not a
  // single floating card.
  const middleStyle = useAnimatedStyle(() => {
    const progress = forwardProgress(tx.value);
    const scale = interpolate(progress, [0, 1], [0.92, 1], Extrapolation.CLAMP);
    const translateY = interpolate(progress, [0, 1], [22, 0], Extrapolation.CLAMP);
    return { transform: [{ scale }, { translateY }] };
  });
  const middleOverlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity(revealProgress.value),
  }));

  // Third card stays mostly still; bigger offset so the third-tier
  // peek is visible too. (Two visible cards behind reads as "more
  // to come", one was ambiguous.)
  const bottomStyle = useAnimatedStyle(() => {
    const progress = forwardProgress(tx.value);
    const scale = interpolate(progress, [0, 1], [0.84, 0.92], Extrapolation.CLAMP);
    const translateY = interpolate(progress, [0, 1], [44, 22], Extrapolation.CLAMP);
    return { transform: [{ scale }, { translateY }] };
  });
  const bottomOverlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity(revealProgress.value),
  }));

  // Hidden ghost at index+3 — invisible at rest, fades into the
  // bottom-slot pose as the top card is dragged forward.
  const ghostStyle = useAnimatedStyle(() => {
    const progress = forwardProgress(tx.value);
    const scale = interpolate(progress, [0, 1], [0.76, 0.84], Extrapolation.CLAMP);
    const translateY = interpolate(progress, [0, 1], [66, 44], Extrapolation.CLAMP);
    const opacity = interpolate(progress, [0, 1], [0, 1], Extrapolation.CLAMP);
    return { transform: [{ scale }, { translateY }], opacity };
  });
  const ghostOverlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity(revealProgress.value),
  }));

  if (!topDog) {
    // End of the deck.
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyText}>{t.tasks.lostPetsNearby}</Text>
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
          <Animated.View style={[styles.cardSlot, ghostStyle]}>
            {renderCard(next3, t)}
            <Animated.View style={[styles.greyCover, ghostOverlayStyle]} pointerEvents="none" />
          </Animated.View>
        ) : null}
        {next2 ? (
          <Animated.View style={[styles.cardSlot, bottomStyle]}>
            {renderCard(next2, t)}
            <Animated.View style={[styles.greyCover, bottomOverlayStyle]} pointerEvents="none" />
          </Animated.View>
        ) : null}
        {next1 ? (
          <Animated.View style={[styles.cardSlot, middleStyle]}>
            {renderCard(next1, t)}
            <Animated.View style={[styles.greyCover, middleOverlayStyle]} pointerEvents="none" />
          </Animated.View>
        ) : null}
        <GestureDetector gesture={pan}>
          <Animated.View style={[styles.cardSlot, topStyle]}>{renderCard(topDog, t)}</Animated.View>
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
    // Reserve room for the bottom card's offset so the deck doesn't
    // clip its own peek.
    marginBottom: 14,
  },
  cardSlot: {
    position: 'absolute',
    width: CARD_W,
    height: CARD_H,
  },
  // Semi-transparent grey card sitting on top of each deck slot's
  // real content. At rest, REST_OVERLAY in the worklet sets this
  // ~0.88 — content visibly under but mostly grey, reads as a
  // "more cards back here" hint. On forward drag the overlay
  // fades to 0 with a small delay (overlayOpacity worklet) so the
  // next dog's photo gradually emerges. Backward drag leaves it
  // alone — the deck stays grey when going back.
  greyCover: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 24,
    backgroundColor: '#e6e6e6',
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
