import { useCallback, useEffect, useMemo } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../../constants/colors';
import { useGameStore } from '../../stores/gameStore';
import type { Spot, SpotCategory } from '../../services/places';
import { SYSTEM_FONT } from '../../constants/fonts';
import { useStrings } from '../../i18n/useStrings';
import type { AppStrings } from '../../i18n/strings';
import { SpotCardStack, SpotCardStackSkeleton } from '../../components/ui/SpotCardStack';

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
  const syncSpots = useGameStore((s) => s.syncSpots);
  const setSelectedSpot = useGameStore((s) => s.setSelectedSpot);

  useFocusEffect(useCallback(() => {
    useGameStore.getState().setScreen('spots');
  }, []));

  // Fetch on first visit with a GPS position, and refresh when position
  // shifts meaningfully. Places calls cost money and the list rarely
  // changes — avoid on every focus.
  useEffect(() => {
    if (!userPos) return;
    if (spots.length === 0) syncSpots(userPos);
  }, [userPos?.lat, userPos?.lng, spots.length, syncSpots]);

  // Group spots by category once per change. Map preserves insertion
  // order so we feed it CATEGORY_ORDER and the render walks it in
  // the same fixed sequence.
  const byCategory = useMemo(() => {
    const map = new Map<SpotCategory, Spot[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const s of spots) {
      const list = map.get(s.category);
      if (list) list.push(s);
    }
    return map;
  }, [spots]);

  const onPickSpot = useCallback(
    (s: Spot) => {
      setSelectedSpot(s.id);
      router.push('/');
    },
    [setSelectedSpot, router],
  );

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
  }, [spotsLoaded, spots.length === 0]);

  // Three view states drive the render:
  //   loading      — !spotsLoaded: show a skeleton snap card per
  //                  category so the snap order is stable from the
  //                  first paint, no late-arriving cards shoving the
  //                  layout around.
  //   empty        —  spotsLoaded && spots.length === 0: single
  //                   "nothing nearby" card.
  //   loaded       —  spotsLoaded && spots.length > 0: one snap card
  //                   per non-empty category, in CATEGORY_ORDER.
  const isLoading = !spotsLoaded;
  const isEmpty = spotsLoaded && spots.length === 0;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} style={styles.scroller}>
        {isLoading
          ? CATEGORY_ORDER.map((cat) => (
              <View key={cat} nativeID={`snap-card-spots-${cat}`} style={styles.card}>
                <Text style={styles.cardTitle}>{cardTitle(t, cat)}</Text>
                <SpotCardStackSkeleton />
              </View>
            ))
          : null}

        {isEmpty ? (
          <View nativeID="snap-card-spots-empty" style={styles.card}>
            <Text style={styles.cardTitle}>{t.spots.nearbySpots}</Text>
            <Text style={styles.placeholder}>
              {userPos ? t.spots.emptyAll : t.hud.locating}
            </Text>
          </View>
        ) : null}

        {!isLoading && !isEmpty
          ? CATEGORY_ORDER.map((cat) => {
              const list = byCategory.get(cat) ?? [];
              if (list.length === 0) return null;
              return (
                <View key={cat} nativeID={`snap-card-spots-${cat}`} style={styles.card}>
                  <Text style={styles.cardTitle}>{cardTitle(t, cat)}</Text>
                  <SpotCardStack spots={list} onTap={onPickSpot} />
                </View>
              );
            })
          : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.greyBg },
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
  content: { paddingHorizontal: 16, paddingTop: 32, paddingBottom: 140, gap: 60 },
  // Snap block — no white card frame. Title + category stack
  // sit straight on the page bg.
  card: {
    paddingHorizontal: 4,
    scrollSnapAlign: 'start',
    scrollSnapStop: 'always',
  } as unknown as object,
  // Card titles bumped to match the tasks-tab cardTitle — 17pt,
  // weight 800, colours.black. Were too quiet at 14/grey.
  cardTitle: {
    fontFamily: SYSTEM_FONT,
    fontSize: 17,
    fontWeight: '800',
    color: colors.black,
    marginBottom: 12,
    textTransform: 'lowercase',
    letterSpacing: 0.2,
  },
  placeholder: { fontSize: 13, color: '#777', paddingVertical: 8 },
});
