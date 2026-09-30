import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../../constants/colors';
import { useGameStore } from '../../stores/gameStore';
import { useAccessStore } from '../../stores/accessStore';
import type { Spot, SpotCategory } from '../../services/places';
import { SYSTEM_FONT } from '../../constants/fonts';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
import { useStrings } from '../../i18n/useStrings';
import type { AppStrings } from '../../i18n/strings';
import { SpotCardStack, SpotCardStackSkeleton } from '../../components/ui/SpotCardStack';
import { SpotsCategoryModal } from '../../components/ui/SpotsCategoryModal';
import { SwipeHintCallout } from '../../components/ui/SwipeHintCallout';
import { distanceMeters } from '../../utils/geo';
import { useHint } from '../../hooks/useHint';
import type { LoreFavourite } from '../../services/api';
import { CardStack } from '../../components/ui/CardStack';
import { LoreFavouriteCard } from '../../components/ui/LoreFavouriteCard';

// Fixed display order — matches the FILTERS chip order from the
// previous tab layout so users coming from older sessions land on
// familiar category sequencing. Each non-empty category becomes a
// snap card on the tab, in this order.
const CATEGORY_ORDER: SpotCategory[] = [
  'cafe',
  'restaurant',
  'bar',
  'pet_store',
  'veterinary_care',
];

// Map each Places category to its filter-strings label key — the
// filter labels are pluralised/verb-y forms ("кав'ярні", "поїсти",
// "ветеринари") that read naturally in the "X поряд" title.
// The card body still uses the singular modals.spot.categories
// for the chip label.
const CATEGORY_TITLE_KEY: Record<SpotCategory, keyof AppStrings['spots']['filters']> = {
  cafe: 'cafe',
  restaurant: 'eat',
  bar: 'drink',
  pet_store: 'pet_shop',
  veterinary_care: 'vet',
};

function cardTitle(t: ReturnType<typeof useStrings>, cat: SpotCategory): string {
  // Just the category label — "поряд" is implied by the screen
  // context, no need to repeat it on every card title.
  return t.spots.filters[CATEGORY_TITLE_KEY[cat]];
}

