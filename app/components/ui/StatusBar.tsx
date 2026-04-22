import { View, Text, StyleSheet } from 'react-native';
import { useGameStore } from '../../stores/gameStore';
import { balance } from '../../constants/balance';
import { colors } from '../../constants/colors';

// Unified pill: hunger / happiness / tokens (demo lines 362-368).
// Below the `lowThreshold` the fill switches to red. The +12px edge extension
// on fills ensures the rounded right edge is covered (ported exactly).

const SECTION_WIDTH = 78;
const PILL_HEIGHT = 48;
const EDGE_EXTENSION = 14;

function MeterSection({ icon, value, label }: { icon: string; value: number; label: string }) {
  const isLow = value < balance.lowThreshold;
  const fillWidth = Math.round((SECTION_WIDTH * value) / 100) + EDGE_EXTENSION;
  return (
    <View style={styles.section}>
      <View
        style={[
          styles.fill,
          { width: fillWidth, backgroundColor: isLow ? colors.red : colors.accent },
        ]}
      />
      <Text style={styles.emoji}>{icon}</Text>
      <Text
        style={styles.value}
        accessibilityLabel={`${label} ${Math.round(value)} percent`}
      >
        {Math.round(value)}
      </Text>
    </View>
  );
}

export function StatusBar() {
  const hunger = useGameStore((s) => s.hunger);
  const happiness = useGameStore((s) => s.happiness);
  const tokensCollected = useGameStore((s) => s.tokensCollected);

  return (
    <View style={styles.pill} pointerEvents="none">
      <MeterSection icon="🦴" value={hunger} label="hunger" />
      <View style={styles.divider} />
      <MeterSection icon="☀️" value={happiness} label="happiness" />
      <View style={styles.divider} />
      <View style={styles.tokens}>
        <Text style={styles.emoji}>🐾</Text>
        <Text style={styles.tokenCount}>{tokensCollected}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.black,
    borderRadius: PILL_HEIGHT / 2,
    height: PILL_HEIGHT,
    overflow: 'hidden',
    paddingHorizontal: 4,
    minWidth: SECTION_WIDTH * 2 + 80,
  },
  section: {
    width: SECTION_WIDTH,
    height: PILL_HEIGHT,
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  fill: {
    position: 'absolute',
    left: -EDGE_EXTENSION,
    top: 0,
    bottom: 0,
    opacity: 0.85,
  },
  emoji: {
    position: 'absolute',
    left: 10,
    fontSize: 18,
  },
  value: {
    position: 'absolute',
    right: 10,
    color: colors.white,
    fontSize: 15,
    fontWeight: '600',
  },
  divider: {
    width: 1,
    height: 26,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  tokens: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
  },
  tokenCount: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
});
