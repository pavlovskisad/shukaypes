import { View, Text, StyleSheet } from 'react-native';
import { useGameStore } from '../../stores/gameStore';
import { balance } from '../../constants/balance';
import { colors } from '../../constants/colors';

// Unified pill: hunger / happiness / tokens (demo lines 362-368).
// Below the `lowThreshold` the fill switches to red. The +12px edge extension
// on fills ensures the rounded right edge is covered (ported exactly).

// Pill has to share the top-of-screen row with the 200px logo on the
// left on a ~390px device; the previous SECTION_WIDTH + minWidth combo
// ran the pill off the right edge. Compact sections keep it on-screen.
const SECTION_WIDTH = 56;
const PILL_HEIGHT = 44;
const EDGE_EXTENSION = 12;

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
    // Half-transparent black + backdrop blur = frosted glass on web.
    // Safari/chrome/firefox all support backdrop-filter now; anything
    // that doesn't still sees the translucent background (just no blur).
    // react-native-web passes unknown style keys to CSS, which is how
    // backdropFilter reaches the DOM.
    backgroundColor: 'rgba(26,26,26,0.5)',
    // Web-only style keys; react-native-web passes them through to CSS.
    backdropFilter: 'blur(14px) saturate(160%)',
    // @ts-expect-error — safari prefix not in RN style types
    WebkitBackdropFilter: 'blur(14px) saturate(160%)',
    borderRadius: PILL_HEIGHT / 2,
    height: PILL_HEIGHT,
    overflow: 'hidden',
    paddingHorizontal: 4,
    // Dropped the minWidth — sections define their own width and we
    // don't want the pill stretching to push past the screen edge.
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
    left: 8,
    fontSize: 15,
  },
  value: {
    position: 'absolute',
    right: 8,
    color: colors.white,
    fontSize: 13,
    fontWeight: '600',
  },
  divider: {
    width: 1,
    height: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  tokens: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    gap: 6,
  },
  tokenCount: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
});
