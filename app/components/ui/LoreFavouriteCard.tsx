import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import type { LatLng } from '@shukajpes/shared';
import type { LoreFavourite } from '../../services/api';
import { cachedLorePreview, getLorePreview, PREVIEW_H } from '../../services/mapPreview';
import { colors } from '../../constants/colors';
import { SYSTEM_FONT } from '../../constants/fonts';
import { R } from '../../constants/radius';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
import { INK } from '../../constants/surface';
import { distanceMeters } from '../../utils/geo';
import { HandDrawnFrame, HandDrawnPaperTop, PICTURE_INSET } from './HandDrawn';

// One hearted place as a card in the favourites carousel: a picture of
// our own map around it with a dot where it stands, the title (or the
// name) and the dog's one-liner under, the distance top-right. Same
// white card and drawn edge as the spot cards beside it.

// "X m" for sub-1km, "X.X km" beyond — the spot card's formatting.
function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m / 50) * 50} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

export function LoreFavouriteCard({
  place,
  userPos,
}: {
  place: LoreFavourite;
  userPos: LatLng | null;
}) {
  const [preview, setPreview] = useState<string | null>(() => cachedLorePreview(place.id));
  useEffect(() => {
    if (preview) return;
    let live = true;
    void getLorePreview(place.id, place.position).then((url) => {
      if (live && url) setPreview(url);
    });
    return () => {
      live = false;
    };
  }, [place.id, place.position, preview]);

  const distLabel = userPos ? formatDistance(distanceMeters(userPos, place.position)) : null;

  return (
    <View style={styles.card}>
      <HandDrawnFrame radius={R.card} seed={place.id} />
      <View style={styles.preview}>
        {preview ? (
          <Image source={{ uri: preview }} style={styles.previewImage} resizeMode="cover" />
        ) : (
          <View style={styles.previewEmpty} />
        )}
        {/* The place, dead centre of the preview — a ring so it reads on
            any patch of the map, in the sniff ring's blue. */}
        <View style={styles.dotRing}>
          <View style={styles.dot} />
        </View>
        {distLabel ? (
          <View style={styles.distChip}>
            <Text style={styles.distText}>{distLabel}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.body}>
        {/* The band IS its own top edge — one filled shape, so the paper
            and the ink can never disagree about where the picture ends.
            Same treatment as the lost-pet card's label band; the preview
            used to stop on a ruler-straight cut, the one machine-made
            line among a screenful of drawn ones. See HandDrawnPaperTop. */}
        <HandDrawnPaperTop seed={`${place.id}-band`} />
        <Text style={styles.title} numberOfLines={2}>
          {place.title ?? place.name}
        </Text>
        <Text style={styles.story} numberOfLines={2}>
          {place.story}
        </Text>
      </View>
    </View>
  );
}

const DOT = 12;
const RING = 22;

const styles = StyleSheet.create({
  card: {
    width: '100%',
    height: '100%',
    borderRadius: R.card,
    overflow: 'hidden',
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 6,
  },
  // MOUNTED ON THE PAPER, not flush to the bezel. The preview used to
  // be a plain flow block at the card's full width, so the map ran under
  // the drawn edge and the sliver of surface outside the ink was
  // somebody's rooftop instead of white paper — the card read as a map
  // with a line on it. Inset by the same PICTURE_INSET the lost-pet
  // photo uses, and the top corners follow the card's radius minus that
  // inset, so the two cards are cut identically. Bottom corners stay
  // square: the label band covers them.
  preview: {
    height: PREVIEW_H,
    marginTop: PICTURE_INSET,
    marginHorizontal: PICTURE_INSET,
    borderTopLeftRadius: Math.max(0, R.card - PICTURE_INSET),
    borderTopRightRadius: Math.max(0, R.card - PICTURE_INSET),
    backgroundColor: '#f1f0ec',
    overflow: 'hidden',
  },
  previewImage: { width: '100%', height: '100%' },
  // While the snapshot renders: the same paper the map draws on.
  previewEmpty: { flex: 1, backgroundColor: '#eeece6' },
  dotRing: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: RING,
    height: RING,
    marginLeft: -RING / 2,
    marginTop: -RING / 2,
    borderRadius: RING / 2,
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: colors.sniffBlue,
  },
  distChip: {
    position: 'absolute',
    top: S.m,
    right: S.m,
    paddingHorizontal: S.s + 2,
    paddingVertical: 4,
    borderRadius: R.pill,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  distText: {
    fontFamily: SYSTEM_FONT,
    fontSize: TYPE.caption,
    fontWeight: '800',
    color: INK,
  },
  body: {
    paddingHorizontal: S.xl,
    paddingTop: S.m,
    paddingBottom: S.l,
    gap: 4,
  },
  title: {
    fontFamily: SYSTEM_FONT,
    fontSize: TYPE.title,
    fontWeight: '800',
    color: colors.black,
    lineHeight: 22,
  },
  story: {
    fontFamily: SYSTEM_FONT,
    fontSize: TYPE.small,
    color: '#666',
    lineHeight: 18,
  },
});
