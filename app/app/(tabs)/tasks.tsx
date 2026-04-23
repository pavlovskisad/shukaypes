import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { colors } from '../../constants/colors';
import { useGameStore, DAILY_TARGETS } from '../../stores/gameStore';
import { SYSTEM_FONT } from '../../constants/fonts';

type TaskKey = 'tokens' | 'bones' | 'lostPetChecks' | 'spotVisits' | 'sightings';

interface TaskRow {
  key: TaskKey;
  icon: string;
  label: string;
  target: number;
}

const TASKS: TaskRow[] = [
  { key: 'tokens', icon: '🐾', label: 'collect 10 tokens', target: DAILY_TARGETS.tokens },
  { key: 'bones', icon: '🦴', label: 'feed 3 bones', target: DAILY_TARGETS.bones },
  { key: 'lostPetChecks', icon: '🔍', label: 'check 2 lost pets', target: DAILY_TARGETS.lostPetChecks },
  { key: 'spotVisits', icon: '☕', label: 'visit a spot', target: DAILY_TARGETS.spotVisits },
  { key: 'sightings', icon: '👀', label: "report you've seen a pet", target: DAILY_TARGETS.sightings },
];

export default function TasksScreen() {
  const dailyTasks = useGameStore((s) => s.dailyTasks);
  const refresh = useGameStore((s) => s.refreshDailyTasksIfStale);

  useFocusEffect(useCallback(() => {
    useGameStore.getState().setScreen('tasks');
    // Catch the case where the app was open past midnight — reset
    // counters to today's date if the stored entry is from yesterday.
    refresh();
  }, [refresh]));

  const doneCount = TASKS.filter((t) => dailyTasks[t.key] >= t.target).length;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>daily tasks</Text>
        <Text style={styles.subtitle}>
          {doneCount}/{TASKS.length} done
        </Text>
      </View>

      {TASKS.map((t) => {
        const value = Math.min(dailyTasks[t.key], t.target);
        const progress = Math.min(value / t.target, 1);
        const complete = value >= t.target;
        return (
          <View key={t.key} style={styles.task}>
            <View style={styles.row}>
              <Text style={styles.icon}>{t.icon}</Text>
              <Text style={[styles.label, complete && styles.labelDone]}>{t.label}</Text>
              <Text style={styles.count}>
                {value}/{t.target}
                {complete ? ' ✓' : ''}
              </Text>
            </View>
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.barFill,
                  { width: `${progress * 100}%`, backgroundColor: complete ? colors.black : colors.accent },
                ]}
              />
            </View>
          </View>
        );
      })}

      <Text style={styles.footer}>
        resets at midnight · progress saved on this device
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  content: { padding: 20, paddingTop: 32, paddingBottom: 120 },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 22,
  },
  title: {
    fontFamily: SYSTEM_FONT,
    fontSize: 28,
    color: colors.black,
  },
  subtitle: {
    fontSize: 13,
    color: colors.grey,
  },
  task: {
    marginBottom: 18,
    backgroundColor: colors.greyBg,
    borderRadius: 14,
    padding: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 10,
  },
  icon: { fontSize: 18 },
  label: { flex: 1, fontSize: 14, color: colors.black },
  labelDone: { color: colors.grey, textDecorationLine: 'line-through' },
  count: { fontSize: 12, color: colors.grey },
  barTrack: {
    height: 7,
    backgroundColor: colors.greyPale,
    borderRadius: 4,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
  },
  footer: {
    fontSize: 11,
    color: colors.greyLight,
    marginTop: 20,
    textAlign: 'center',
  },
});
