import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../../constants/colors';
import { useGameStore } from '../../stores/gameStore';

export default function TasksScreen() {
  const tokensCollected = useGameStore((s) => s.tokensCollected);
  const tokenTarget = 10;
  const tokenProgress = Math.min(tokensCollected / tokenTarget, 1);

  return (
    <View style={styles.root}>
      <Text style={styles.title}>daily tasks</Text>

      <View style={styles.task}>
        <Text style={styles.label}>🐾 collect 10 tokens</Text>
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${tokenProgress * 100}%` }]} />
        </View>
        <Text style={styles.count}>
          {Math.min(tokensCollected, tokenTarget)}/{tokenTarget}
          {tokensCollected >= tokenTarget ? ' ✓' : ''}
        </Text>
      </View>

      <Text style={styles.placeholder}>
        phase 6: walk 1km · check lost dog · wave at walker
      </Text>
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
    marginBottom: 24,
  },
  task: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    color: colors.black,
    marginBottom: 8,
  },
  barTrack: {
    height: 8,
    backgroundColor: colors.greyPale,
    borderRadius: 4,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: colors.accent,
  },
  count: {
    fontSize: 12,
    color: colors.grey,
    marginTop: 4,
  },
  placeholder: {
    fontSize: 12,
    color: colors.greyLight,
    marginTop: 32,
  },
});
