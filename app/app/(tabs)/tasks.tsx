import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../../constants/colors';
import { useGameStore, DAILY_TARGETS } from '../../stores/gameStore';
import { SYSTEM_FONT } from '../../constants/fonts';
import { api } from '../../services/api';

interface QuestHistoryRow {
  id: string;
  dogName: string | null;
  dogEmoji: string | null;
  status: 'completed' | 'abandoned';
  endedAt: string;
  rewardPoints: number;
}

function relativeWhen(iso: string): string {
  const then = new Date(iso).getTime();
  const diffM = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (diffM < 60) return `${diffM}m ago`;
  const diffH = Math.round(diffM / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.round(diffH / 24);
  return `${diffD}d ago`;
}

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
  const [history, setHistory] = useState<QuestHistoryRow[]>([]);

  useFocusEffect(
    useCallback(() => {
      useGameStore.getState().setScreen('tasks');
      // Catch the case where the app was open past midnight — reset
      // counters to today's date if the stored entry is from yesterday.
      refresh();
    }, [refresh])
  );

  // Refetch quest history on focus so a freshly completed quest shows
  // up immediately. Errors fail silent — the card just stays empty.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      api
        .getQuestHistory()
        .then((res) => {
          if (cancelled) return;
          setHistory(
            res.quests.map((q) => ({
              id: q.id,
              dogName: q.dogName,
              dogEmoji: q.dogEmoji,
              status: q.status,
              endedAt: q.endedAt,
              rewardPoints: q.rewardPoints,
            })),
          );
        })
        .catch(() => {
          /* fail silent */
        });
      return () => {
        cancelled = true;
      };
    }, []),
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

        {/* Past searches — completed/abandoned quests, most recent
            first. Only renders the card when there's something to
            show so a brand-new account doesn't see an empty rail. */}
        {history.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>past searches</Text>
            {history.map((q, i) => (
              <View key={q.id} style={[styles.historyRow, i > 0 && styles.taskDivider]}>
                <Text style={styles.icon}>{q.dogEmoji ?? '🐶'}</Text>
                <View style={styles.historyBody}>
                  <Text style={styles.historyName} numberOfLines={1}>
                    {q.dogName ?? 'unknown pet'}
                  </Text>
                  <Text style={styles.historyMeta}>
                    {q.status === 'completed' ? 'finished' : 'abandoned'} ·{' '}
                    {relativeWhen(q.endedAt)}
                    {q.status === 'completed' ? ` · +${q.rewardPoints}pts` : ''}
                  </Text>
                </View>
                {q.status === 'completed' ? (
                  <Text style={styles.historyTickDone}>✓</Text>
                ) : (
                  <Text style={styles.historyTickAbandon}>×</Text>
                )}
              </View>
            ))}
          </View>
        ) : null}

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
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  historyBody: { flex: 1, minWidth: 0 },
  historyName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.black,
  },
  historyMeta: {
    fontSize: 12,
    color: '#777',
    marginTop: 2,
  },
  historyTickDone: {
    fontSize: 16,
    color: 'rgba(0,60,255,0.85)',
    fontWeight: '700',
  },
  historyTickAbandon: {
    fontSize: 18,
    color: '#bbb',
    fontWeight: '700',
  },
  footer: {
    fontSize: 11,
    color: '#999',
    marginTop: 4,
    textAlign: 'center',
  },
});
