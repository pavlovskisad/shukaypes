import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../../constants/colors';
import { useGameStore, DAILY_TARGETS } from '../../stores/gameStore';
import { SYSTEM_FONT } from '../../constants/fonts';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
import { INK } from '../../constants/surface';
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
import { BoardRow } from '../../components/ui/BoardRow';
import { LeaderboardModal } from '../../components/ui/LeaderboardModal';
import { useHint } from '../../hooks/useHint';
import { HandDrawnBar } from '../../components/ui/HandDrawn';

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
// Every row gets the same treatment — full-contrast text and a
// travelling shine. An earlier cut dimmed everyone below fourth and
// reserved the shine for the podium, on the theory that a podium needs a
// crowd beneath it to be a podium. It doesn't, here: the standing is a
// list of dogs holding parts of a city, and dimming seven of them said
// "these ones don't matter" about players who very much do. The number
// and the bar length carry position perfectly well on their own.

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

// How many neighbours the STANDING CARD shows. Not a display
// preference — it is what keeps the card a screenful, and a card that
// fits its screen is why this tab snaps cleanly in both directions.
//
// The card used to list all ten at portrait size, which ran to about
// twice a phone viewport. That needed an end-aligned snap anchor at its
// tail to be reachable at all, and that anchor then caught every scroll
// coming back UP from the lost-pets card — you landed on the board's
// last row instead of its title. So the number is derived, not chosen:
//
//   card height ≈ 230 + 104·N     (32 padding + 34 title + 124 your
//                                  row + 104 per row + 40 for the link;
//                                  104 measured off a real render)
//   snapport    ≈ 618             (a notch-era iPhone's Safari content
//                                  area, less scrollPaddingTop)
//
// N=4 overflows by ~30px, which is exactly the condition that broke the
// scroll before; N=3 fits with room to spare on the small end too. Your
// own row sits above them, so it reads as you against the podium — and
// the rest of the city is one tap away in the fullscreen board.
const BOARD_CARD_ROWS = 3;

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

