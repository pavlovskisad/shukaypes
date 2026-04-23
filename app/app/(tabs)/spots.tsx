import { useCallback, useEffect } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
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
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>nearby spots</Text>
      {!userPos ? (
        <Text style={styles.placeholder}>locating…</Text>
      ) : loading && spots.length === 0 ? (
        <ActivityIndicator style={{ marginTop: 24 }} />
      ) : spots.length === 0 ? (
        <Text style={styles.placeholder}>nothing within 800m — walk somewhere and pull back</Text>
      ) : (
        spots.map((s) => (
          <Pressable key={s.id} style={styles.card} onPress={() => onPickSpot(s)}>
            <View style={styles.icon}><Text style={styles.iconText}>{s.icon}</Text></View>
            <View style={styles.body}>
              <Text style={styles.name} numberOfLines={1}>{s.name}</Text>
              <View style={styles.metaRow}>
                <Text style={styles.meta}>{CATEGORY_LABEL[s.category] ?? s.category}</Text>
                {typeof s.rating === 'number' ? (
                  <Text style={styles.meta}>· ⭐ {s.rating.toFixed(1)}</Text>
                ) : null}
              </View>
              {s.address ? (
                <View style={styles.addrPill}>
                  <Text style={styles.addr} numberOfLines={1}>📍 {s.address}</Text>
                </View>
              ) : null}
            </View>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  content: { padding: 16, paddingBottom: 120 },
  title: {
    fontFamily: SYSTEM_FONT,
    fontSize: 26,
    color: colors.black,
    marginBottom: 14,
    marginTop: 8,
  },
  placeholder: { fontSize: 13, color: colors.grey, marginTop: 12 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.greyBg,
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
    gap: 12,
  },
  icon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: { fontSize: 24 },
  body: { flex: 1, minWidth: 0 },
  name: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.black,
  },
  metaRow: { flexDirection: 'row', gap: 6, marginTop: 2 },
  meta: { fontSize: 12, color: colors.grey },
  addrPill: {
    marginTop: 6,
    backgroundColor: colors.white,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  addr: { fontSize: 12, fontFamily: SYSTEM_FONT, color: colors.black },
});
