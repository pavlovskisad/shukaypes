import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useGameStore } from '../../stores/gameStore';
import { colors } from '../../constants/colors';
import { CHIP } from '../../constants/sizing';
import { R } from '../../constants/radius';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
import { useStrings } from '../../i18n/useStrings';

// Active-quest indicator. Renders nothing when no quest is live; when
// one is, shows a pill with pet name + progress (2/3) + an X to abandon.
// Matches the frosted-glass recipe used on the status bar so it reads
// as part of the same HUD family.

const GLASS_BG = '#ffffff';

export function QuestPill() {
  const activeQuest = useGameStore((s) => s.activeQuest);
  const lostDogs = useGameStore((s) => s.lostDogs);
  const abandon = useGameStore((s) => s.abandonActiveQuest);

  const t = useStrings();

  if (!activeQuest) return null;

  const dog = activeQuest.dogId
    ? lostDogs.find((d) => d.id === activeQuest.dogId)
    : null;
  const name = dog?.name ?? '';
  const total = activeQuest.waypoints.length;
  const done = Math.min(activeQuest.currentWaypoint, total);

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.pill}>
        <Text style={styles.emoji}>🔍</Text>
        <Text style={styles.label}>{t.hud.findingPet(name)}</Text>
        <Text style={styles.progress}>
          {done}/{total}
        </Text>
        <Pressable
          onPress={abandon}
          hitSlop={8}
          accessibilityLabel={t.hud.abandonSearch}
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
    gap: S.s,
    height: CHIP.height,
    borderRadius: CHIP.radius,
    paddingLeft: S.l,
    paddingRight: S.s,
    backgroundColor: GLASS_BG,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 3,
  },
  emoji: {
    fontSize: TYPE.small,
  },
  label: {
    color: colors.black,
    fontSize: TYPE.small,
    fontWeight: '600',
  },
  progress: {
    color: colors.black,
    fontSize: TYPE.small,
    fontWeight: '800',
    marginLeft: 2,
  },
  close: {
    width: 26,
    height: 26,
    borderRadius: R.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: S.xs,
  },
  closeTxt: {
    color: '#666',
    fontSize: TYPE.hero,
    lineHeight: 22,
    fontWeight: '400',
  },
});
