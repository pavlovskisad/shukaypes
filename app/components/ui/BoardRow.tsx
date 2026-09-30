// One row of the territory standing — used for YOU, for everyone else,
// and by the fullscreen "see all" board, because all of them have to be
// the same thing. Rows used to be written out separately per place and
// drifted immediately; a single component is what stops your own row
// becoming a different kind of object from the list it belongs to.
//
// The row is a portrait, not a bar chart: the owner's largest piece,
// drawn as a silhouette in their colour, with the name beside it and
// the area counter under the name. The coloured length-bar this
// replaced ranked rows against the leader, but every shape here is one
// a player has actually walked past on the map — "the red blob by the
// fountain" — and recognising WHO is worth more than re-reading HOW
// MUCH, which the counter still says in numbers.
//
// Since D-73 the row reads rank, face, name with the counter under it,
// and the silhouette last on the right: the drawn portrait (D-72, or a
// bot's from the roster) is the first thing after the rank, no ring —
// the marker line is the edge, as on the profile card and the dog's
// card. A row without one keeps the slot as a blank paper disc so the
// names stay in a column.

import type { ReactNode } from 'react';
import { View, Text, Image, StyleSheet, useWindowDimensions } from 'react-native';
import { colors } from '../../constants/colors';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
import { COMPACT_SCREEN } from '../../constants/sizing';
import { TerritoryMini } from './TerritoryMini';

// Twice the profile card's 44: on the board the face is the identity
// and the silhouette is the second read, so the face gets the size.
const PORTRAIT = 88;
// The silhouette (or the happiness index in its place) at the row's end.
const TRAILING = 92;

// THE ROW ON A SMALL PHONE (UX-12.6). Rank 30 + face 88 + silhouette 92
// + three S.m gaps and the card's padding left ~34 px for the name at
// 320 and ~74 at 360 — «ти» fitted, nobody else's name did. Under
// COMPACT_SCREEN the face and the end column shrink and the gaps
// tighten, which hands the name ~70 px more. The callers that draw their
// own trailing column (the happiness index) read the same width from
// here, or the two boards' rows stop lining up.
export function useBoardRowSize(): { portrait: number; trailing: number; gap: number } {
  const compact = useWindowDimensions().width < COMPACT_SCREEN;
  return compact
    ? { portrait: 56, trailing: 64, gap: S.s }
    : { portrait: PORTRAIT, trailing: TRAILING, gap: S.m };
}

export function BoardRow({
  rank,
  name,
  areaLabel,
  piece,
  color,
  you,
  avatarUrl,
  owner,
  trailing,
}: {
  rank: string;
  name: string;
  areaLabel: string;
  // The nickname behind a dog's name; shown after the counter so a
  // friend can find a person on a board of dogs.
  owner?: string | null;
  piece: { lat: number; lng: number }[] | undefined;
  color: string;
  you: boolean;
  avatarUrl?: string | null;
  // What sits at the row's end: the territory silhouette by default,
  // or whatever the board is about — the happiness board puts its
  // number there.
  trailing?: ReactNode;
}) {
  const size = useBoardRowSize();
  const face = { width: size.portrait, height: size.portrait, borderRadius: size.portrait / 2 };
  return (
    <View style={[styles.boardRow, { gap: size.gap }]}>
      <Text
        style={[styles.boardRank, styles.boardRankStrong, you && styles.boardYouText]}
        numberOfLines={1}
      >
        {rank}
      </Text>
      <View style={[styles.portrait, face]}>
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={face} accessibilityLabel={name} />
        ) : null}
      </View>
      <View style={styles.boardText}>
        <Text style={[styles.boardName, you && styles.boardYouText]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[styles.boardArea, you && styles.boardYouText]} numberOfLines={1}>
          {owner ? `${areaLabel} · ${owner}` : areaLabel}
        </Text>
      </View>
      {trailing !== undefined ? trailing : <TerritoryMini points={piece} color={color} size={size.trailing} />}
    </View>
  );
}

const styles = StyleSheet.create({
  boardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    // gap from useBoardRowSize.
    paddingVertical: S.s,
  },
  // The face: as tall as the name and counter together, like the
  // profile card's. Blank paper when nobody has drawn one. Size and
  // circle from useBoardRowSize.
  portrait: {
    backgroundColor: colors.portraitBlank,
    flexShrink: 0,
  },
  boardRank: {
    // 22 fitted a single digit and nothing else, so a two-character rank
    // wrapped onto a second line and pushed the row's height out — which
    // is exactly what "#30" did in the you-row. Wide enough for three
    // digits, since a real city will have more than ninety-nine dogs in
    // it, and the column is invisible whitespace until it is needed.
    width: 30,
    fontSize: TYPE.small,
    fontWeight: '700',
    color: colors.grey,
  },
  // The digit gets weight, not colour — the silhouette beside it is
  // already carrying the owner's hue and two colours competing in one
  // row reads as decoration.
  boardRankStrong: { color: colors.black, fontWeight: '700' },
  // Name over counter, and the column owns the leftover width so a long
  // name truncates instead of pushing the silhouette around.
  boardText: {
    flex: 1,
    minWidth: 0,
  },
  boardName: {
    fontSize: TYPE.body,
    fontWeight: '700',
    color: colors.black,
  },
  // Regular weight: the meta line under a name must not out-shout the
  // name it belongs to — it was bolder than the name (UX-11.18).
  boardArea: {
    fontSize: TYPE.small,
    color: colors.grey,
    fontWeight: '400',
  },
  boardYouText: {
    color: colors.blue,
    fontWeight: '700',
  },
});
