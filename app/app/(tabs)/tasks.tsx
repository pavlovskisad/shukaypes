import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../../constants/colors';
import { useGameStore, DAILY_TARGETS } from '../../stores/gameStore';
import { SYSTEM_FONT } from '../../constants/fonts';
import { R } from '../../constants/radius';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
import { api, type NearbyLostDog } from '../../services/api';
import { distanceMeters } from '../../utils/geo';
import {
  LostDogCardStack,
  LostDogCardStackSkeleton,
} from '../../components/ui/LostDogCardStack';
import { LostDogsModal } from '../../components/ui/LostDogsModal';
import { SwipeHintCallout } from '../../components/ui/SwipeHintCallout';
import { Icon, type IconName } from '../../components/ui/Icon';
import type { LatLng } from '@shukajpes/shared';
import { useStrings } from '../../i18n/useStrings';
import { useHint } from '../../hooks/useHint';

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
  const lostDogsLoaded = useGameStore((s) => s.lostDogsLoaded);
  const userPos = useGameStore((s) => s.userPosition);
  const setSelectedDog = useGameStore((s) => s.setSelectedDog);
  const currentScreen = useGameStore((s) => s.currentScreen);
  const [history, setHistory] = useState<QuestHistoryRow[]>([]);
  // Open the "see all" fullscreen list when truthy.
  const [seeAllDogsOpen, setSeeAllDogsOpen] = useState(false);

  // Sort by straight-line distance to the dog's last-seen position
  // so the closest pet is the first card in the carousel (and the
  // top of the "see all" modal feed) — matches the spots tab's
  // sort and is the most intuitive reading of "by proximity". No
  // GPS yet → keep server order.
  const sortedDogs = useMemo(
    () => {
      if (!userPos) return lostDogs;
      return [...lostDogs].sort(
        (a, b) =>
          distanceMeters(userPos, a.lastSeen.position) -
          distanceMeters(userPos, b.lastSeen.position),
      );
    },
    [lostDogs, userPos?.lat, userPos?.lng],
  );

  // Soft fan-out, step 3: nudge that the lost-pets deck is swipeable.
  // Only arms while the tasks tab is the active screen AND there's
  // more than one card to swipe to. Gentle timing + dev-mode
  // persist:false to match the map hints.
  const swipeHint = useHint('cards:swipe', {
    ready: currentScreen === 'tasks' && sortedDogs.length > 1,
    showDelayMs: 900,
    autoDismissMs: 5000,
    persist: false,
  });

  // Tapping a dog (card or "see all" row) jumps to the map with the
  // pet selected — the map snaps the camera onto it and opens the
  // LostDogModal there. Same pattern the spots tab uses (setSelected +
  // route to '/'); no local modal on this tab anymore.
  const onPickDog = useCallback(
    (dog: NearbyLostDog) => {
      setSelectedDog(dog.id);
      router.push('/');
    },
    [setSelectedDog, router],
  );

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

  const doneCount = TASKS.filter((row) => dailyTasks[row.key] >= row.target).length;

  // Pop the dominant snap-card when it changes. Uses
  // IntersectionObserver against the cards' stable nativeIDs to
  // detect which card is currently dominant, then drives a pop
  // via the Web Animations API. Previous attempts used a CSS
  // class toggle with a forced reflow — that worked the first
  // few times then silently stopped in Safari iOS (class restart
  // is flaky there). element.animate() creates a fresh Animation
  // instance every call so it restarts reliably.
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

    const playPop = (el: HTMLElement) => {
      // Soft pleasant pop — slightly more lift + scale than the
      // previous pass so the motion actually registers, but kept
      // on a long arc with asymmetric easing (smooth ease-out on
      // the rise, slower ease-out on the settle) so it still
      // reads as a "breath" rather than a snap.
      el.animate(
        [
          { transform: 'translateY(0) scale(1)',         offset: 0,    easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' },
          { transform: 'translateY(-10px) scale(1.04)',  offset: 0.4,  easing: 'cubic-bezier(0.33, 1, 0.68, 1)'    },
          { transform: 'translateY(0) scale(1)',         offset: 1 },
        ],
        {
          duration: 820,
          fill: 'none',
        },
      );
    };

    const setup = () => {
      const cards = Array.from(document.querySelectorAll<HTMLElement>('[id^="snap-card-"]'));
      if (cards.length === 0) return false;

      // Per-card intersection ratio cache so we can compare across
      // every observer fire without re-measuring each card.
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
              playPop(dominant as HTMLElement);
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
    // a couple of times in case the lost-pets data arrives later
    // and inserts a new card into the snap deck.
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
    // Re-run only when the SET of rendered snap-cards changes —
    // i.e. when a card frame disappears (lost-pets hidden after
    // a load-with-zero, history collapsed) or reappears. The
    // lost-pets card frame is now always rendered upfront via
    // the skeleton placeholder, so the dogs fetch settling no
    // longer flips this — the same DOM node carries the data
    // swap without needing a fresh observer.
  }, [lostDogsLoaded && sortedDogs.length === 0, history.length > 0]);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} style={styles.scroller}>
        {/* Lost pets nearby — promoted to the top of the tab so the
            most actionable thing on the screen is the first thing
            the user sees. Always rendered (even while the dogs
            fetch is in flight) with a skeleton placeholder inside
            so the snap order is stable from first paint — without
            this the daily-quests card briefly takes the top slot
            and then shoves itself down once dogs arrive. The
            card is only hidden when the fetch settled with zero
            dogs in the user's area. */}
        {lostDogsLoaded && sortedDogs.length === 0 ? null : (
          <View nativeID="snap-card-lost" style={styles.card}>
            <Text style={styles.cardTitle}>{t.tasks.lostPetsNearby}</Text>
            {sortedDogs.length === 0 ? (
              <LostDogCardStackSkeleton />
            ) : (
              <View style={styles.deckWrap}>
                <LostDogCardStack
                  dogs={sortedDogs}
                  onTap={onPickDog}
                  onCounterTap={() => setSeeAllDogsOpen(true)}
                  onSwipe={swipeHint.dismiss}
                />
                {/* Swipe nudge — one-shot, coordinates with the spots
                    deck via the shared 'cards:swipe' id (shows on
                    whichever carousel the user hits first, not both). */}
                {swipeHint.visible ? (
                  <SwipeHintCallout text={t.hints.swipeCards} />
                ) : null}
              </View>
            )}
          </View>
        )}

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
          {/* Slim summary bar under the header — the per-row bars still
              drive the at-a-glance progress for each task, but a
              single bar at the top makes "how done am I overall?"
              readable without summing five row widths. */}
          <View style={styles.summaryBarTrack}>
            <View
              style={[
                styles.summaryBarFill,
                {
                  width: `${Math.round((doneCount / TASKS.length) * 100)}%` as unknown as number,
                },
              ]}
            />
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
            show so a brand-new account doesn't see an empty rail.
            Always rendered expanded: a collapsing "+ / −" header
            existed previously but was too easy to miss (people
            scrolled hunting for the rows that were a tap away).  */}
        {history.length > 0 ? (
          <View nativeID="snap-card-history" style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardTitle}>{t.tasks.pastSearches}</Text>
              <Text style={styles.cardHeaderCount}>{history.length}</Text>
            </View>
            {history.map((q, i) => (
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
            ))}
          </View>
        ) : null}
      </ScrollView>

      <LostDogsModal
        dogs={seeAllDogsOpen ? sortedDogs : null}
        onClose={() => setSeeAllDogsOpen(false)}
        onPick={(d) => {
          setSeeAllDogsOpen(false);
          onPickDog(d);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#ffffff' },
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
    // Match contentContainer paddingTop. Bumped 60 → 32 so the
    // snapped card sits higher in the viewport, leaving more
    // room at the bottom for the next snap-card's title to peek
    // above the floating dashboard instead of getting clipped
    // by it.
    scrollPaddingTop: 32,
  } as unknown as object,
  // Tighter top padding so the next card's title peeks above
  // the tab bar. gap stays 60 so the between-card rhythm
  // doesn't collapse. paddingBottom is calc(100vh - 200px) so
  // even short cards (like "минулі пошуки" with 2 history rows)
  // have enough room beneath them to snap-scroll all the way to
  // the top — without this, a small last card was held mid-
  // screen because the page couldn't scroll any further.
  content: {
    paddingHorizontal: S.l,
    paddingTop: S.xxxl,
    paddingBottom: 'calc(100vh - 200px)' as unknown as number,
    gap: 60,
  },
  // Snap block — no white card frame anymore. Title + content
  // sit straight on the page bg. Just carries the scroll-snap
  // alignment + horizontal padding so the inner content has
  // breathing room from the screen edge.
  card: {
    paddingHorizontal: S.xs,
    scrollSnapAlign: 'start',
    scrollSnapStop: 'always',
  } as unknown as object,
  // Relative wrapper so the swipe-hint callout can overlay the deck.
  deckWrap: {
    position: 'relative',
  },
  // Card titles — bumped 14 → 17, weight to 800, colour to
  // colors.black so they actually catch the eye at the top of
  // each card instead of disappearing into the grey rhythm of
  // the rest of the page.
  cardTitle: {
    fontFamily: SYSTEM_FONT,
    fontSize: TYPE.title,
    fontWeight: '800',
    color: colors.black,
    marginBottom: S.m,
    textTransform: 'lowercase',
    letterSpacing: 0.2,
  },
  // Daily-tasks card header: title on the left, "X / Y" tally on
  // the right. Replaces the giant standalone summary card that used
  // to sit above the task list.
  dailyHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: S.m,
  },
  // Override cardTitle's own marginBottom when it sits inside a
  // header row — the row's marginBottom drives the spacing below.
  cardTitleInline: {
    marginBottom: 0,
  },
  dailyCount: {
    fontFamily: SYSTEM_FONT,
    fontSize: TYPE.small,
    color: '#777',
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  // Slim summary bar under the daily-quests header — visually
  // anchors the X / Y tally to a quick "how done?" glance.
  summaryBarTrack: {
    height: 6,
    borderRadius: R.sm,
    backgroundColor: '#f0f0f0',
    overflow: 'hidden',
    marginBottom: S.s,
  },
  summaryBarFill: {
    height: '100%',
    borderRadius: R.sm,
    backgroundColor: 'rgb(0,60,255)',
  },
  // Roomier task row: padding 12 → 16, gap 10 → 14, icon column
  // 22 → 44 to actually fit the 34px pixel icon (was being clipped
  // by the narrow wrap). Label + count bumped a notch to match the
  // spacious-list tone everything else just moved to.
  task: {
    paddingVertical: S.l,
  },
  taskDivider: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: S.m,
    gap: S.l,
  },
  icon: { fontSize: TYPE.display },
  iconWrap: { width: 44, alignItems: 'center' },
  label: { flex: 1, fontSize: TYPE.body, color: colors.black },
  labelDone: { color: '#aaa', textDecorationLine: 'line-through' },
  count: { fontSize: TYPE.small, color: '#777', fontWeight: '700' },
  countDone: { color: '#666' },
  barTrack: {
    height: 6,
    backgroundColor: '#f0f0f0',
    borderRadius: R.sm,
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: R.sm },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardHeaderCount: {
    fontSize: TYPE.small,
    fontWeight: '700',
    color: '#999',
    marginBottom: S.m, // align with cardTitle's marginBottom
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.l,
    paddingVertical: S.l,
  },
  historyBody: { flex: 1, minWidth: 0 },
  historyName: {
    fontSize: TYPE.body,
    fontWeight: '700',
    color: colors.black,
  },
  historyMeta: {
    fontSize: TYPE.small,
    color: '#777',
    marginTop: 2,
  },
  historyTickDone: {
    fontSize: TYPE.body,
    color: 'rgba(0,60,255,0.85)',
    fontWeight: '700',
  },
  historyTickAbandon: {
    fontSize: TYPE.title,
    color: '#bbb',
    fontWeight: '700',
  },
});
