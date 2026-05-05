import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../../constants/colors';
import { useGameStore, DAILY_TARGETS } from '../../stores/gameStore';
import { SYSTEM_FONT } from '../../constants/fonts';
import { api, type NearbyLostDog } from '../../services/api';
import { distanceMeters } from '../../utils/geo';
import { LostDogModal } from '../../components/ui/LostDogModal';
import { Icon, type IconName } from '../../components/ui/Icon';
import type { LatLng } from '@shukajpes/shared';

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

// Distance from the user to the *nearest edge* of the pet's search
// zone. Friendliest "is this walkable?" signal — being inside the
// zone reads as "in your area" instead of a misleading 0m.
function formatDistanceToZone(userPos: LatLng | null, dog: NearbyLostDog): string {
  if (!userPos) return '';
  const d = distanceMeters(userPos, dog.lastSeen.position);
  const edge = Math.max(0, d - dog.searchZoneRadiusM);
  if (edge === 0) return 'in your area';
  if (edge < 1000) return `${Math.round(edge / 50) * 50}m away`;
  return `${(edge / 1000).toFixed(1)}km away`;
}

function distanceToZoneEdge(userPos: LatLng | null, dog: NearbyLostDog): number {
  if (!userPos) return Infinity;
  return Math.max(0, distanceMeters(userPos, dog.lastSeen.position) - dog.searchZoneRadiusM);
}

type TaskKey = 'tokens' | 'bones' | 'lostPetChecks' | 'spotVisits' | 'sightings';

interface TaskRow {
  key: TaskKey;
  // Either iconName (renders as a pixel <Icon>) or icon (an emoji
  // string fallback for tasks we haven't drawn yet).
  iconName?: IconName;
  icon?: string;
  label: string;
  target: number;
}

const TASKS: TaskRow[] = [
  { key: 'tokens', iconName: 'paws', label: 'collect 10 tokens', target: DAILY_TARGETS.tokens },
  { key: 'bones', iconName: 'bone', label: 'feed 3 bones', target: DAILY_TARGETS.bones },
  {
    key: 'lostPetChecks',
    iconName: 'search',
    label: 'check 2 lost pets',
    target: DAILY_TARGETS.lostPetChecks,
  },
  { key: 'spotVisits', icon: '☕', label: 'visit a spot', target: DAILY_TARGETS.spotVisits },
  {
    key: 'sightings',
    iconName: 'eyes',
    label: "report you've seen a pet",
    target: DAILY_TARGETS.sightings,
  },
];