// One bar on the standing: the owner's colour, a length, and the shine.
//
export default function TasksScreen() {
  const t = useStrings();
  const router = useRouter();
  const dailyTasks = useGameStore((s) => s.dailyTasks);
  const refresh = useGameStore((s) => s.refreshDailyTasks);
  const lostDogs = useGameStore((s) => s.lostDogs);
  const lostDogsLoaded = useGameStore((s) => s.lostDogsLoaded);
  const userPos = useGameStore((s) => s.userPosition);
  const setSearchIntent = useGameStore((s) => s.setSearchIntent);
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
  // The full standing — nullable data doubles as the modal's open flag,
  // same as every sheet here. Opens instantly with the ten rows already
  // on screen, then swaps in the long board when the fetch lands; a
  // failed fetch leaves the ten showing, which is the honest fallback.
  const [boardAll, setBoardAll] = useState<TerritoryRanking[] | null>(null);
  const openFullBoard = useCallback(() => {
    setBoardAll((cur) => cur ?? board?.board ?? null);
    api
      .territoryLeaderboard(100)
      .then((res) => setBoardAll((cur) => (cur ? res.board : cur)))
      .catch(() => {
        /* the short board stays up */
      });
  }, [board]);

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

  // Tapping a dog (card or "see all" row) jumps to the map and puts the
  // dog's own «ходімо?» question up about that pet, in supersniff.
  //
  // It used to select the pet instead, which opened the preview sheet on
  // the map: the same photo, the same name and the same distance as the
  // card that had just been tapped, plus one button that started the
  // search. Nothing on it was new, and the one thing it offered was the
  // thing the tap already meant. The question is the destination now,
  // and the pet's card is under it — with the ad one tap away on the
  // photo, which is the only thing the sheet carried that the card
  // does not.
  const onPickDog = useCallback(
    (dog: NearbyLostDog) => {
      setSearchIntent(dog.id);
      router.push('/');
    },
    [setSearchIntent, router],
  );

  // Tap a row on the standing → the map, landed on that owner's ground.
  // The row already carries the largest piece's ring (the silhouette is
  // drawn from it) and the owner's freshest mark, so the jump needs no
  // extra fetch; rows without geometry simply don't navigate.
  const setFocusedTerritory = useGameStore((s) => s.setFocusedTerritory);
  const setAppMode = useGameStore((s) => s.setAppMode);
  const onPickOwner = useCallback(
    (
      ownerId: string,
      ring?: { lat: number; lng: number }[],
      mark?: { lat: number; lng: number },
      pos?: { lat: number; lng: number },
    ) => {
      if (!ring || ring.length < 3) return;
      // INTO THE TERRITORY VIEW FIRST, then the flight.
      //
      // The standing is on the dashboard, which is up in every mode, so
      // this row can be tapped from a walk — and territory is only DRAWN
      // in the territory view. Flying somebody to a piece of ground they
      // then cannot see is the same as not going. Switching first also
      // hands them the dog's line explaining the mechanic, which is the
      // right thing to hear on the way to a stranger's district.
      //
      // Guarded because setAppMode is the clear-slate reducer: re-entering
      // the mode you are already in would wipe the screen for nothing.
      if (useGameStore.getState().appMode !== 'play') setAppMode('play');
      setFocusedTerritory({ ownerId, ring, ...(mark ? { mark } : {}), ...(pos ? { pos } : {}) });
      router.push('/');
    },
    [setFocusedTerritory, setAppMode, router],
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

  // Your own silhouette, when the board already carries it: if you sit in
  // the ranked list, your entry there has your largest piece. Outside the
  // list the server sends no geometry for you, and the row falls back to
  // a plain dot in your blue — honest, and cheaper than a second query
  // for a shape the map screen can show you anyway.
  const yourPiece =
    board?.you.rank != null ? board.board[board.you.rank - 1]?.mainPiece : undefined;

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
                It is now literally the same row as the ones below it —
                same columns, same bar drawn against the same leader's
                area, same shine — separated by a gap and a rule instead
                of by being a different kind of object. Unranked reads as
                a dash, which is honest: you are not on the board, and
                here is what you hold anyway. */}
            <View style={styles.boardYouRow}>
              <Pressable
                onPress={() => onPickOwner('you', yourPiece)}
                disabled={!yourPiece || yourPiece.length < 3}
                style={({ pressed }) => (pressed ? styles.boardRowPressed : undefined)}
              >
                <BoardRow
                  rank={String(board.you.rank ?? t.profile.unranked)}
                  name={t.tasks.boardYou}
                  areaLabel={t.profile.areaValue(board.you.areaM2)}
                  piece={yourPiece}
                  color={OWN_COLOR_CSS}
                  you
                />
              </Pressable>
            </View>
            {board.board.length === 0 ? (
              <Text style={styles.boardEmpty}>{t.tasks.boardEmpty}</Text>
            ) : (
              <>
                {board.board.slice(0, BOARD_CARD_ROWS).map((row, i) => {
                  // The viewer is whoever sits at their own rank — the
                  // board carries no id for you, and it doesn't need to.
                  const isYou = board.you.rank === i + 1;
                  // Yours in the brand blue the map paints your ground
                  // with; everyone else in the hue theirs is painted —
                  // the silhouette is the same shape their claim has on
                  // the map, so colour and outline identify together.
                  return (
                    <Pressable
                      key={row.userId}
                      onPress={() => onPickOwner(row.userId, row.mainPiece, row.lastMark, row.pos)}
                      disabled={!row.mainPiece || row.mainPiece.length < 3}
                      style={({ pressed }) => (pressed ? styles.boardRowPressed : undefined)}
                    >
                      <BoardRow
                        rank={String(i + 1)}
                        name={isYou ? t.tasks.boardYou : row.name}
                        areaLabel={t.profile.areaValue(row.areaM2)}
                        piece={row.mainPiece}
                        color={isYou ? OWN_COLOR_CSS : ownerColorCss(row.userId)}
                        you={isYou}
                      />
                    </Pressable>
                  );
                })}
                {/* The rest of the city — same underlined-link
                    affordance as the carousel counter. It carries real
                    weight now that the card shows a handful: the board
                    is the district's shape, the sheet is its full
                    census. */}
                <Pressable onPress={openFullBoard} hitSlop={8}>
                  {({ pressed }) => (
                    <Text style={[styles.boardSeeAll, pressed && styles.boardSeeAllPressed]}>
                      {t.tasks.boardSeeAll}
                    </Text>
                  )}
                </Pressable>
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
            <HandDrawnBar progress={doneCount / TASKS.length} seed="daily-summary" />
          </View>
          {TASKS.map((row, i) => {
            const value = Math.min(dailyTasks[row.key], row.target);
            const progress = Math.min(value / row.target, 1);
            const complete = value >= row.target;
            return (
              // No rule between rows — same as the standing. Each row
              // ends in its own progress bar, which separates it from the
              // next one without a second line above it saying so.
              <View key={row.key} style={styles.task}>
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
                {/* Ink, done or not. The bar used to be blue while you
                    were working on it and a faded black once finished,
                    which put the LOUDER colour on the row you no longer
                    have to do anything about. A finished row already
                    says so twice — a full-width bar and a ✓ — and it
                    does not need a second colour to say it a third
                    time. Drawn, like everything else on this card. */}
                <View style={styles.barTrack}>
                  <HandDrawnBar progress={progress} seed={row.key} />
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

      <LeaderboardModal
        board={boardAll}
        youRank={board?.you.rank ?? null}
        onClose={() => setBoardAll(null)}
        onPick={(row) => {
          setBoardAll(null);
          onPickOwner(row.userId, row.mainPiece, row.lastMark, row.pos);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#ffffff' },
  // Vertical snap-scroll on the tab — each card is a snap target,
  // so a flick from the lost-pets card lands cleanly on the daily-
  // tasks card (and back).
  //
  // `mandatory`, with ONE snap position per card — its start — and
  // that took a round trip to arrive at. When the standing card ran to
  // twice a viewport, its tail was unreachable (mandatory yanked you
  // to the next card the moment the card stopped covering the
  // screen); `proximity` fixed the tail and broke the feel, every card
  // edge turning sticky so a flick stuttered instead of gliding; an
  // end-aligned anchor at the card's tail fixed both, and then caught
  // every scroll coming back UP from lost pets, landing you on the
  // board's last row instead of its title.
  //
  // The fix was upstream of all three: cards that FIT (see
  // BOARD_CARD_ROWS). With nothing overflowing there is no tail to
  // reach, no second anchor to catch an upward flick, and every
  // landing — up or down — is a card's own top.
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
  // Tighter top padding so the next card's title peeks above the tab
  // bar. The gap is the SEPARATION between sections and it is
  // deliberately large: at 60 the standing, the pets and the quests
  // ran into each other as one long page, and this tab is meant to
  // read as a few clean screens you flick between. paddingBottom is
  // calc(100vh - 200px) so even short cards (like "минулі пошуки"
  // with 2 history rows) have enough room beneath them to snap-scroll
  // all the way to the top — without this, a small last card was held
  // mid-screen because the page couldn't scroll any further.
  content: {
    paddingHorizontal: S.l,
    paddingTop: S.xxxl,
    paddingBottom: 'calc(100vh - 200px)' as unknown as number,
    gap: 112,
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
    marginBottom: S.s,
  },
  // Roomier task row: padding 12 → 16, gap 10 → 14, icon column
  // 22 → 44 to actually fit the 34px pixel icon (was being clipped
  // by the narrow wrap). Label + count bumped a notch to match the
  // spacious-list tone everything else just moved to.
  task: {
    paddingVertical: S.l,
  },
  // The last place a rule still earns its keep: quest history rows are
  // the only list on this tab with no bar of their own, so without this
  // they run together.
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
  // The standing's row styles live with BoardRow (components/ui) now,
  // shared with the fullscreen "see all" board. What stays here is the
  // card-only chrome.
  //
  // YOU: the same row as everyone else, set apart by a gap rather than
  // by being built differently. The tinted rounded card it used to sit
  // in made your own standing read as a header ABOUT the board instead
  // of a line IN it.
  boardYouRow: {
    // Set apart by air alone. A rule here read as one more of the
    // hairlines that used to run between every row, rather than as the
    // one meaningful break on the card.
    marginBottom: S.l,
  },
  // Same affordance as the carousel's "N / M" counter link — the app's
  // one established way of saying "there is a fullscreen version".
  boardSeeAll: {
    fontSize: TYPE.small,
    fontWeight: '700',
    // Ink, not web-hyperlink blue. Same fix the deck's counter link
    // got; this one was missed because it lives on the tasks tab
    // rather than in the card stack.
    color: INK,
    textDecorationLine: 'underline',
    textAlign: 'center',
    paddingVertical: S.m,
  },
  boardSeeAllPressed: { opacity: 0.55 },
  boardRowPressed: { opacity: 0.6 },
  boardEmpty: {
    fontSize: TYPE.small,
    color: '#777',
    paddingVertical: S.m,
  },
  // The daily tasks' progress bars. The standing used to share these —
  // its rows carried a bar each — but it draws silhouettes now, so the
  // track lives on for the tasks card alone.
  // Just the row the bar is drawn into now — the track and the fill are
  // both strokes inside it. See HandDrawnBar.
  barTrack: {
    height: 6,
  },
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
