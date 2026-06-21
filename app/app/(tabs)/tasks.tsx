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
import { LostDogCardStack } from '../../components/ui/LostDogCardStack';
import { Icon, type IconName } from '../../components/ui/Icon';
import type { LatLng } from '@shukajpes/shared';
import { useStrings } from '../../i18n/useStrings';

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
  // Key into t.tasks.items so the row label is localised at render
  // time without dragging the strings table into a top-level const.
  labelKey: 'collectTokens' | 'feedBones' | 'checkLostPets' | 'visitSpot' | 'reportSighting';
  target: number;
}

const TASKS: TaskRow[] = [
  { key: 'tokens', iconName: 'paws', labelKey: 'collectTokens', target: DAILY_TARGETS.tokens },
  { key: 'bones', iconName: 'bone', labelKey: 'feedBones', target: DAILY_TARGETS.bones },
  {
    key: 'lostPetChecks',
    iconName: 'search',
    labelKey: 'checkLostPets',
    target: DAILY_TARGETS.lostPetChecks,
  },
  { key: 'spotVisits', iconName: 'cafe', labelKey: 'visitSpot', target: DAILY_TARGETS.spotVisits },
  {
    key: 'sightings',
    iconName: 'eyes',
    labelKey: 'reportSighting',
    target: DAILY_TARGETS.sightings,
  },
];

