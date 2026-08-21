// Spot card stack — thin wrapper over the generic CardStack
// that supplies an icon-led card render (no photo). All deck
// animation / gesture / cycling lives in ./CardStack.
//
// `SpotCardView` is exported so other surfaces (the category-
// expand modal) can reuse the exact same card visual without
// duplicating the layout.

import { useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { Spot } from '../../services/places';
import type { LatLng } from '@shukajpes/shared';
import { colors } from '../../constants/colors';
import { SYSTEM_FONT } from '../../constants/fonts';
import { R } from '../../constants/radius';
import { ICON_HERO, EMOJI_HERO, INLINE_ICON } from '../../constants/sizing';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
import { INK } from '../../constants/surface';
import { useGameStore } from '../../stores/gameStore';
import { distanceMeters } from '../../utils/geo';
import { Icon, iconForCategory } from './Icon';
import { CardStack, CardStackSkeleton } from './CardStack';
import { HandDrawnFrame } from './HandDrawn';

interface Props {
  spots: Spot[];
  onTap: (spot: Spot) => void;
  onCounterTap?: () => void;
  onSwipe?: () => void;
}

export function SpotCardStack({ spots, onTap, onCounterTap, onSwipe }: Props) {
  const userPos = useGameStore((s) => s.userPosition);
  // useCallback-stable so CardStack's memoed ItemSlot doesn't see
  // a "new" renderCard prop on every parent render.
  const renderCard = useCallback(
    (s: Spot) => <SpotCardView spot={s} userPos={userPos} />,
    [userPos],
  );
  return (
    <CardStack
      items={spots}
      getId={(s) => s.id}
      onTap={onTap}
      onCounterTap={onCounterTap}
      onSwipe={onSwipe}
      renderCard={renderCard}
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
// address at the bottom on dark text. Rating top-left, distance
// top-right, both bare. No category chip — the spots
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
      {/* Drawn edge, seeded on the spot — see HandDrawn.tsx. */}
      <HandDrawnFrame radius={R.card} seed={spot.id} />
      <View style={styles.iconHero}>
        {iconSlot ? (
          <Icon name={iconSlot} size={ICON_HERO.card} />
        ) : (
          <Text style={styles.heroEmoji}>{spot.icon ?? '📍'}</Text>
        )}
      </View>
      {typeof spot.rating === 'number' ? (
        <View style={styles.ratingRow}>
          <Text style={styles.ratingStar}>★</Text>
          <Text style={styles.ratingText}>{spot.rating.toFixed(1)}</Text>
        </View>
      ) : null}
      {distLabel ? (
        <View style={styles.distRow}>
          <Icon name="pin" size={INLINE_ICON.badge} />
          <Text style={styles.distText}>{distLabel}</Text>
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
    borderRadius: R.card,
    overflow: 'hidden',
    backgroundColor: '#ffffff',
    // No borderWidth — the edge is drawn, see HandDrawnFrame above.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
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
    paddingTop: S.xxxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroEmoji: {
    fontSize: EMOJI_HERO.card,
    opacity: 0.85,
  },
  // Full-pill chip family — matches the HUD pill / chat header
  // shape + shadow, scaled smaller for in-card use.
  // Both readouts sit bare on the card's own white — no patch, because
  // the surface behind them is already white paper and a white chip on
  // white was an outline holding two characters. Rating left, distance
  // right, so the eye gets "how good" and "how far" without either
  // fighting the hero icon between them.
  ratingRow: {
    position: 'absolute',
    top: 14,
    left: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ratingStar: {
    fontSize: TYPE.body,
    color: colors.amber,
  },
  ratingText: {
    fontFamily: SYSTEM_FONT,
    fontSize: TYPE.body,
    fontWeight: '800',
    color: INK,
  },
  distRow: {
    position: 'absolute',
    top: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  distText: {
    fontFamily: SYSTEM_FONT,
    fontSize: TYPE.body,
    fontWeight: '700',
    color: INK,
  },
  cardBody: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 18,
  },
  cardName: {
    fontFamily: SYSTEM_FONT,
    fontSize: TYPE.hero,
    fontWeight: '800',
    color: colors.black,
  },
  cardMeta: {
    fontFamily: SYSTEM_FONT,
    fontSize: TYPE.small,
    color: '#777',
    marginTop: S.xs,
  },
});
