import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useGameStore } from '../../stores/gameStore';
import { colors } from '../../constants/colors';

// Four white-frosted-glass pills laid out identically: icon + value with
// a consistent gap so happiness / hunger / tokens / spots-toggle read
// as one family. Happiness shows a progress fill (mood meter, only %
// pill). Hunger and tokens are plain counters. The rightmost is a
// tap-to-toggle visibility switch for the spots layer.

const PILL_HEIGHT = 38;
// Minimum so a 1-char value doesn't collapse the pill awkwardly; beyond
// that, each pill sizes to its content and grows when the number widens.
const PILL_MIN_WIDTH = 50;

const PROGRESS_BLUE = 'rgba(0,60,255,0.85)';
const GLASS_BG = 'rgba(255,255,255,0.85)';
const GLASS_SHADOW_COLOR = '#000';

function HappinessPill({ value }: { value: number }) {
  const fillPct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <View style={[styles.pill, styles.meterPill]}>
      <View
        style={[
          styles.fill,
          {
            width: `${fillPct}%` as unknown as number,
            backgroundColor: PROGRESS_BLUE,
          },
        ]}
      />
      <Text style={styles.emoji}>☀️</Text>
      <Text
        style={styles.value}
        accessibilityLabel={`happiness ${Math.round(value)} percent`}
      >
        {Math.round(value)}%
      </Text>
    </View>
  );
}

function CounterPill({ icon, value, label }: { icon: string; value: number; label: string }) {
  return (
    <View style={[styles.pill, styles.counterPill]}>
      <Text style={styles.emoji}>{icon}</Text>
      <Text style={styles.value} accessibilityLabel={`${label} ${Math.round(value)}`}>
        {Math.round(value)}
      </Text>
    </View>
  );
}

// Tap-to-toggle visibility of the spots overlay. The eye-with-slash
// overlay on top of the pin reads as a familiar "hidden" stamp; ON
// state shows just the pin. Default is OFF so first load isn't
// cluttered with every nearby cafe — user explicitly opts in.
function SpotsTogglePill() {
  const visible = useGameStore((s) => s.spotsVisible);
  const setVisible = useGameStore((s) => s.setSpotsVisible);
  return (
    <Pressable
      onPress={() => setVisible(!visible)}
      accessibilityRole="switch"
      accessibilityState={{ checked: visible }}
      accessibilityLabel={`spots ${visible ? 'visible' : 'hidden'}`}
      style={({ pressed }) => [
        styles.pill,
        styles.togglePill,
        !visible && styles.togglePillOff,
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={styles.iconStack}>
        <Text style={[styles.emoji, !visible && styles.emojiDim]}>📍</Text>
        {!visible ? (
          <Text style={styles.iconStampOff} accessibilityElementsHidden>
            🚫
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function StatusBar() {
  const hunger = useGameStore((s) => s.hunger);
  const happiness = useGameStore((s) => s.happiness);
  const tokensCollected = useGameStore((s) => s.tokensCollected);

  return (
    // box-none so the toggle pill receives taps while the wrap itself
    // doesn't swallow gestures aimed at the map.
    <View style={styles.wrap} pointerEvents="box-none">
      <HappinessPill value={happiness} />
      <CounterPill icon="🦴" value={hunger} label="hunger" />
      <CounterPill icon="🐾" value={tokensCollected} label="tokens" />
      <SpotsTogglePill />
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 6,
  },
  meterPill: {
    minWidth: PILL_MIN_WIDTH,
  },
  counterPill: {
    minWidth: PILL_MIN_WIDTH,
  },
  togglePill: {
    // No min-width — icon hugs content. Slightly wider padding than
    // the counter pills so the pin + stamp overlay sit comfortably.
    paddingHorizontal: 12,
  },
  togglePillOff: {
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  iconStack: {
    position: 'relative',
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconStampOff: {
    position: 'absolute',
    fontSize: 16,
    top: -2,
    left: -1,
  },
  emojiDim: {
    opacity: 0.55,
  },
  fill: {
    position: 'absolute',
    left: 0,
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
