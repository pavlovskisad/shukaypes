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
import { api, type NearbyLostDog, type TerritoryRanking } from '../../services/api';
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
import { OWN_COLOR_CSS, ownerColorCss } from '../../components/map/territoryColor';
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

// THE BOARD IS COLOURED LIKE THE MAP.
//
// Bars used to be gold, silver, bronze and then a row of identical greys,
// which told you the order and nothing else. Every one of these dogs owns
// a colour you can see out of the window — the same hue their ground is
// painted in — so the bar carries it. Now the board answers "who is that
// purple in the north" without you having to tap anything, and reading
// the map teaches you the board and back again.
//
// Rank still reads, it just isn't the bar's job any more: the top three
// get a travelling shine, and everyone below fourth has their text
// dimmed. Colour for identity, movement and contrast for position.
const PODIUM = 3;

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
  // The territory standing. Null until the first fetch settles; a
  // failed fetch leaves it null and the card simply doesn't render,
  // same as the quest history above.
  const [board, setBoard] = useState<{
    board: TerritoryRanking[];
    you: { areaM2: number; rank: number | null };
  } | null>(null);
  // Open the "see all" fullscreen list when truthy.
  const [seeAllDogsOpen, setSeeAllDogsOpen] = useState(false);

  // Sort by straight-line distance to the dog's last-seen position
  // so the closest pet is the first card in the carousel (and the
  // top of the "see all" modal feed) — matches the spots tab's
  // sort and is the most intuitive reading of "by proximity". No
  // GPS yet → keep server order.
  // Bucketed to a ~110m grid, the same way the map's search carousel does
  // it. On raw lat/lng this re-sorted on every GPS tick, so two pets at
  // similar distance traded places constantly and the deck churned for no
  // visible reason. The distance ON the cards is unaffected — those read
  // the live position straight from the store.
  const userLatBucket = userPos ? Math.round(userPos.lat * 1000) / 1000 : null;
  const userLngBucket = userPos ? Math.round(userPos.lng * 1000) / 1000 : null;
  const sortedDogs = useMemo(
    () => {
      if (!userPos) return lostDogs;
      return [...lostDogs].sort(
        (a, b) =>
          distanceMeters(userPos, a.lastSeen.position) -
          distanceMeters(userPos, b.lastSeen.position),
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bucketed userPos on purpose; see above
    [lostDogs, userLatBucket, userLngBucket],
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

  // The territory standing, refetched on focus. Its own trip and its
  // own failure: the board lives behind a different query from the
  // quest history, and one being down should not blank the other.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      api
        .territoryLeaderboard()
        .then((res) => {
          if (!cancelled) setBoard(res);
        })
        .catch(() => {
          /* fail silent — the card just doesn't render */
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  // The shine that travels along a podium bar. One stylesheet for the
  // whole tab, injected once — same pattern the card deck's shimmer uses.
  // Only the top three get it; below that the bar is a plain colour.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.getElementById('board-sweep-style')) return;
    const el = document.createElement('style');
    el.id = 'board-sweep-style';
    el.textContent = `
      @keyframes board-sweep {
        0%   { transform: translateX(-60%) skewX(-18deg); opacity: 0; }
        12%  { opacity: 0.85; }
        55%  { opacity: 0.85; }
        70%  { transform: translateX(340%) skewX(-18deg); opacity: 0; }
        100% { transform: translateX(340%) skewX(-18deg); opacity: 0; }
      }
    `;
    document.head.appendChild(el);
  }, []);

  const doneCount = TASKS.filter((row) => dailyTasks[row.key] >= row.target).length;

  // Which snap-cards are on screen at all. The observer below re-arms on
  // this and nothing else — hoisted into named flags because the linter
  // cannot check an expression written inline in a dependency array, and
  // getting this set wrong means the pop animation silently stops.
  const noLostDogs = lostDogsLoaded && sortedDogs.length === 0;
  const hasHistory = history.length > 0;
  const hasBoard = board != null;

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
  }, [noLostDogs, hasHistory, hasBoard]);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} style={styles.scroller}>
        {/* Who holds the city. Territory is the one thing on the map
            that is directly competitive, and until now the only place
            you could see it was three summary rows on the profile tab
            — your area, your rank, and the single name above you. A
            standing needs the list: seeing four names between you and
            the top is what makes the number mean something.

            Bars are relative to the leader rather than absolute, so
            the shape of the race reads at a glance on a card this
            narrow — whether the top is running away with it or the
            first five are neck and neck.

            Bots are not labelled. They hold real ground under exactly
            the rules a player does, and a tag saying which neighbours
            are simulated is the sort of honesty nobody asked for — it
            tells you the city is scenery. They are on the board because
            they earned the ground; who is behind a name is not the
            board's business. */}
        {board ? (
          <View nativeID="snap-card-board" style={styles.card}>
            <Text style={styles.cardTitle}>{t.tasks.territoryBoard}</Text>
            {/* YOU, first and always.
                The number used to sit small and grey in the header, which
                put the one figure a player came to read in the least
                readable place on the card — and left you hunting the list
                for your own row, or finding you were not in it at all.
                Here it is a row in the same three columns as the board
                below, so your rank, your name and your ground line up with
                everyone else's and can be compared without moving your
                eyes. Unranked reads as a dash, which is honest: you are
                not on the board, and here is what you hold anyway. */}
            <View style={[styles.boardRow, styles.boardYouRow]}>
              <View style={styles.row}>
                <Text style={[styles.boardRank, styles.boardYouText]}>
                  {board.you.rank != null ? t.profile.rankValue(board.you.rank) : t.profile.unranked}
                </Text>
                <Text style={[styles.boardName, styles.boardYouText]} numberOfLines={1}>
                  {t.tasks.boardYou}
                </Text>
                <Text style={[styles.boardArea, styles.boardYouText]}>
                  {t.profile.areaValue(board.you.areaM2)}
                </Text>
              </View>
            </View>
            {board.board.length === 0 ? (
              <Text style={styles.boardEmpty}>{t.tasks.boardEmpty}</Text>
            ) : (
              <>
                {board.board.map((row, i) => {
                  // The viewer is whoever sits at their own rank — the
                  // board carries no id for you, and it doesn't need to.
                  const isYou = board.you.rank === i + 1;
                  const top = board.board[0]!.areaM2 || 1;
                  const podium = i < PODIUM;
                  // The rest of the field, dimmed — in the TEXT only. A
                  // podium is only a podium if there is a crowd below it,
                  // but the bars all keep their full colour because that
                  // colour is what ties a row to a patch of the map.
                  const faded = !podium && !isYou;
                  // Yours in the brand blue the map paints your ground
                  // with; everyone else in the hue theirs is painted.
                  const barColor = isYou ? OWN_COLOR_CSS : ownerColorCss(row.userId);
                  return (
                    <View
                      key={row.userId}
                      style={[styles.boardRow, i > 0 && styles.taskDivider]}
                    >
                      <View style={styles.row}>
                        <Text
                          style={[
                            styles.boardRank,
                            faded && styles.boardFadedRank,
                            isYou && styles.boardYouText,
                            podium ? styles.boardPodiumRank : null,
                          ]}
                        >
                          {i + 1}
                        </Text>
                        <Text
                          style={[
                            styles.boardName,
                            faded && styles.boardFadedName,
                            isYou && styles.boardYouText,
                          ]}
                          numberOfLines={1}
                        >
                          {isYou ? t.tasks.boardYou : row.name}
                        </Text>
                        <Text
                          style={[
                            styles.boardArea,
                            faded && styles.boardFadedArea,
                            isYou && styles.boardYouText,
                          ]}
                        >
                          {t.profile.areaValue(row.areaM2)}
                        </Text>
                      </View>
                      <View style={styles.barTrack}>
                        <View
                          style={[
                            styles.barFill,
                            { width: `${Math.max(2, Math.round((row.areaM2 / top) * 100))}%` as unknown as number },
                            { backgroundColor: barColor },
                            podium ? ({ overflow: 'hidden' } as unknown as object) : null,
                          ]}
                        >
                          {/* The travelling glint. Staggered per place so
                              the three bars catch the light one after the
                              other instead of flashing in unison. */}
                          {podium ? (
                            <View
                              style={
                                {
                                  position: 'absolute',
                                  top: 0,
                                  bottom: 0,
                                  width: '34%',
                                  backgroundImage:
                                    'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.9) 50%, rgba(255,255,255,0) 100%)',
                                  animation: `board-sweep 4.2s ${i * 0.45}s ease-in-out infinite`,
                                } as unknown as object
                              }
                            />
                          ) : null}
                        </View>
                      </View>
                    </View>
                  );
                })}
              </>
            )}
          </View>
        ) : null}

        {/* Lost pets nearby — the most actionable thing on the screen,
            under the standing. Always rendered (even while the dogs
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
  // The standing. Rows are the same shape as a daily task — number,
  // label, value, bar — so the two cards read as one language.
  boardRow: {
    paddingVertical: S.m,
  },
  // Your own line, set apart from the ranking under it: tinted, inset,
  // and rounded so it reads as a summary of you rather than as position
  // zero on the board.
  boardYouRow: {
    backgroundColor: 'rgba(0,60,255,0.06)',
    borderRadius: R.sm,
    paddingHorizontal: S.m,
    marginBottom: S.s,
  },
  boardRank: {
    width: 22,
    fontSize: TYPE.small,
    fontWeight: '700',
    color: '#999',
  },
  boardName: {
    flex: 1,
    fontSize: TYPE.body,
    color: colors.black,
  },
  boardArea: {
    fontSize: TYPE.small,
    color: '#777',
    fontWeight: '700',
  },
  boardYouText: {
    color: 'rgba(0,60,255,0.85)',
    fontWeight: '700',
  },
  // Fourth place down. Still legible at arm's length — you can find your
  // rival's name — but no longer competing with the podium for the eye.
  // Top three: the digit gets weight, not colour — the bar beside it is
  // already carrying the owner's hue and two colours competing in one row
  // reads as decoration.
  boardPodiumRank: { color: colors.black, fontWeight: '700' },
  boardFadedRank: { color: '#c4c4c4' },
  boardFadedName: { color: '#9a9a9a' },
  boardFadedArea: { color: '#b0b0b0' },
  boardEmpty: {
    fontSize: TYPE.small,
    color: '#777',
    paddingVertical: S.m,
  },
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