export default function TasksScreen() {
  const router = useRouter();
  const dailyTasks = useGameStore((s) => s.dailyTasks);
  const refresh = useGameStore((s) => s.refreshDailyTasks);
  const lostDogs = useGameStore((s) => s.lostDogs);
  const userPos = useGameStore((s) => s.userPosition);
  const activeQuest = useGameStore((s) => s.activeQuest);
  const startQuest = useGameStore((s) => s.startQuest);
  const setSelectedDog = useGameStore((s) => s.setSelectedDog);
  const [history, setHistory] = useState<QuestHistoryRow[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [showAllPets, setShowAllPets] = useState(false);
  const [modalDogId, setModalDogId] = useState<string | null>(null);
  const [startingDogId, setStartingDogId] = useState<string | null>(null);

  // Sort by distance-to-zone-edge so the closest pet (most walkable
  // search) sits at the top. In-zone pets bubble to the very top.
  const sortedDogs = useMemo(
    () =>
      [...lostDogs].sort(
        (a, b) => distanceToZoneEdge(userPos, a) - distanceToZoneEdge(userPos, b),
      ),
    [lostDogs, userPos?.lat, userPos?.lng],
  );

  // Default-visible slice — pets already inside their search zone (the
  // walker is in the area), or the 3 closest if none are in zone. The
  // rest collapse behind a "+ N more" row to keep the card compact
  // while still surfacing the most relevant work up-front.
  const { defaultDogs, restDogs } = useMemo(() => {
    const inZone = sortedDogs.filter((d) => distanceToZoneEdge(userPos, d) === 0);
    const outOfZone = sortedDogs.filter((d) => distanceToZoneEdge(userPos, d) > 0);
    if (inZone.length > 0) {
      return { defaultDogs: inZone, restDogs: outOfZone };
    }
    return { defaultDogs: outOfZone.slice(0, 3), restDogs: outOfZone.slice(3) };
  }, [sortedDogs, userPos?.lat, userPos?.lng]);

  const visibleDogs = showAllPets ? sortedDogs : defaultDogs;
  const hiddenCount = showAllPets ? 0 : restDogs.length;
  const modalDog = useMemo(
    () => sortedDogs.find((d) => d.id === modalDogId) ?? null,
    [sortedDogs, modalDogId],
  );

  const handleStartSearch = useCallback(
    async (dog: NearbyLostDog) => {
      if (startingDogId) return;
      setStartingDogId(dog.id);
      try {
        await startQuest(dog.id);
        setSelectedDog(null);
        router.push('/');
      } catch {
        /* gameStore surfaces the error; keep the row open so the user can retry */
      } finally {
        setStartingDogId(null);
      }
    },
    [startQuest, setSelectedDog, startingDogId, router],
  );

  useFocusEffect(
    useCallback(() => {
      useGameStore.getState().setScreen('tasks');
      // Catch the case where the app was open past midnight — reset
      // counters to today's date if the stored entry is from yesterday.
      refresh();
    }, [refresh])
  );

  // Preload neighbour photos on the first modal open so prev/next
  // swipes find them in cache and don't briefly show the grey
  // backdrop while the photo decodes. Browser dedupes by URL.
  // window.Image (not the RN <Image> imported above) is the
  // browser's HTMLImageElement constructor.
  useEffect(() => {
    if (!modalDogId || typeof window === 'undefined') return;
    for (const d of sortedDogs) {
      if (d.photoUrl) {
        const img = new window.Image();
        img.src = d.photoUrl;
      }
    }
  }, [modalDogId, sortedDogs]);

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
                  {t.iconName ? (
                    <View style={styles.iconWrap}>
                      <Icon name={t.iconName} size={20} />
                    </View>
                  ) : (
                    <Text style={styles.icon}>{t.icon}</Text>
                  )}
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

        {/* Lost pets nearby — promoted card, default-visible so the
            quests tab feels alive even before tapping anything. Top
            slice = pets in your search zone (or 3 closest if none),
            "+ N more" reveals the rest. Each row is a clean tap
            target → opens the full LostDogModal in place. No
            inline expansion / chevrons; the modal is the detail
            view. */}
        {sortedDogs.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>lost pets nearby</Text>
            {visibleDogs.map((d, i) => {
              const distLabel = formatDistanceToZone(userPos, d);
              const urgent = d.urgency === 'urgent';
              return (
                <Pressable
                  key={d.id}
                  onPress={() => setModalDogId(d.id)}
                  style={({ pressed }) => [
                    styles.petRow,
                    i > 0 && styles.taskDivider,
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <View style={styles.petAvatar}>
                    <Text style={styles.petAvatarEmoji}>{d.emoji ?? '🐶'}</Text>
                    {d.photoUrl ? (
                      <Image
                        source={{ uri: d.photoUrl }}
                        style={styles.petAvatarImg}
                        resizeMode="cover"
                      />
                    ) : null}
                  </View>
                  <View style={styles.petBody}>
                    <View style={styles.petTopRow}>
                      <Text style={styles.petName} numberOfLines={1}>
                        {d.name}
                      </Text>
                      <Text
                        style={[
                          styles.urgencyTag,
                          urgent ? styles.urgencyUrgent : styles.urgencyMedium,
                        ]}
                      >
                        {urgent ? 'urgent' : 'searching'}
                      </Text>
                    </View>
                    <Text style={styles.petMeta}>
                      {distLabel}
                      {d.breed ? ` · ${d.breed}` : ''}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
            {hiddenCount > 0 ? (
              <Pressable
                onPress={() => setShowAllPets(true)}
                style={({ pressed }) => [
                  styles.moreRow,
                  styles.taskDivider,
                  pressed && { opacity: 0.6 },
                ]}
              >
                <Text style={styles.moreLabel}>+ {hiddenCount} more</Text>
              </Pressable>
            ) : null}
            {showAllPets && restDogs.length > 0 ? (
              <Pressable
                onPress={() => setShowAllPets(false)}
                style={({ pressed }) => [
                  styles.moreRow,
                  styles.taskDivider,
                  pressed && { opacity: 0.6 },
                ]}
              >
                <Text style={styles.moreLabel}>show fewer</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* Past searches — completed/abandoned quests, most recent
            first. Only renders the card when there's something to
            show so a brand-new account doesn't see an empty rail. */}
        {history.length > 0 ? (
          <View style={styles.card}>
            <Pressable
              onPress={() => setHistoryOpen((v) => !v)}
              style={({ pressed }) => [
                styles.cardHeaderRow,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={styles.cardTitle}>past searches</Text>
              <View style={styles.cardHeaderRight}>
                <Text style={styles.cardHeaderCount}>{history.length}</Text>
                <Text style={styles.cardHeaderChevron}>
                  {historyOpen ? '−' : '+'}
                </Text>
              </View>
            </Pressable>
            {historyOpen
              ? history.map((q, i) => (
                  <View
                    key={q.id}
                    style={[styles.historyRow, i > 0 && styles.taskDivider]}
                  >
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
                ))
              : null}
          </View>
        ) : null}

        <Text style={styles.footer}>
          resets at midnight · progress synced to your account
        </Text>
      </ScrollView>

      {/* Same LostDogModal as the map. modalDog comes from local
          state so it doesn't fight with the map's selection (which
          drives the search-zone circle there). onStartSearch routes
          to the map after the quest commits — the user lands on
          the active quest's polyline.

          Prev/next cycle within sortedDogs (closest-first), wrapping
          at the ends so the user can swipe forever. */}
      <LostDogModal
        dog={modalDog}
        onClose={() => setModalDogId(null)}
        searchActive={!!activeQuest && activeQuest.dogId === modalDogId}
        onStartSearch={(d) => handleStartSearch(d)}
        onPrev={
          modalDogId && sortedDogs.length > 1
            ? () => {
                const idx = sortedDogs.findIndex((d) => d.id === modalDogId);
                if (idx < 0) return;
                const prev = sortedDogs[(idx - 1 + sortedDogs.length) % sortedDogs.length]!;
                setModalDogId(prev.id);
              }
            : undefined
        }
        onNext={
          modalDogId && sortedDogs.length > 1
            ? () => {
                const idx = sortedDogs.findIndex((d) => d.id === modalDogId);
                if (idx < 0) return;
                const next = sortedDogs[(idx + 1) % sortedDogs.length]!;
                setModalDogId(next.id);
              }
            : undefined
        }
      />
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
  // Width matches the natural footprint of the emoji glyph above so
  // both code paths align horizontally with the row's label column.
  iconWrap: { width: 22, alignItems: 'center' },
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
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10, // align with cardTitle's marginBottom
  },
  cardHeaderCount: {
    fontSize: 12,
    fontWeight: '700',
    color: '#999',
  },
  cardHeaderChevron: {
    fontSize: 18,
    color: '#aaa',
    fontWeight: '500',
    paddingHorizontal: 4,
  },
  moreRow: {
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(0,60,255,0.85)',
  },
  petRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  petAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  petAvatarEmoji: { fontSize: 20, position: 'absolute' },
  petAvatarImg: { width: '100%', height: '100%' },
  petBody: { flex: 1, minWidth: 0 },
  petTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  petName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.black,
    flexShrink: 1,
  },
  urgencyTag: {
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: 'hidden',
    textTransform: 'lowercase',
    letterSpacing: 0.3,
  },
  urgencyUrgent: { backgroundColor: '#fde8e8', color: '#e84040' },
  urgencyMedium: { backgroundColor: '#fdf3e0', color: '#d9a030' },
  petMeta: { fontSize: 12, color: '#777', marginTop: 2 },
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
