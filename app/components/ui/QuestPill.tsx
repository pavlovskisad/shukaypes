import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useGameStore } from '../../stores/gameStore';
import { colors } from '../../constants/colors';
import { CHIP } from '../../constants/sizing';
import { R } from '../../constants/radius';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
import { useStrings } from '../../i18n/useStrings';
import { popPressableEvent } from '../../utils/popOnTap';

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
        {/* Wraps to multiple lines on long pet names instead
            of truncating — the pill grows vertically and the
            close X stays inside the row (centred on the
            text block). flexShrink + minWidth:0 lets the
            wrap actually kick in inside a flex row. */}
        <Text style={styles.label}>
          {t.hud.findingPet(name)}
        </Text>
        <Text style={styles.progress}>
          {done}/{total}
        </Text>
        <Pressable
          onPress={abandon}
          onPressIn={popPressableEvent}
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
    // Side gutters so the pill can never extend to the
    // viewport edge — combined with the label's truncation,
    // the close X always stays inside the touch area.
    paddingHorizontal: S.l,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.s,
    // Height is content-driven (paddingVertical sets the
    // single-line floor; multi-line names grow the pill).
    // CHIP.height (48) was a fixed cap and clashed with
    // wrapping labels.
    paddingVertical: S.s,
    borderRadius: CHIP.radius,
    paddingLeft: S.l,
    paddingRight: S.s,
    backgroundColor: GLASS_BG,
    // Cap the pill width so a long pet name wraps inside
    // the cap instead of pushing the close button off-screen.
    maxWidth: '100%',
    flexShrink: 1,
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
    // flexShrink + minWidth 0 is the standard "let me
    // ellipsize inside a flex row" trick. Without minWidth 0
    // the label refuses to shrink below its content's
    // natural width.
    flexShrink: 1,
    minWidth: 0,
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
