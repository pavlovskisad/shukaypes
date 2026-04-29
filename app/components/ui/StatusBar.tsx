import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useGameStore } from '../../stores/gameStore';
import { colors } from '../../constants/colors';

// Four white-frosted-glass pills laid out identically: icon + value with
// a consistent gap so happiness / hunger / tokens / spots-toggle read
// as one family. Happiness + hunger are 0-100 meters with a blue
// progress fill; the paw pill is a lifetime count. The rightmost is a
// tap-to-toggle visibility switch for the spots layer.

const PILL_HEIGHT = 38;
// Minimum so a 1-char value doesn't collapse the pill awkwardly; beyond
// that, each pill sizes to its content and grows when the number widens.
const PILL_MIN_WIDTH = 50;

const PROGRESS_BLUE = 'rgba(0,60,255,0.85)';
const GLASS_BG = 'rgba(255,255,255,0.85)';
const GLASS_SHADOW_COLOR = '#000';

function MeterPill({
  icon,
  value,
  label,
}: {
  icon: string;
  value: number;
  label: string;
}) {
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
      <Text style={styles.emoji}>{icon}</Text>
      <Text
        style={styles.value}
        accessibilityLabel={`${label} ${fillPct} percent`}
      >
        {fillPct}%
      </Text>
    </View>
  );
}

function CounterPill({
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
  return (
    <View style={[styles.pill, styles.counterPill]}>
      <Text style={styles.emoji}>{icon}</Text>
      <Text style={styles.value} accessibilityLabel={`${label} ${Math.round(value)}`}>
        {Math.round(value)}
        {suffix ?? ''}
      </Text>
    </View>
  );
}

// Tap-to-toggle visibility of the spots overlay. Off state dims the
// pin emoji + softens the pill bg; on state matches the rest of the
// HUD family. Independent of whether spots are loaded into the
// store — the user can hide the cached layer without re-fetching.
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
      <Text style={[styles.emoji, !visible && styles.emojiOff]}>📍</Text>
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
    // Hunger reads as % (0-100 meter, like happiness) so a +20 bump
    // is obviously "+20% fed", not "I ate 20 bones". Paw pill keeps
    // the lifetime collected count.
    <View style={styles.wrap} pointerEvents="box-none">
      <MeterPill icon="☀️" value={happiness} label="happiness" />
      <MeterPill icon="🦴" value={hunger} label="hunger" />
      <CounterPill icon="🐾" value={tokensCollected} label="paws" />
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
    paddingHorizontal: 12,
  },
  togglePillOff: {
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  emojiOff: {
    // grayscale the color emoji so the "off" state reads as b&w —
    // RN Web passes `filter` straight through to CSS.
    filter: 'grayscale(1)',
    opacity: 0.7,
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
