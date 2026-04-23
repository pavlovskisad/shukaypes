import { View, Text, StyleSheet } from 'react-native';
import { useGameStore } from '../../stores/gameStore';
import { balance } from '../../constants/balance';
import { colors } from '../../constants/colors';

// Three separate white-frosted-glass pills, all laid out the same way:
// icon + value next to each other with a consistent gap, so hunger,
// happiness and tokens read as siblings. Progress fill behind the content
// (terminal blue; red when low).

const PILL_HEIGHT = 38;
const METER_MIN_WIDTH = 74;
const TOKEN_MIN_WIDTH = 62;
const EDGE_EXTENSION = 12;

const PROGRESS_BLUE = 'rgba(0,60,255,0.85)';
const LOW_RED = 'rgba(232,64,64,0.9)';
const GLASS_BG = 'rgba(255,255,255,0.85)';
const GLASS_SHADOW_COLOR = '#000';

function MeterPill({
  icon,
  value,
  label,
  suffix,
}: {
  icon: string;
  value: number;
  label: string;
  suffix?: string;
}) {
  const isLow = value < balance.lowThreshold;
  // Progress fill is sized relative to pill's minWidth; the pill itself
  // may grow slightly if the value takes extra chars ("100%") but the
  // fill happily stretches because it's absolute inset.
  const fillWidth = Math.round((METER_MIN_WIDTH * value) / 100) + EDGE_EXTENSION;
  return (
    <View style={[styles.pill, styles.meterPill]}>
      <View
        style={[
          styles.fill,
          {
            width: fillWidth,
            backgroundColor: isLow ? LOW_RED : PROGRESS_BLUE,
          },
        ]}
      />
      <Text style={styles.emoji}>{icon}</Text>
      <Text
        style={styles.value}
        accessibilityLabel={`${label} ${Math.round(value)}${suffix === '%' ? ' percent' : ''}`}
      >
        {Math.round(value)}{suffix ?? ''}
      </Text>
    </View>
  );
}

export function StatusBar() {
  const hunger = useGameStore((s) => s.hunger);
  const happiness = useGameStore((s) => s.happiness);
  const tokensCollected = useGameStore((s) => s.tokensCollected);

  return (
    <View style={styles.wrap} pointerEvents="none">
      <MeterPill icon="☀️" value={happiness} label="happiness" suffix="%" />
      <MeterPill icon="🦴" value={hunger} label="hunger" />
      <View style={[styles.pill, styles.tokenPill]}>
        <Text style={styles.emoji}>🐾</Text>
        <Text style={styles.value}>{tokensCollected}</Text>
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
    backdropFilter: 'blur(14px) saturate(160%)',
    // @ts-expect-error — safari prefix not in RN style types
    WebkitBackdropFilter: 'blur(14px) saturate(160%)',
    shadowColor: GLASS_SHADOW_COLOR,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 3,
    // All pills use the same row layout with a consistent inner gap so
    // hunger/happiness/tokens read as one family (previously meter pills
    // used space-between, which spread the icon and value artificially
    // wide compared to the tight token pill).
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 6,
  },
  meterPill: {
    minWidth: METER_MIN_WIDTH,
  },
  tokenPill: {
    minWidth: TOKEN_MIN_WIDTH,
  },
  fill: {
    position: 'absolute',
    left: -EDGE_EXTENSION,
    top: 0,
    bottom: 0,
    opacity: 0.75,
  },
  emoji: {
    fontSize: 14,
  },
  value: {
    color: colors.black,
    fontSize: 13,
    fontWeight: '700',
  },
});
