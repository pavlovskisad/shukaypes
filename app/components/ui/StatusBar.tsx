import { View, Text, StyleSheet } from 'react-native';
import { useGameStore } from '../../stores/gameStore';
import { balance } from '../../constants/balance';
import { colors } from '../../constants/colors';

// Three separate white-frosted-glass pills instead of one combined dark
// pill — each meter reads as its own module. Progress fills use terminal
// blue to match the lost-pet beacon language elsewhere on the map; low
// state is red as before. Icons are unchanged.

const PILL_HEIGHT = 38;
const METER_WIDTH = 78;
const TOKEN_MIN_WIDTH = 62;
const EDGE_EXTENSION = 12;

const PROGRESS_BLUE = 'rgba(0,60,255,0.85)';
const LOW_RED = 'rgba(232,64,64,0.9)';
const GLASS_BG = 'rgba(255,255,255,0.85)';
const GLASS_SHADOW_COLOR = '#000';

function MeterPill({ icon, value, label }: { icon: string; value: number; label: string }) {
  const isLow = value < balance.lowThreshold;
  const fillWidth = Math.round((METER_WIDTH * value) / 100) + EDGE_EXTENSION;
  return (
    <View style={styles.pill}>
      <View
        style={[
          styles.fill,
          {
            width: fillWidth,
            backgroundColor: isLow ? LOW_RED : PROGRESS_BLUE,
          },
        ]}
      />
      <View style={styles.meterBody}>
        <Text style={styles.emoji}>{icon}</Text>
        <Text
          style={styles.value}
          accessibilityLabel={`${label} ${Math.round(value)} percent`}
        >
          {Math.round(value)}
        </Text>
      </View>
    </View>
  );
}

export function StatusBar() {
  const hunger = useGameStore((s) => s.hunger);
  const happiness = useGameStore((s) => s.happiness);
  const tokensCollected = useGameStore((s) => s.tokensCollected);

  return (
    <View style={styles.wrap} pointerEvents="none">
      <MeterPill icon="🦴" value={hunger} label="hunger" />
      <MeterPill icon="☀️" value={happiness} label="happiness" />
      <View style={[styles.pill, styles.tokenPill]}>
        <Text style={styles.emoji}>🐾</Text>
        <Text style={styles.tokenCount}>{tokensCollected}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pill: {
    height: PILL_HEIGHT,
    borderRadius: PILL_HEIGHT / 2,
    overflow: 'hidden',
    backgroundColor: GLASS_BG,
    // Web-only; react-native-web passes through to CSS.
    backdropFilter: 'blur(14px) saturate(160%)',
    // @ts-expect-error — safari prefix not in RN style types
    WebkitBackdropFilter: 'blur(14px) saturate(160%)',
    // Soft diffuse shadow instead of a hard border — matches the
    // reference pill treatment (clean white with a gentle lift).
    shadowColor: GLASS_SHADOW_COLOR,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 3,
    position: 'relative',
    width: METER_WIDTH,
    justifyContent: 'center',
  },
  tokenPill: {
    width: undefined,
    minWidth: TOKEN_MIN_WIDTH,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 6,
  },
  fill: {
    position: 'absolute',
    left: -EDGE_EXTENSION,
    top: 0,
    bottom: 0,
    opacity: 0.75,
  },
  meterBody: {
    flex: 1,
    height: PILL_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
  },
  emoji: {
    fontSize: 14,
  },
  value: {
    color: colors.black,
    fontSize: 13,
    fontWeight: '700',
  },
  tokenCount: {
    color: colors.black,
    fontSize: 14,
    fontWeight: '700',
  },
});
