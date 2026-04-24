import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useGameStore } from '../../stores/gameStore';
import { colors } from '../../constants/colors';

// Active-quest indicator. Renders nothing when no quest is live; when
// one is, shows a pill with pet name + progress (2/3) + an X to abandon.
// Matches the frosted-glass recipe used on the status bar so it reads
// as part of the same HUD family.

const GLASS_BG = 'rgba(255,255,255,0.85)';

export function QuestPill() {
  const activeQuest = useGameStore((s) => s.activeQuest);
  const lostDogs = useGameStore((s) => s.lostDogs);
  const abandon = useGameStore((s) => s.abandonActiveQuest);

  if (!activeQuest) return null;

  const dog = activeQuest.dogId
    ? lostDogs.find((d) => d.id === activeQuest.dogId)
    : null;
  const name = dog?.name ?? 'this one';
  const total = activeQuest.waypoints.length;
  const done = Math.min(activeQuest.currentWaypoint, total);

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.pill}>
        <Text style={styles.emoji}>🔍</Text>
        <Text style={styles.label}>finding {name}</Text>
        <Text style={styles.progress}>
          {done}/{total}
        </Text>
        <Pressable
          onPress={abandon}
          hitSlop={8}
          accessibilityLabel="abandon search"
          style={styles.close}
        >
          <Text style={styles.closeTxt}>×</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 38,
    borderRadius: 19,
    paddingLeft: 14,
    paddingRight: 6,
    backgroundColor: GLASS_BG,
    backdropFilter: 'blur(14px) saturate(160%)',
    // @ts-expect-error — safari prefix not in RN style types
    WebkitBackdropFilter: 'blur(14px) saturate(160%)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 3,
  },
  emoji: {
    fontSize: 14,
  },
  label: {
    color: colors.black,
    fontSize: 13,
    fontWeight: '600',
  },
  progress: {
    color: colors.black,
    fontSize: 13,
    fontWeight: '800',
    marginLeft: 2,
  },
  close: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  closeTxt: {
    color: '#666',
    fontSize: 20,
    lineHeight: 22,
    fontWeight: '400',
  },
});