export default function SpotsScreen() {
  const t = useStrings();
  const router = useRouter();
  const userPos = useGameStore((s) => s.userPosition);
  const spots = useGameStore((s) => s.spots);
  const spotsLoaded = useGameStore((s) => s.spotsLoaded);
  const spotsLoading = useGameStore((s) => s.spotsLoading);
  const spotsError = useGameStore((s) => s.spotsError);
  const syncSpots = useGameStore((s) => s.syncSpots);
  const setSelectedSpot = useGameStore((s) => s.setSelectedSpot);
  // Category whose "see all" fullscreen modal is currently open.
  // null when no modal is showing.
  const [expandedCategory, setExpandedCategory] = useState<SpotCategory | null>(null);

  useFocusEffect(useCallback(() => {
    useGameStore.getState().setScreen('spots');
    // Fresh on every visit: a heart tapped on the map a minute ago is
    // already in the store optimistically, and this catches up on
    // anything saved from another device.
    void useGameStore.getState().loadLoreFavourites();
  }, []));

  // The "see all" sheet is portalled over everything, so it would stay
  // painted over whichever tab the user left for. Leaving the tab closes
  // it (UX-2.5).
  useFocusEffect(useCallback(() => () => setExpandedCategory(null), []));

  // The hearted landmarks, newest first, at the top of the tab. Tapping
  // one hands it to the map as a one-shot focus and switches tabs; the
  // sniff bubble shows it as if the dog had just found it.
  const favourites = useGameStore((s) => s.loreFavourites);
  const favouritesLoaded = useGameStore((s) => s.loreFavouritesLoaded);
  const favouritesError = useGameStore((s) => s.loreFavouritesError);
  // A retry of a failed favourites load in flight. The store keeps
  // `loaded` true through it (the map's hearts read that flag and would
  // fire a second load), so the skeleton rides on this instead.
  const [favRetrying, setFavRetrying] = useState(false);
  const retryFavourites = useCallback(() => {
    setFavRetrying(true);
    void useGameStore
      .getState()
      .loadLoreFavourites()
      .finally(() => setFavRetrying(false));
  }, []);
  const setFocusedLore = useGameStore((s) => s.setFocusedLore);
  const onPickFavourite = useCallback(
    (f: LoreFavourite) => {
      setFocusedLore(f);
      router.push('/');
    },
    [setFocusedLore, router],
  );
  // useCallback-stable so CardStack's memoed slot doesn't see a new
  // renderCard on every render — same reason as SpotCardStack.
  const renderFavourite = useCallback(
    (f: LoreFavourite) => <LoreFavouriteCard place={f} userPos={userPos} />,
    [userPos],
  );

  // Fetch on first visit with a GPS position, and refresh when position
  // shifts meaningfully. Places calls cost money and the list rarely
  // changes — avoid on every focus.
  useEffect(() => {
    if (!userPos) return;
    if (spots.length === 0) syncSpots(userPos);
  }, [userPos?.lat, userPos?.lng, spots.length, syncSpots]);

  // Group spots by category, then sort each list by distance from
  // the user so the closest spot is the first card in the carousel
  // (and the top of the "see all" modal feed). No GPS yet → keep
  // server order. Map preserves insertion order so we feed it
  // CATEGORY_ORDER and the render walks it in the same fixed
  // sequence.
  // Sorted from a ~110m grid point, as the quests tab sorts its pets. On
  // the raw position the carousels and the "see all" feed re-sorted on
  // every GPS fix, so two places at a similar distance kept trading
  // places under the user's thumb. The distances on the cards still read
  // the live position.
  const latBucket = userPos ? Math.round(userPos.lat * 1000) / 1000 : null;
  const lngBucket = userPos ? Math.round(userPos.lng * 1000) / 1000 : null;
  const byCategory = useMemo(() => {
    const map = new Map<SpotCategory, Spot[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const s of spots) {
      const list = map.get(s.category);
      if (list) list.push(s);
    }
    if (latBucket != null && lngBucket != null) {
      const from = { lat: latBucket, lng: lngBucket };
      for (const list of map.values()) {
        list.sort(
          (a, b) =>
            distanceMeters(from, a.position) -
            distanceMeters(from, b.position),
        );
      }
    }
    return map;
  }, [spots, latBucket, lngBucket]);

  const onPickSpot = useCallback(
    (s: Spot) => {
      // Leave the cold-start gate first (door open only), or answering
      // its ring on arrival runs the clear-slate reducer and drops the
      // selection. Same rule as leaveGateForAction in chat.tsx.
      const g = useGameStore.getState();
      if (g.appMode === 'gate' && useAccessStore.getState().door === 'open') {
        g.setAppMode('explore');
        g.setMenuOpen(false);
      }
      setSelectedSpot(s.id);
      router.push('/');
    },
    [setSelectedSpot, router],
  );

  // First category whose deck has more than one card — that's where the
  // swipe nudge rides. Shares the 'cards:swipe' id with the dogs deck,
  // so it shows on whichever carousel the user reaches first, not both.
  const firstSwipeCat = useMemo(
    () => CATEGORY_ORDER.find((cat) => (byCategory.get(cat)?.length ?? 0) > 1) ?? null,
    [byCategory],
  );
  const currentScreen = useGameStore((s) => s.currentScreen);
  const swipeHint = useHint('cards:swipe', {
    ready: currentScreen === 'spots' && firstSwipeCat != null,
    showDelayMs: 900,
    autoDismissMs: 5000,
    persist: false,
  });

  // Four view states drive the render:
  //   loading      — !spotsLoaded, or a retry in flight with nothing
  //                  cached: show a skeleton snap card per category so
  //                  the snap order is stable from the first paint, no
  //                  late-arriving cards shoving the layout around.
  //   failed       —  settled on an error with nothing cached: one
  //                   "couldn't load, tap to retry" card. Not the empty
  //                   card — offline, "nothing nearby" is a guess.
  //   empty        —  settled fine with spots.length === 0: single
  //                   "nothing nearby" card.
  //   loaded       —  spots.length > 0: one snap card per non-empty
  //                   category, in CATEGORY_ORDER.
  const isLoading = !spotsLoaded || (spotsLoading && spots.length === 0);
  const isFailed = !isLoading && spotsError && spots.length === 0;
  const isEmpty = !isLoading && !spotsError && spots.length === 0;

  // Snap-pop on dominant card change — same IntersectionObserver +
  // Web Animations pattern as the tasks tab. Cards have stable
  // nativeIDs like snap-card-spots-cafe so the observer can find
  // them across data swaps.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (typeof IntersectionObserver === 'undefined') return;

    let isInitial = true;
    const initTimer = setTimeout(() => {
      isInitial = false;
    }, 600);

    let observer: IntersectionObserver | null = null;
    let lastDominant: Element | null = null;

    const playPop = (el: HTMLElement) => {
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
      const cards = Array.from(document.querySelectorAll<HTMLElement>('[id^="snap-card-spots-"]'));
      if (cards.length === 0) return false;

      const ratios = new Map<Element, number>();
      cards.forEach((c) => ratios.set(c, 0));

      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => ratios.set(e.target, e.intersectionRatio));
          let dominant: Element | null = null;
          let best = -1;
          ratios.forEach((r, el) => {
            if (r > best) {
              best = r;
              dominant = el;
            }
          });
          if (dominant && dominant !== lastDominant && best > 0.6) {
            if (!isInitial) playPop(dominant as HTMLElement);
            lastDominant = dominant;
          }
        },
        { threshold: [0, 0.3, 0.5, 0.7, 0.9, 1] },
      );

      cards.forEach((c) => observer!.observe(c));
      return true;
    };

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
    // isLoading too: a retry after a failed load swaps the failed card
    // for skeletons and back (or for the empty card) with neither of
    // the other two changing, and the observer would be left watching
    // nodes that are gone.
  }, [spotsLoaded, spots.length === 0, isLoading]);

  const retrySpots = useCallback(() => {
    if (userPos) void syncSpots(userPos);
  }, [userPos, syncSpots]);
  const favouritesPending = !favouritesLoaded || favRetrying;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} style={styles.scroller}>
        <View nativeID="snap-card-spots-favourites" style={styles.card}>
          <Text style={styles.cardTitle}>{t.spots.favourites}</Text>
          {/* Skeleton while the list loads (it used to show nothing, then
              pop in), the retry line when it failed, and only then the
              empty state. */}
          {favouritesPending && favourites.length === 0 ? <SpotCardStackSkeleton /> : null}
          {!favouritesPending && favourites.length === 0 ? (
            favouritesError ? (
              <Pressable onPress={retryFavourites} accessibilityRole="button">
                <Text style={styles.placeholder}>{t.connection.loadFailed}</Text>
              </Pressable>
            ) : (
              <Text style={styles.placeholder}>{t.spots.favouritesEmpty}</Text>
            )
          ) : null}
          {favourites.length > 0 ? (
            <View style={styles.deckWrap}>
              <CardStack
                items={favourites}
                getId={(f) => f.id}
                onTap={onPickFavourite}
                renderCard={renderFavourite}
              />
            </View>
          ) : null}
        </View>

        {isLoading
          ? CATEGORY_ORDER.map((cat) => (
              <View key={cat} nativeID={`snap-card-spots-${cat}`} style={styles.card}>
                <Text style={styles.cardTitle}>{cardTitle(t, cat)}</Text>
                <SpotCardStackSkeleton />
              </View>
            ))
          : null}

        {isFailed ? (
          <View nativeID="snap-card-spots-empty" style={styles.card}>
            <Text style={styles.cardTitle}>{t.spots.nearbySpots}</Text>
            <Pressable onPress={retrySpots} accessibilityRole="button">
              <Text style={styles.placeholder}>{t.connection.loadFailed}</Text>
            </Pressable>
          </View>
        ) : null}

        {isEmpty ? (
          <View nativeID="snap-card-spots-empty" style={styles.card}>
            <Text style={styles.cardTitle}>{t.spots.nearbySpots}</Text>
            <Text style={styles.placeholder}>
              {userPos ? t.spots.emptyAll : t.hud.locating}
            </Text>
          </View>
        ) : null}

        {!isLoading && spots.length > 0
          ? CATEGORY_ORDER.map((cat) => {
              const list = byCategory.get(cat) ?? [];
              if (list.length === 0) return null;
              const showSwipe = cat === firstSwipeCat && swipeHint.visible;
              return (
                <View key={cat} nativeID={`snap-card-spots-${cat}`} style={styles.card}>
                  <Text style={styles.cardTitle}>{cardTitle(t, cat)}</Text>
                  <View style={styles.deckWrap}>
                    <SpotCardStack
                      spots={list}
                      onTap={onPickSpot}
                      onCounterTap={() => setExpandedCategory(cat)}
                      onSwipe={swipeHint.dismiss}
                    />
                    {showSwipe ? <SwipeHintCallout text={t.hints.swipeCards} /> : null}
                  </View>
                </View>
              );
            })
          : null}
      </ScrollView>

      <SpotsCategoryModal
        spots={expandedCategory ? byCategory.get(expandedCategory) ?? [] : null}
        onClose={() => setExpandedCategory(null)}
        onPick={(spot) => {
          setExpandedCategory(null);
          onPickSpot(spot);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#ffffff' },
  // Same snap-scroll setup as the tasks tab — see tasks.tsx for the
  // longer explanation of why scrollPaddingTop has to match the
  // contentContainer's paddingTop.
  scroller: {
    flex: 1,
    scrollSnapType: 'y mandatory',
    // 60 → 32 to lift the snapped card higher and free up bottom
    // room for the next card's title to peek above the tab bar.
    // See tasks.tsx for the longer reasoning.
    scrollPaddingTop: 32,
  } as unknown as object,
  content: {
    paddingHorizontal: S.l,
    paddingTop: S.xxxl,
    // Generous bottom padding so any last category card can
    // snap to the top, even if its content is short. Without
    // this, a small last card (e.g. a category with only 2
    // spots) couldn't scroll up to the snap position because
    // the page didn't have enough room below it.
    paddingBottom: 'calc(100vh - 200px)' as unknown as number,
    gap: 60,
  },
  // Snap block — no white card frame. Title + category stack
  // sit straight on the page bg.
  card: {
    paddingHorizontal: S.xs,
    scrollSnapAlign: 'start',
    scrollSnapStop: 'always',
  } as unknown as object,
  // Relative wrapper so the swipe-hint callout can overlay the deck.
  deckWrap: {
    position: 'relative',
  },
  // Card titles bumped to match the tasks-tab cardTitle — 17pt,
  // weight 700, colours.black. Were too quiet at 14/grey.
  cardTitle: {
    fontFamily: SYSTEM_FONT,
    fontSize: TYPE.title,
    fontWeight: '700',
    color: colors.black,
    marginBottom: S.m,
    textTransform: 'lowercase',
    letterSpacing: 0.2,
  },
  placeholder: { fontSize: TYPE.small, color: '#777', paddingVertical: S.s },
});
