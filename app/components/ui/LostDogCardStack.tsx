// Lost-pets card stack — thin wrapper over the generic CardStack
// that supplies the photo-card renderCard and the photo-prefetch
// hint. All the deck animation / gesture / cycling lives in
// ../CardStack — this file is just the lost-pets visual.

import { useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { NearbyLostDog } from '../../services/api';
import { SYSTEM_FONT } from '../../constants/fonts';
import { R } from '../../constants/radius';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
import { useStrings } from '../../i18n/useStrings';
import { useGameStore } from '../../stores/gameStore';
import { distanceMeters } from '../../utils/geo';
import type { LatLng } from '@shukajpes/shared';
import { CardStack, CardStackSkeleton } from './CardStack';

interface Props {
  dogs: NearbyLostDog[];
  onTap: (dog: NearbyLostDog) => void;
  onCounterTap?: () => void;
  onSwipe?: () => void;
}

// "X m" for sub-1km, "X.X km" beyond. Snapped to 50m below 1km so
// the chip doesn't jitter on small GPS drift.
function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m / 50) * 50} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

export function LostDogCardStack({ dogs, onTap, onCounterTap, onSwipe }: Props) {
  const t = useStrings();
  const userPos = useGameStore((s) => s.userPosition);
  // useCallback-stable so CardStack's memoed ItemSlot doesn't see
  // a "new" renderCard prop on every parent render and discard
  // the memo. Deps cover everything the closure actually reads.
  const renderCard = useCallback(
    (d: NearbyLostDog) => <LostDogCardView dog={d} t={t} userPos={userPos} />,
    [t, userPos],
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
    />
  );
}

// Re-exported so call sites that imported the skeleton from this
// module keep working without a churning rename across the app.
export const LostDogCardStackSkeleton = CardStackSkeleton;

// Photo full-bleed top, dark-to-transparent gradient mask
// carrying name + meta over the bottom of the photo. Urgency
// badge top-left, distance chip top-right. No photo → soft grey
// card with the emoji centred. Exported so the "see all" modal
// can render the same visual at a wider size.
export function LostDogCardView({
  dog,
  t,
  userPos,
}: {
  dog: NearbyLostDog;
  t: ReturnType<typeof useStrings>;
  userPos: LatLng | null;
}) {
  const urgent = dog.urgency === 'urgent';
  const badgeText = urgent ? t.tasks.badgeUrgent : t.tasks.badgeSearching;
  const badgeFg = urgent ? '#e84040' : '#d9a030';
  const distLabel = userPos
    ? formatDistance(distanceMeters(userPos, dog.lastSeen.position))
    : null;
  return (
    <View style={styles.card}>
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
      <View style={styles.gradient} />
      <View style={styles.badge}>
        <Text style={[styles.badgeText, { color: badgeFg }]}>{badgeText}</Text>
      </View>
      {distLabel ? (
        <View style={styles.distChip}>
          <Text style={styles.distChipText}>{distLabel}</Text>
        </View>
      ) : null}
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
  gradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '50%',
    // RN-Web passes `backgroundImage` straight through to CSS.
    backgroundImage:
      'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.05) 35%, rgba(0,0,0,0.65) 100%)',
  } as unknown as object,
  badge: {
    position: 'absolute',
    top: 14,
    left: 14,
    backgroundColor: '#ffffff',
    paddingHorizontal: S.m,
    paddingVertical: S.s,
    // Full-pill radius + lifted shadow so the chip reads as the
    // same family as the HUD pills / chat header pill (full
    // round with CHROME_SHADOW). Scaled down for in-card use.
    borderRadius: R.pill,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 12,
    elevation: 4,
  },
  badgeText: {
    fontSize: TYPE.caption,
    fontWeight: '700',
    textTransform: 'lowercase',
    letterSpacing: 0.4,
  },
  // Distance chip — mirror of the urgency badge but anchored
  // top-right. Same full-pill / lifted-shadow family.
  distChip: {
    position: 'absolute',
    top: 14,
    right: 14,
    backgroundColor: '#ffffff',
    paddingHorizontal: S.m,
    paddingVertical: S.s,
    borderRadius: R.pill,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 12,
    elevation: 4,
  },
  distChipText: {
    fontSize: TYPE.caption,
    fontWeight: '700',
    color: '#555',
    letterSpacing: 0.3,
  },
  cardBody: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 18,
  },
  cardName: {
    fontFamily: SYSTEM_FONT,
    fontSize: TYPE.display,
    fontWeight: '800',
    color: '#ffffff',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  cardMeta: {
    fontFamily: SYSTEM_FONT,
    fontSize: TYPE.small,
    color: 'rgba(255,255,255,0.92)',
    marginTop: S.xs,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});
