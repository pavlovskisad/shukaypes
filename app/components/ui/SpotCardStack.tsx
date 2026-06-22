// Spot card stack — thin wrapper over the generic CardStack
// that supplies an icon-led card render (no photo). All deck
// animation / gesture / cycling lives in ./CardStack.
//
// `SpotCardView` is exported so other surfaces (the category-
// expand modal) can reuse the exact same card visual without
// duplicating the layout.

import { View, Text, StyleSheet } from 'react-native';
import type { Spot } from '../../services/places';
import type { LatLng } from '@shukajpes/shared';
import { colors } from '../../constants/colors';
import { SYSTEM_FONT } from '../../constants/fonts';
import { useGameStore } from '../../stores/gameStore';
import { distanceMeters } from '../../utils/geo';
import { Icon, iconForCategory } from './Icon';
import { CardStack, CardStackSkeleton } from './CardStack';

interface Props {
  spots: Spot[];
  onTap: (spot: Spot) => void;
  onCounterTap?: () => void;
}

export function SpotCardStack({ spots, onTap, onCounterTap }: Props) {
  const userPos = useGameStore((s) => s.userPosition);
  return (
    <CardStack
      items={spots}
      getId={(s) => s.id}
      onTap={onTap}
      onCounterTap={onCounterTap}
      renderCard={(s) => <SpotCardView spot={s} userPos={userPos} />}
    />
  );
}

export const SpotCardStackSkeleton = CardStackSkeleton;

// "X m" for sub-1km, "X.X km" beyond. Snapped to 50 m below 1 km
// so the chip doesn't jitter on small GPS drift — matches the
// lost-dog card's distance formatting.
function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m / 50) * 50} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

// White card, big category icon as the centred hero, name +
// address at the bottom on dark text. Distance chip top-left,
// optional rating chip top-right. No category chip — the spots
// tab already groups cards under a category title ("кав'ярні"
// etc.), so repeating the singular on every card just doubles
// up the same info.
export function SpotCardView({
  spot,
  userPos,
}: {
  spot: Spot;
  userPos: LatLng | null;
}) {
  const iconSlot = iconForCategory(spot.category);
  const distLabel = userPos
    ? formatDistance(distanceMeters(userPos, spot.position))
    : null;

  return (
    <View style={styles.card}>
      <View style={styles.iconHero}>
        {iconSlot ? (
          <Icon name={iconSlot} size={220} />
        ) : (
          <Text style={styles.heroEmoji}>{spot.icon ?? '📍'}</Text>
        )}
      </View>
      {distLabel ? (
        <View style={styles.distChip}>
          <Text style={styles.distChipText}>{distLabel}</Text>
        </View>
      ) : null}
      {typeof spot.rating === 'number' ? (
        <View style={styles.ratingBadge}>
          <Text style={styles.ratingBadgeText}>★ {spot.rating.toFixed(1)}</Text>
        </View>
      ) : null}
      <View style={styles.cardBody}>
        <Text style={styles.cardName} numberOfLines={2}>
          {spot.name}
        </Text>
        {spot.address ? (
          <Text style={styles.cardMeta} numberOfLines={2}>
            {spot.address}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Card fills its parent — in the carousel that's the 320×280
  // CardStack slot, in the "see all" modal it's a wider wrapper.
  // Internal absolute-positioned bits (iconHero, cardBody) stay
  // anchored from the bottom, so the icon stays centred above
  // the title even when the card grows taller.
  card: {
    width: '100%',
    height: '100%',
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 6,
  },
  iconHero: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    // Pushed up to leave room for 2-line names + 2-line addresses
    // below without the text crashing into the icon. paddingTop
    // shifts the icon down inside the hero region so it sits
    // closer to the card centre rather than hugging the badges.
    bottom: 120,
    paddingTop: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroEmoji: {
    fontSize: 180,
    opacity: 0.85,
  },
  // Full-pill chip family — matches the HUD pill / chat header
  // shape + shadow, scaled smaller for in-card use.
  distChip: {
    position: 'absolute',
    top: 14,
    left: 14,
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 12,
    elevation: 4,
  },
  distChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#555',
    letterSpacing: 0.3,
  },
  ratingBadge: {
    position: 'absolute',
    top: 14,
    right: 14,
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 12,
    elevation: 4,
  },
  ratingBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#d9a030',
    letterSpacing: 0.3,
  },
  cardBody: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 18,
  },
  cardName: {
    fontFamily: SYSTEM_FONT,
    fontSize: 22,
    fontWeight: '800',
    color: colors.black,
  },
  cardMeta: {
    fontFamily: SYSTEM_FONT,
    fontSize: 13,
    color: '#777',
    marginTop: 4,
  },
});
