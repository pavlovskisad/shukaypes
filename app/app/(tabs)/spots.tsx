import { useCallback, useEffect } from 'react';
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
import type { Spot } from '../../services/places';
import { SYSTEM_FONT } from '../../constants/fonts';

const CATEGORY_LABEL: Record<string, string> = {
  cafe: 'cafe',
  restaurant: 'eat',
  bar: 'drink',
  pet_store: 'doggos',
  veterinary_care: 'vet',
};

export default function SpotsScreen() {
  const router = useRouter();
  const userPos = useGameStore((s) => s.userPosition);
  const spots = useGameStore((s) => s.spots);
  const loading = useGameStore((s) => s.spotsLoading);
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

  const onPickSpot = (s: Spot) => {
    setSelectedSpot(s.id);
    router.push('/');
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
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
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>nearby spots</Text>
            {spots.map((s, i) => (
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
                  <Text style={styles.iconText}>{s.icon}</Text>
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
