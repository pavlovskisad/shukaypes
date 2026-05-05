import { useCallback, useEffect, useMemo } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../../constants/colors';
import { useGameStore } from '../../stores/gameStore';
import type { Spot, SpotCategory } from '../../services/places';
import { SYSTEM_FONT } from '../../constants/fonts';
import { Icon, iconForCategory, type IconName } from '../../components/ui/Icon';

const CATEGORY_LABEL: Record<string, string> = {
  cafe: 'cafe',
  restaurant: 'eat',
  bar: 'drink',
  pet_store: 'pet shop',
  veterinary_care: 'vet',
};

type FilterValue = 'all' | SpotCategory;

interface FilterOption {
  value: FilterValue;
  label: string;
  // Either iconName for the pixel <Icon> or icon (emoji fallback).
  // 'all' + 'cafe' don't have custom icons yet.
  iconName?: IconName;
  icon: string;
}

// Order + glyphs match VISIT_CATEGORY_ACTIONS / CATEGORY_EMOJI in
// services/places.ts so the filter chip, the map marker, and the
// radial menu all use the same glyph for each category. "all" is the
// only synthetic chip and gets a neutral sparkle.
const FILTERS: FilterOption[] = [
  { value: 'all', label: 'all', iconName: 'all', icon: '✨' },
  { value: 'cafe', label: 'cafe', iconName: 'cafe', icon: '☕' },
  { value: 'restaurant', label: 'eat', iconName: 'restaurant', icon: '🍜' },
  { value: 'bar', label: 'drink', iconName: 'bar', icon: '🍹' },
  { value: 'pet_store', label: 'pet shop', iconName: 'pet_store', icon: '🐶' },
  { value: 'veterinary_care', label: 'vet', iconName: 'vet', icon: '⛑️' },
];

export default function SpotsScreen() {
  const router = useRouter();
  const userPos = useGameStore((s) => s.userPosition);
  const spots = useGameStore((s) => s.spots);
  const loading = useGameStore((s) => s.spotsLoading);
  const syncSpots = useGameStore((s) => s.syncSpots);
  const setSelectedSpot = useGameStore((s) => s.setSelectedSpot);
  const filter = useGameStore((s) => s.spotsCategoryFilter);
  const setFilter = useGameStore((s) => s.setSpotsCategoryFilter);

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

  // Counts per category drive the chip badges so the user sees how
  // many spots a filter would yield without tapping it. Computed once
  // per spots-array change.
  const categoryCounts = useMemo(() => {
    const counts: Partial<Record<FilterValue, number>> = { all: spots.length };
    for (const s of spots) {
      counts[s.category] = (counts[s.category] ?? 0) + 1;
    }
    return counts;
  }, [spots]);

  const visibleSpots = useMemo(
    () => (filter === 'all' ? spots : spots.filter((s) => s.category === filter)),
    [spots, filter],
  );

  const onPickSpot = (s: Spot) => {
    setSelectedSpot(s.id);
    router.push('/');
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Filter chips. Horizontal scroll so all six fit on a narrow
            screen without wrapping into the next row. Counts come
            from the loaded spots so the chip already tells you what
            tapping it will yield. */}
        {spots.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filtersRow}
          >
            {FILTERS.map((opt) => {
              const active = filter === opt.value;
              const count = categoryCounts[opt.value] ?? 0;
              const muted = count === 0 && opt.value !== 'all';
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => setFilter(opt.value)}
                  disabled={muted}
                  style={({ pressed }) => [
                    styles.filterChip,
                    active && styles.filterChipActive,
                    muted && styles.filterChipMuted,
                    pressed && !muted && { opacity: 0.7 },
                  ]}
                >
                  {opt.iconName ? (
                    <Icon name={opt.iconName} size={18} opacity={muted ? 0.55 : 1} />
                  ) : (
                    <Text style={[styles.filterChipIcon, muted && styles.filterChipMutedText]}>
                      {opt.icon}
                    </Text>
                  )}
                  <Text
                    style={[
                      styles.filterChipLabel,
                      active && styles.filterChipLabelActive,
                      muted && styles.filterChipMutedText,
                    ]}
                  >
                    {opt.label}
                  </Text>
                  <Text
                    style={[
                      styles.filterChipCount,
                      active && styles.filterChipCountActive,
                      muted && styles.filterChipMutedText,
                    ]}
                  >
                    {count}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {/* Same frosted-card recipe as profile.tsx — greyBg root, one
            white card per group with shadowed lift, hairline-divided
            rows inside. Empty / loading / error states get their own
            small card so the screen never feels empty. */}
        {!userPos ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>nearby spots</Text>
            <Text style={styles.placeholder}>locating…</Text>
          </View>
        ) : loading && spots.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>nearby spots</Text>
            <ActivityIndicator style={{ marginTop: 12 }} />
          </View>
        ) : spots.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>nearby spots</Text>
            <Text style={styles.placeholder}>
              nothing within 800m — walk somewhere and pull back
            </Text>
          </View>
        ) : visibleSpots.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>nearby spots</Text>
            <Text style={styles.placeholder}>
              no {CATEGORY_LABEL[filter] ?? filter} nearby — try another filter
            </Text>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {filter === 'all'
                ? 'nearby spots'
                : `nearby ${CATEGORY_LABEL[filter] ?? filter}`}
            </Text>
            {visibleSpots.map((s, i) => (
              <Pressable
                key={s.id}
                onPress={() => onPickSpot(s)}
                style={({ pressed }) => [
                  styles.row,
                  i > 0 && styles.rowDivider,
                  pressed && { opacity: 0.6 },
                ]}
              >
                <View style={styles.icon}>
                  {(() => {
                    const slot = iconForCategory(s.category);
                    return slot ? (
                      <Icon name={slot} size={26} />
                    ) : (
                      <Text style={styles.iconText}>{s.icon}</Text>
                    );
                  })()}
                </View>
                <View style={styles.body}>
                  <Text style={styles.name} numberOfLines={1}>
                    {s.name}
                  </Text>
                  <View style={styles.metaRow}>
                    <Text style={styles.meta}>
                      {CATEGORY_LABEL[s.category] ?? s.category}
                    </Text>
                    {typeof s.rating === 'number' ? (
                      <Text style={styles.meta}>· ⭐ {s.rating.toFixed(1)}</Text>
                    ) : null}
                  </View>
                  {s.address ? (
                    <Text style={styles.addr} numberOfLines={1}>
                      {s.address}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </View>
        )}
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
  placeholder: { fontSize: 13, color: '#777', paddingVertical: 8 },
  filtersRow: {
    paddingHorizontal: 4,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 1,
  },
  filterChipActive: {
    backgroundColor: 'rgba(0,60,255,0.85)',
  },
  filterChipMuted: {
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  filterChipIcon: { fontSize: 14 },
  filterChipLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.black,
  },
  filterChipLabelActive: { color: '#fff' },
  filterChipCount: {
    fontSize: 11,
    fontWeight: '700',
    color: '#999',
  },
  filterChipCountActive: { color: 'rgba(255,255,255,0.85)' },
  filterChipMutedText: { color: '#bbb' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  rowDivider: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#f0f0f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: { fontSize: 20 },
  body: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '700', color: colors.black },
  metaRow: { flexDirection: 'row', gap: 6, marginTop: 2 },
  meta: { fontSize: 12, color: '#777' },
  addr: { fontSize: 12, color: '#999', marginTop: 4 },
});
