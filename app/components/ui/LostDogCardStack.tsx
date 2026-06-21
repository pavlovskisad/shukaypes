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

  // Reveal progress is GONE in this iteration — deck slots stay
  // permanently grey, the next dog's photo never leaks under the
  // cover. Top-card fade-in handles the "new top appearing" feel
  // instead, isolated to the single slot that's actually changing.
  // (Kept the variable so the spring-back in onEnd has a no-op
  // target without restructuring further.)
  const revealProgress = useSharedValue(0);

  // Drives a quick fade-in on the top slot after `advance` (in
  // either direction). 1 at rest, snaps to 0 inside advance, then
  // ramps back to 1 — gives the new dog's photo a soft arrival
  // instead of teleporting into the slot at the end of the fly-off.
  const topAppearOpacity = useSharedValue(1);

  const advance = useCallback(
    (delta: number) => {
      setIndex((i) => Math.max(0, i + delta));
      // Defer the transform reset to the NEXT animation frame so React
      // commits the index change first — otherwise the transform
      // snaps before the slot's photo src updates, briefly showing
      // the old dog at centre.
      requestAnimationFrame(() => {
        ty.value = 0;
        revealProgress.value = 0;
        // Top slot is about to show a different dog. Fade it in so
        // the new content arrives softly rather than popping into
        // the centre after the fly-off completes.
        topAppearOpacity.value = 0;
        topAppearOpacity.value = withTiming(1, {
          duration: REVEAL_MS,
          easing: SLIDE_EASE,
        });
        if (delta < 0) {
          // BACKWARD: teleport the top slot to off-screen LEFT (the
          // OPPOSITE side of where the old top flew to), then animate
          // it back to centre — the previous dog "swings in" from
          // the left, mirroring the "going back" intent.
          tx.value = -(CARD_W + 100);
          tx.value = withTiming(0, { duration: SLIDE_IN_MS, easing: SLIDE_EASE });
        } else {
          // FORWARD: snap tx back; the fade-in carries the visual
          // transition since the deck slots are static grey blanks.
          tx.value = 0;
        }
      });
    },
    [tx, ty, revealProgress, topAppearOpacity],
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

  // Deck-card poses. STATIC at peek positions — no scale/translate
  // animation during drag. The deck reads as a clean stack of
  // grey rectangles behind the active card; only the top card
  // moves. Pushed lower than the first prototype so each peek
  // strip is visibly wider.
  const STACK_POSES = [
    { scale: 0.94, ty: 30 },  // middle
    { scale: 0.88, ty: 60 },  // bottom
    { scale: 0.82, ty: 90 },  // third
  ];

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
  // (Reveal / deck-shift logic removed in favour of static grey
  // deck slots — see STACK_POSES above. revealProgress kept as a
  // no-op shared value so the spring-back in pan.onEnd has a
  // target without a structural rewrite.)

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

  // Render the three deck cards in deepest-first order so the top
  // paints last. Each is a STATIC grey rectangle — no Image, no
  // content — sized + positioned via its STACK_POSES pose. Only
  // mounted if there's a corresponding upcoming dog (so the deck
  // visibly thins out near the end of the list).
  const deckPeeks = [
    { hasDog: !!next3, pose: STACK_POSES[2]! },
    { hasDog: !!next2, pose: STACK_POSES[1]! },
    { hasDog: !!next1, pose: STACK_POSES[0]! },
  ];

  return (
    <View style={styles.wrap}>
      <View style={styles.deck}>
        {deckPeeks.map((peek, i) =>
          peek.hasDog ? (
            <View
              key={`peek-${i}`}
              style={[
                styles.cardSlot,
                styles.greyDeckCard,
                {
                  transform: [{ scale: peek.pose.scale }, { translateY: peek.pose.ty }],
                },
              ]}
            />
          ) : null,
        )}
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
    // Reserve room for the third card's peek (ty:90 + card-bottom
    // tail) so the deepest deck card isn't clipped at the bottom.
    marginBottom: 56,
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
