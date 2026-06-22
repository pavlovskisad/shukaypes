// Lost-pets card stack — thin wrapper over the generic CardStack
// that supplies the photo-card renderCard and the photo-prefetch
// hint. All the deck animation / gesture / cycling lives in
// ../CardStack — this file is just the lost-pets visual.

import { View, Text, StyleSheet, Image } from 'react-native';
import type { NearbyLostDog } from '../../services/api';
import { SYSTEM_FONT } from '../../constants/fonts';
import { useStrings } from '../../i18n/useStrings';
import { useGameStore } from '../../stores/gameStore';
import { distanceMeters } from '../../utils/geo';
import type { LatLng } from '@shukajpes/shared';
import { CardStack, CardStackSkeleton, CARD_W, CARD_H } from './CardStack';

interface Props {
  dogs: NearbyLostDog[];
  onTap: (dog: NearbyLostDog) => void;
}

// "X m" for sub-1km, "X.X km" beyond. Snapped to 50m below 1km so
// the chip doesn't jitter on small GPS drift.
function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m / 50) * 50} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

export function LostDogCardStack({ dogs, onTap }: Props) {
  const t = useStrings();
  const userPos = useGameStore((s) => s.userPosition);
  return (
    <CardStack
      items={dogs}
      getId={(d) => d.id}
      onTap={onTap}
      getPhotoUrl={(d) => d.photoUrl}
      renderCard={(d) => renderCard(d, t, userPos)}
    />
  );
}

// Re-exported so call sites that imported the skeleton from this
// module keep working without a churning rename across the app.
export const LostDogCardStackSkeleton = CardStackSkeleton;

// Photo full-bleed top, dark-to-transparent gradient mask
// carrying name + meta over the bottom of the photo. Urgency
// badge top-left, distance chip top-right. No photo → soft grey
// card with the emoji centred.
function renderCard(
  dog: NearbyLostDog,
  t: ReturnType<typeof useStrings>,
  userPos: LatLng | null,
) {
  const urgent = dog.urgency === 'urgent';
  const badgeText = urgent ? t.tasks.badgeUrgent : t.tasks.badgeSearching;
  const badgeFg = urgent ? '#e84040' : '#d9a030';
  const distLabel = userPos
    ? formatDistance(distanceMeters(userPos, dog.lastSeen.position))
    : null;
  return (
    <View style={styles.card}>
      {dog.photoUrl ? (
        <Image source={{ uri: dog.photoUrl }} style={styles.photo} resizeMode="cover" />
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
  card: {
    width: CARD_W,
    height: CARD_H,
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
    // corners at the top of the photo. Match the card's
    // borderRadius on the image itself so it self-clips
    // regardless of parent.
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
    // RN-Web passes `backgroundImage` straight through to CSS.
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
    borderColor: 'rgba(0,0,0,0.05)',
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
  // Distance chip — mirror of the urgency badge but anchored
  // top-right. Same white-pill-with-shadow family.
  distChip: {
    position: 'absolute',
    top: 14,
    right: 14,
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 2,
  },
  distChipText: {
    fontSize: 11,
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
});
