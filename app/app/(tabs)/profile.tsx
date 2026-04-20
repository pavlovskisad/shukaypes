import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../../constants/colors';
import { useGameStore } from '../../stores/gameStore';

export default function ProfileScreen() {
  const points = useGameStore((s) => s.points);
  const tokensCollected = useGameStore((s) => s.tokensCollected);
  useFocusEffect(useCallback(() => {
    useGameStore.getState().setScreen('profile');
  }, []));

  return (
    <View style={styles.root}>
      <Text style={styles.title}>profile</Text>
      <Text style={styles.row}>points: {points}</Text>
      <Text style={styles.row}>tokens: {tokensCollected}</Text>
      <Text style={styles.placeholder}>phase 6: skins grid + stats</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.white,
    padding: 24,
    paddingTop: 80,
  },
  title: {
    fontSize: 20,
    color: colors.black,
    marginBottom: 16,
  },
  row: {
    fontSize: 14,
    color: colors.black,
    marginBottom: 6,
  },
  placeholder: {
    fontSize: 12,
    color: colors.greyLight,
    marginTop: 32,
  },
});
