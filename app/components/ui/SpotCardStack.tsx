// Spot card stack — thin wrapper over the generic CardStack
// that supplies an icon-led card render (no photo). All deck
// animation / gesture / cycling lives in ./CardStack.

import { View, Text, StyleSheet } from 'react-native';
import type { Spot } from '../../services/places';
import { colors } from '../../constants/colors';
import { SYSTEM_FONT } from '../../constants/fonts';
import { useStrings } from '../../i18n/useStrings';
import { Icon, iconForCategory } from './Icon';
import { CardStack, CardStackSkeleton, CARD_W, CARD_H } from './CardStack';

interface Props {
  spots: Spot[];
  onTap: (spot: Spot) => void;
}

export function SpotCardStack({ spots, onTap }: Props) {
  const t = useStrings();
  return (
    <CardStack
      items={spots}
      getId={(s) => s.id}
      onTap={onTap}
      renderCard={(s) => renderCard(s, t)}
    />
  );
}

export const SpotCardStackSkeleton = CardStackSkeleton;

// White card, big category icon as the centred hero, name +
// address at the bottom on dark text. Category chip top-left,
// optional rating chip top-right.
function renderCard(spot: Spot, t: ReturnType<typeof useStrings>) {
  const categoryLabel =
    t.modals.spot.categories[spot.category as keyof typeof t.modals.spot.categories] ??
    spot.category;
  const iconSlot = iconForCategory(spot.category);

  return (
    <View style={styles.card}>
      <View style={styles.iconHero}>
        {iconSlot ? (
          <Icon name={iconSlot} size={110} />
        ) : (
          <Text style={styles.heroEmoji}>{spot.icon ?? '📍'}</Text>
        )}
      </View>
      <View style={styles.categoryBadge}>
        <Text style={styles.categoryBadgeText}>{categoryLabel}</Text>
      </View>
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
  card: {
    width: CARD_W,
    height: CARD_H,
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
    // below without the text crashing into the icon.
    bottom: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroEmoji: {
    fontSize: 90,
    opacity: 0.85,
  },
  // Full-pill chip family — matches the HUD pill / chat header
  // shape + shadow, scaled smaller for in-card use.
  categoryBadge: {
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
  categoryBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'lowercase',
    letterSpacing: 0.4,
    color: '#555',
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