export default function TasksScreen() {
  const t = useStrings();
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
  // View mode for the lost-pets section — 'stack' is the new card
  // stack prototype, 'list' is the legacy rendering. Local state for
  // now; if the stack feels right we promote it to the default and
  // drop the toggle.
  const [lostView, setLostView] = useState<'stack' | 'list'>('stack');
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

  const doneCount = TASKS.filter((row) => dailyTasks[row.key] >= row.target).length;

  // Inject the snap-pop keyframes once into <head>. The class is
  // added programmatically to whichever card just snapped (see the
  // IntersectionObserver effect below). Web-only — guards the
  // document access so SSR / native bundlers don't trip.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.getElementById('tasks-snap-pop-style')) return;
    const el = document.createElement('style');
    el.id = 'tasks-snap-pop-style';
    el.textContent = `
      @keyframes tasks-snap-pop {
        0%   { transform: translateY(0)     scale(1);    }
        28%  { transform: translateY(-14px) scale(1.07); }
        100% { transform: translateY(0)     scale(1);    }
      }
      .tasks-snap-pop {
        animation: tasks-snap-pop 620ms cubic-bezier(0.32, 0.72, 0, 1) both;
      }
    `;
    document.head.appendChild(el);
  }, []);

  // Pop the dominant snap-card when it changes. Uses
  // IntersectionObserver against the cards' stable nativeIDs —
  // way more reliable than the previous scroll-end approach
  // which silently broke whenever scroll events stopped bubbling
  // through RN-Web's internal wrapper.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (typeof IntersectionObserver === 'undefined') return;

    // Skip pops for the first 600ms so the initial landing on the
    // lost-pets card doesn't trigger an animation.
    let isInitial = true;
    const initTimer = setTimeout(() => {
      isInitial = false;
    }, 600);

    let observer: IntersectionObserver | null = null;
    let lastDominant: Element | null = null;

    const setup = () => {
      const cards = Array.from(document.querySelectorAll<HTMLElement>('[id^="snap-card-"]'));
      if (cards.length === 0) return false;

      // Per-card intersection ratio cache so we can compare on every
      // callback fire without re-measuring each card.
      const ratios = new Map<Element, number>();
      cards.forEach((c) => ratios.set(c, 0));

      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => ratios.set(e.target, e.intersectionRatio));
          // Pick the card with the highest visible ratio. That's the
          // dominant one — i.e. the one snap has settled on.
          let dominant: Element | null = null;
          let best = -1;
          ratios.forEach((r, el) => {
            if (r > best) {
              best = r;
              dominant = el;
            }
          });
          if (dominant && dominant !== lastDominant && best > 0.6) {
            if (!isInitial) {
              const target = dominant as HTMLElement;
              target.classList.remove('tasks-snap-pop');
              // Force reflow so the animation restarts even if the
              // class was just removed.
              void target.offsetWidth;
              target.classList.add('tasks-snap-pop');
            }
            lastDominant = dominant;
          }
        },
        { threshold: [0, 0.3, 0.5, 0.7, 0.9, 1] },
      );

      cards.forEach((c) => observer!.observe(c));
      return true;
    };

    // Cards may not be in the DOM yet on first effect tick — retry
    // until we find at least one.
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    if (!setup()) {
      retryTimer = setTimeout(() => {
        setup();
      }, 100);
    }

    return () => {
      if (observer) observer.disconnect();
      if (retryTimer) clearTimeout(retryTimer);
      clearTimeout(initTimer);
    };
  }, []);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} style={styles.scroller}>
        {/* Lost pets nearby — promoted to the top of the tab so the
            most actionable thing on the screen is the first thing
            the user sees. Stack is the default view; list is a tap
            away via the header toggle. */}
        {sortedDogs.length > 0 ? (
          <View nativeID="snap-card-lost" style={styles.card}>
            <View style={styles.lostHeaderRow}>
              <Text style={styles.cardTitle}>{t.tasks.lostPetsNearby}</Text>
              <View style={styles.viewToggle}>
                <Pressable
                  onPress={() => setLostView('stack')}
                  style={[
                    styles.viewTogglePill,
                    lostView === 'stack' && styles.viewTogglePillActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.viewToggleText,
                      lostView === 'stack' && styles.viewToggleTextActive,
                    ]}
                  >
                    стек
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setLostView('list')}
                  style={[
                    styles.viewTogglePill,
                    lostView === 'list' && styles.viewTogglePillActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.viewToggleText,
                      lostView === 'list' && styles.viewToggleTextActive,
                    ]}
                  >
                    список
                  </Text>
                </Pressable>
              </View>
            </View>
            {lostView === 'stack' ? (
              <LostDogCardStack dogs={sortedDogs} onTap={(d) => setModalDogId(d.id)} />
            ) : null}
            {lostView === 'list' ? visibleDogs.map((d, i) => {
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
                        {urgent ? t.tasks.badgeUrgent : t.tasks.badgeSearching}
                      </Text>
                    </View>
                    <Text style={styles.petMeta}>
                      {distLabel}
                      {d.breed ? ` · ${d.breed}` : ''}
                    </Text>
                  </View>
                </Pressable>
              );
            }) : null}
            {lostView === 'list' && hiddenCount > 0 ? (
              <Pressable
                onPress={() => setShowAllPets(true)}
                style={({ pressed }) => [
                  styles.moreRow,
                  styles.taskDivider,
                  pressed && { opacity: 0.6 },
                ]}
              >
                <Text style={styles.moreLabel}>{t.tasks.moreCount(hiddenCount)}</Text>
              </Pressable>
            ) : null}
            {lostView === 'list' && showAllPets && restDogs.length > 0 ? (
              <Pressable
                onPress={() => setShowAllPets(false)}
                style={({ pressed }) => [
                  styles.moreRow,
                  styles.taskDivider,
                  pressed && { opacity: 0.6 },
                ]}
              >
                <Text style={styles.moreLabel}>{t.tasks.showFewer}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* Daily tasks — single card with title + slim "X / Y done"
            subtitle, then the task rows. The headline summary card
            (giant X/Y number + overall bar) used to be a separate
            card above this one — collapsed in since the per-row
            bars already visualise progress and the duplication
            hurt vertical hierarchy. */}
        <View nativeID="snap-card-daily" style={styles.card}>
          <View style={styles.dailyHeader}>
            <Text style={[styles.cardTitle, styles.cardTitleInline]}>
              {t.tasks.dailyTasks}
            </Text>
            <Text style={styles.dailyCount}>
              {doneCount} / {TASKS.length}
            </Text>
          </View>
          {TASKS.map((row, i) => {
            const value = Math.min(dailyTasks[row.key], row.target);
            const progress = Math.min(value / row.target, 1);
            const complete = value >= row.target;
            return (
              <View key={row.key} style={[styles.task, i > 0 && styles.taskDivider]}>
                <View style={styles.row}>
                  {row.iconName ? (
                    <View style={styles.iconWrap}>
                      <Icon name={row.iconName} size={34} />
                    </View>
                  ) : (
                    <Text style={styles.icon}>{row.icon}</Text>
                  )}
                  <Text style={[styles.label, complete && styles.labelDone]}>
                    {t.tasks.items[row.labelKey]}
                  </Text>
                  <Text style={[styles.count, complete && styles.countDone]}>
                    {value}/{row.target}
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
          <View nativeID="snap-card-history" style={styles.card}>
            <Pressable
              onPress={() => setHistoryOpen((v) => !v)}
              style={({ pressed }) => [
                styles.cardHeaderRow,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={styles.cardTitle}>{t.tasks.pastSearches}</Text>
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
                        {q.dogName ?? t.tasks.unknownPet}
                      </Text>
                      <Text style={styles.historyMeta}>
                        {q.status === 'completed' ? t.tasks.finished : t.tasks.abandoned} ·{' '}
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
  // Vertical snap-scroll on the tab — each card is a snap target,
  // so a flick from the lost-pets card lands cleanly on the daily-
  // tasks card (and back). `mandatory` is fine because every card
  // currently fits in a phone viewport; if a card ever overflows,
  // switch to `proximity` so the user can free-scroll within it.
  // RN-Web passes scroll-snap-* straight through to CSS even
  // though RN typings don't know about them.
  scroller: {
    flex: 1,
    scrollSnapType: 'y mandatory',
  } as unknown as object,
  // Aggressive paddingTop — Safari iOS sets safe-area-inset-top to
  // 0 when not in standalone PWA mode, so all the breathing room
  // has to come from this single value. 140 lands the lost-pets
  // card visibly in the middle-upper of the viewport with real
  // air above it.
  content: { paddingHorizontal: 16, paddingTop: 140, paddingBottom: 120, gap: 12 },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    // Split padding — top is tighter so the card title sits high
    // and is visible when the card peeks at the top or bottom of
    // the viewport after a snap. Horizontal + bottom stay roomy.
    paddingTop: 14,
    paddingBottom: 20,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
    // Snap each card's top edge to the top of the scroll viewport.
    scrollSnapAlign: 'start',
    scrollSnapStop: 'always',
  } as unknown as object,
  cardTitle: {
    fontFamily: SYSTEM_FONT,
    fontSize: 14,
    color: '#777',
    marginBottom: 10,
    textTransform: 'lowercase',
    letterSpacing: 0.3,
  },
  // Title + view-mode toggle on one line. cardTitle's marginBottom
  // moves to the row wrapper since the title's bottom margin would
  // otherwise push the toggle out of alignment.
  lostHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  viewToggle: {
    flexDirection: 'row',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: 999,
    padding: 3,
  },
  viewTogglePill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
  },
  viewTogglePillActive: {
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 1,
  },
  viewToggleText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#777',
    textTransform: 'lowercase',
  },
  viewToggleTextActive: {
    color: '#1a1a1a',
  },
  // Daily-tasks card header: title on the left, "X / Y" tally on
  // the right. Replaces the giant standalone summary card that used
  // to sit above the task list.
  dailyHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  // Override cardTitle's own marginBottom when it sits inside a
  // header row — the row's marginBottom drives the spacing below.
  cardTitleInline: {
    marginBottom: 0,
  },
  dailyCount: {
    fontFamily: SYSTEM_FONT,
    fontSize: 14,
    color: '#777',
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  // Roomier task row: padding 12 → 16, gap 10 → 14, icon column
  // 22 → 44 to actually fit the 34px pixel icon (was being clipped
  // by the narrow wrap). Label + count bumped a notch to match the
  // spacious-list tone everything else just moved to.
  task: {
    paddingVertical: 16,
  },
  taskDivider: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 14,
  },
  icon: { fontSize: 28 },
  iconWrap: { width: 44, alignItems: 'center' },
  label: { flex: 1, fontSize: 16, color: colors.black },
  labelDone: { color: '#aaa', textDecorationLine: 'line-through' },
  count: { fontSize: 14, color: '#777', fontWeight: '700' },
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
    gap: 14,
    paddingVertical: 14,
  },
  // Avatar 2× the previous 40px — the photos were postage-stamp
  // sized against the title typography. 80px reads as actual pet
  // photo, not a tiny icon.
  petAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#f0f0f0',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  petAvatarEmoji: { fontSize: 38, position: 'absolute' },
  petAvatarImg: { width: '100%', height: '100%' },
  petBody: { flex: 1, minWidth: 0 },
  petTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  petName: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.black,
    flexShrink: 1,
  },
  // Urgency tags: white bg + coloured text + shadow — matches the
  // LostDog modal badge + the white-with-shadow chip family the
  // rest of the app now uses (was soft-tinted bg with the colour
  // also as text, read muddy).
  urgencyTag: {
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    overflow: 'hidden',
    textTransform: 'lowercase',
    letterSpacing: 0.3,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 1,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.04)',
  },
  urgencyUrgent: { color: '#e84040' },
  urgencyMedium: { color: '#d9a030' },
  petMeta: { fontSize: 14, color: '#777', marginTop: 3 },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
  },
  historyBody: { flex: 1, minWidth: 0 },
  historyName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.black,
  },
  historyMeta: {
    fontSize: 13,
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
});
