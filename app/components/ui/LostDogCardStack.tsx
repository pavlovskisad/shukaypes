// Lost-pets card stack — thin wrapper over the generic CardStack
// that supplies the photo-card renderCard and the photo-prefetch
// hint. All the deck animation / gesture / cycling lives in
// ../CardStack — this file is just the lost-pets visual.

import { useCallback, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { NearbyLostDog } from '../../services/api';
import { SYSTEM_FONT } from '../../constants/fonts';
import { R } from '../../constants/radius';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
import { INK } from '../../constants/surface';
import { useStrings } from '../../i18n/useStrings';
import { useGameStore } from '../../stores/gameStore';
import { distanceMeters, formatDistance } from '../../utils/geo';
import type { LatLng } from '@shukajpes/shared';
import { CardStack, CardStackSkeleton } from './CardStack';
import { Icon } from './Icon';
import { INLINE_ICON } from '../../constants/sizing';

interface Props {
  dogs: NearbyLostDog[];
  onTap: (dog: NearbyLostDog) => void;
  onCounterTap?: () => void;
  // Fired on each committed swipe with the dog now centred (the new top card).
  onSwipe?: (dog: NearbyLostDog) => void;
  cardWidth?: number;
  cardHeight?: number;
  peekScale?: number;
  showCounter?: boolean;
  // Id of the dog that's the active quest — that card gets a slowly-pulsing
  // blue glow so it's clear which one you're on the trail of.
  activeId?: string;
  // Dog whose card starts on top of the deck (mount-time only) — used when
  // supersniff opens already committed to a dog. See CardStack.initialId.
  initialId?: string;
  // Heavier drop shadow so cards separate cleanly from a busy background (the
  // 3D map in supersniff). Off by default — the Quests tab keeps its lighter one.
  strongShadow?: boolean;
  // Confirmation focus — see CardStack.focused. The centre card grows into
  // the confirmation card in place; neighbours slide off; gestures freeze.
  focused?: boolean;
}

export function LostDogCardStack({
  dogs,
  onTap,
  onCounterTap,
  onSwipe,
  cardWidth,
  cardHeight,
  peekScale,
  showCounter,
  activeId,
  initialId,
  strongShadow,
  focused,
}: Props) {
  const t = useStrings();
  const userPos = useGameStore((s) => s.userPosition);
  // useCallback-stable so CardStack's memoed ItemSlot doesn't see
  // a "new" renderCard prop on every parent render and discard
  // the memo. Deps cover everything the closure actually reads.
  const renderCard = useCallback(
    (d: NearbyLostDog) => (
      <LostDogCardView
        dog={d}
        t={t}
        userPos={userPos}
        active={d.id === activeId}
        strongShadow={strongShadow}
      />
    ),
    [t, userPos, activeId, strongShadow],
  );
  return (
    <CardStack
      items={dogs}
      getId={(d) => d.id}
      onTap={onTap}
      onCounterTap={onCounterTap}
      onSwipe={onSwipe}
      getPhotoUrl={(d) => d.photoUrl}
      renderCard={renderCard}
      {...(cardWidth != null ? { cardWidth } : {})}
      {...(cardHeight != null ? { cardHeight } : {})}
      {...(peekScale != null ? { peekScale } : {})}
      {...(showCounter != null ? { showCounter } : {})}
      {...(initialId != null ? { initialId } : {})}
      {...(focused != null ? { focused } : {})}
    />
  );
}

// Re-exported so call sites that imported the skeleton from this
// module keep working without a churning rename across the app.
export const LostDogCardStackSkeleton = CardStackSkeleton;

// Photo full-bleed, with an inked white label band across the bottom
// carrying name + breed on the left and how far away on the right.
// No photo → soft grey card with the emoji centred. Exported so the
// "see all" modal can render the same visual at a wider size.
export function LostDogCardView({
  dog,
  t,
  userPos,
  active = false,
  strongShadow = false,
  chips = true,
}: {
  dog: NearbyLostDog;
  t: ReturnType<typeof useStrings>;
  userPos: LatLng | null;
  // Active quest card → slowly-pulsing blue glow so it's clear which dog
  // you're on the trail of.
  active?: boolean;
  // Heavier drop shadow (contact + ambient) to lift the card off a busy bg.
  strongShadow?: boolean;
  // The distance readout. On in the deck and the "see all" list, where
  // you are comparing pets and how far each one is matters.
  //
  // Off once a pet is THE pet — during a confirmation or a running
  // search there is only one card on screen and the distance belongs
  // in the nav readout at the top. What's left is the face, which is
  // the only thing you're actually looking for.
  //
  // The urgency badge used to ride alongside it. It is gone: on a deck
  // where most pets are "шукаємо" it labelled almost every card with
  // the same word, which is not a distinction, and it cost a patch on
  // the photograph to say it.
  chips?: boolean;
}) {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.getElementById('dog-active-glow-style')) return;
    const el = document.createElement('style');
    el.id = 'dog-active-glow-style';
    el.textContent = `
      @keyframes dog-active-glow {
        0%, 100% { box-shadow: 0 0 0 2px rgba(47,107,255,0.5), 0 6px 24px 2px rgba(47,107,255,0.35); }
        50%      { box-shadow: 0 0 0 3px rgba(47,107,255,0.95), 0 10px 34px 6px rgba(47,107,255,0.75); }
      }
    `;
    document.head.appendChild(el);
  }, []);
  const distLabel = userPos
    ? formatDistance(distanceMeters(userPos, dog.lastSeen.position))
    : null;
  return (
    <View
      style={[
        styles.card,
        // Heavier shadow first so the active blue glow (below) still wins when
        // a card is both the active quest AND on a strong-shadow deck.
        strongShadow
          ? ({
              boxShadow:
                '0 3px 8px rgba(0,0,0,0.24), 0 14px 32px rgba(0,0,0,0.30)',
            } as unknown as object)
          : null,
        active
          ? ({
              boxShadow:
                '0 0 0 2px rgba(47,107,255,0.7), 0 8px 28px 4px rgba(47,107,255,0.5)',
              animation: 'dog-active-glow 2.2s ease-in-out infinite',
            } as unknown as object)
          : null,
      ]}
    >
      {dog.photoUrl ? (
        // <div> with background-image:cover instead of <img>:
        // CSS-level guaranteed fill regardless of the photo's
        // intrinsic aspect ratio.
        //
        // NO borderRadius here — the parent card already has
        // borderRadius + overflow:hidden which clips this div
        // to the card's rounded shape.
        //
        // transform: scale(1.04) gives the photo a 2 % overshoot
        // on each side, which the card's overflow:hidden clips
        // away. Belt-and-braces against sub-pixel rendering
        // gaps along the edges — even when scale(0.74) on the
        // peek cards quantises differently per axis, the photo
        // still reaches all four card edges. User's "lil zoom"
        // suggestion was the right call.
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `url("${dog.photoUrl}")`,
            backgroundSize: 'cover',
            backgroundPosition: 'center center',
            backgroundRepeat: 'no-repeat',
            transform: 'scale(1.04)',
          }}
        />
      ) : (
        <View style={[styles.photo, styles.photoFallback]}>
          <Text style={styles.photoEmoji}>{dog.emoji ?? '🐶'}</Text>
        </View>
      )}
      <View style={styles.cardBody}>
        <View style={styles.cardBodyRow}>
          <View style={styles.cardBodyText}>
            <Text style={styles.cardName} numberOfLines={1}>
              {dog.name}
            </Text>
            {dog.breed ? (
              <Text style={styles.cardMeta} numberOfLines={1}>
                {dog.breed}
              </Text>
            ) : null}
          </View>
          {chips && distLabel ? (
            <View style={styles.distRow}>
              <Icon name="pin" size={INLINE_ICON.badge} />
              <Text style={styles.distText} numberOfLines={1}>
                {distLabel}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Card fills its parent — the carousel slot is 320×280, the
  // "see all" modal row is full-width × 320. Photo + gradient +
  // chip layout stays anchored from the bottom edges so the
  // composition still reads at either size.
  card: {
    width: '100%',
    height: '100%',
    borderRadius: R.card,
    overflow: 'hidden',
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 6,
  },
  photo: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    borderRadius: R.card,
  },
  photoFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoEmoji: {
    fontSize: 120,
    opacity: 0.6,
  },
  // Distance label — mirror of the urgency badge but anchored
  // top-right. Same corner, same ink.
  // A PAPER LABEL STUCK ON A PHOTO, not text floating over it.
  //
  // This used to be white type sitting directly on the picture, held
  // legible by a dark gradient washed up from the bottom edge. That
  // gradient was doing real work — a photo can be any colour, and white
  // on a snowy pavement is nothing — but it darkened the bottom half of
  // every pet's photo to buy it, and a fading black veil is the exact
  // opposite of the paper-and-ink the rest of the app is drawn in.
  //
  // So the name gets its own piece of paper instead: opaque white,
  // inked along the top edge where it meets the photo. Legibility stops
  // depending on what the photo happens to look like, and the photo
  // stops being dimmed to make room for words.
  cardBody: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#ffffff',
    borderTopWidth: 2,
    borderTopColor: INK,
    // ~7% of card width, matching the reference's inner margin.
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
  },
  // Name + breed on the left, distance on the right — one row, so the
  // distance sits on the same paper as the name instead of floating on
  // the photograph.
  cardBodyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: S.m,
  },
  cardBodyText: {
    flexShrink: 1,
    minWidth: 0,
  },
  // No patch. It used to be a white pill on the photo, which needed a
  // container because the background underneath was unknowable. Down
  // here the background is white paper, so the text can just be text —
  // and bigger, since it now carries itself.
  distRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    flexShrink: 0,
  },
  distText: {
    fontFamily: SYSTEM_FONT,
    fontSize: TYPE.body,
    fontWeight: '700',
    color: INK,
    flexShrink: 0,
  },
  cardName: {
    fontFamily: SYSTEM_FONT,
    fontSize: TYPE.display,
    fontWeight: '800',
    color: INK,
  },
  cardMeta: {
    fontFamily: SYSTEM_FONT,
    fontSize: TYPE.small,
    color: '#777',
    marginTop: S.xs,
  },
});
