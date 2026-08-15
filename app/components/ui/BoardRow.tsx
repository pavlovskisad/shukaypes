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

import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../../constants/colors';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
import { TerritoryMini } from './TerritoryMini';

export function BoardRow({
  rank,
  name,
  areaLabel,
  piece,
  color,
  you,
}: {
  rank: string;
  name: string;
  areaLabel: string;
  piece: { lat: number; lng: number }[] | undefined;
  color: string;
  you: boolean;
}) {
  return (
    <View style={styles.boardRow}>
      <Text
        style={[styles.boardRank, styles.boardRankStrong, you && styles.boardYouText]}
        numberOfLines={1}
      >
        {rank}
      </Text>
      <TerritoryMini points={piece} color={color} size={92} />
      <View style={styles.boardText}>
        <Text style={[styles.boardName, you && styles.boardYouText]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[styles.boardArea, you && styles.boardYouText]}>{areaLabel}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  boardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.m,
    paddingVertical: S.s,
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
    color: '#999',
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
    fontWeight: '600',
    color: colors.black,
  },
  boardArea: {
    fontSize: TYPE.small,
    color: '#777',
    fontWeight: '700',
  },
  boardYouText: {
    color: 'rgba(0,60,255,0.85)',
    fontWeight: '700',
  },
});
