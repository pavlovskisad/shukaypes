import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
  {
    key: 'lostPetChecks',
    icon: '🔍',
    label: 'check 2 lost pets',
    target: DAILY_TARGETS.lostPetChecks,
  },
  { key: 'spotVisits', icon: '☕', label: 'visit a spot', target: DAILY_TARGETS.spotVisits },
  {
    key: 'sightings',
    icon: '👀',
    label: "report you've seen a pet",
    target: DAILY_TARGETS.sightings,
  },
];

export default function TasksScreen() {
  const dailyTasks = useGameStore((s) => s.dailyTasks);
  const refresh = useGameStore((s) => s.refreshDailyTasksIfStale);

  useFocusEffect(
    useCallback(() => {
      useGameStore.getState().setScreen('tasks');
      // Catch the case where the app was open past midnight — reset
      // counters to today's date if the stored entry is from yesterday.
      refresh();
    }, [refresh])
  );

  const doneCount = TASKS.filter((t) => dailyTasks[t.key] >= t.target).length;
  const summaryProgress = doneCount / TASKS.length;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Summary card mirrors the Profile companion card — large
            headline number, slim progress bar underneath. */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>daily tasks</Text>
          <Text style={styles.summaryNum}>
            {doneCount}
            <Text style={styles.summaryNumDim}> / {TASKS.length}</Text>
          </Text>
          <Text style={styles.summaryLabel}>completed today</Text>
          <View style={styles.summaryBarTrack}>
            <View
              style={[
                styles.summaryBarFill,
                {
                  width: `${Math.round(summaryProgress * 100)}%` as unknown as number,
                },
              ]}
            />
          </View>
        </View>

        {/* All tasks live in one card, hairline-divided rows. */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>today's quests</Text>
          {TASKS.map((t, i) => {
            const value = Math.min(dailyTasks[t.key], t.target);
            const progress = Math.min(value / t.target, 1);
            const complete = value >= t.target;
            return (
              <View key={t.key} style={[styles.task, i > 0 && styles.taskDivider]}>
                <View style={styles.row}>
                  <Text style={styles.icon}>{t.icon}</Text>
                  <Text style={[styles.label, complete && styles.labelDone]}>
                    {t.label}
                  </Text>
                  <Text style={[styles.count, complete && styles.countDone]}>
                    {value}/{t.target}
                    {complete ? ' ✓' : ''}
                  </Text>
                </View>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFill,
                      {
                        width: `${progress * 100}%` as unknown as number,
                        backgroundColor: complete
                          ? 'rgba(0,0,0,0.45)'
                          : 'rgba(0,60,255,0.85)',
                      },
                    ]}
                  />
                </View>
              </View>
            );
          })}
        </View>

        <Text style={styles.footer}>
          resets at midnight · progress saved on this device
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.greyBg },
  content: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 120, gap: 12 },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  cardTitle: {
    fontFamily: SYSTEM_FONT,
    fontSize: 14,
    color: '#777',
    marginBottom: 10,
    textTransform: 'lowercase',
    letterSpacing: 0.3,
  },
  summaryNum: {
    fontFamily: SYSTEM_FONT,
    fontSize: 44,
    fontWeight: '800',
    color: colors.black,
    textAlign: 'center',
    lineHeight: 48,
    marginTop: 4,
  },
  summaryNumDim: {
    color: '#aaa',
    fontWeight: '500',
  },
  summaryLabel: {
    fontSize: 13,
    color: '#777',
    textAlign: 'center',
    marginTop: 2,
    marginBottom: 12,
  },
  summaryBarTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.06)',
    marginHorizontal: 24,
    overflow: 'hidden',
  },
  summaryBarFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: 'rgba(0,60,255,0.85)',
  },
  task: {
    paddingVertical: 12,
  },
  taskDivider: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 10,
  },
  icon: { fontSize: 18 },
  label: { flex: 1, fontSize: 14, color: colors.black },
  labelDone: { color: '#aaa', textDecorationLine: 'line-through' },
  count: { fontSize: 12, color: '#777', fontWeight: '700' },
  countDone: { color: '#666' },
  barTrack: {
    height: 6,
    backgroundColor: 'rgba(0,0,0,0.06)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 3 },
  footer: {
    fontSize: 11,
    color: '#999',
    marginTop: 4,
    textAlign: 'center',
  },
});
