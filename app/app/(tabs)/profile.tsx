import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../../constants/colors';
import { SYSTEM_FONT } from '../../constants/fonts';
import { useGameStore } from '../../stores/gameStore';
import { api } from '../../services/api';

// Basic stats card for v1 — no skins grid yet (deferred). Pulls
// aggregate counts from /profile/me on focus, with the live game
// store values for hunger/happiness so the meter pills there stay
// in sync with the HUD without a second fetch.

interface ProfileData {
  user: {
    id: string;
    username: string;
    createdAt: string;
    points: number;
    totalTokens: number;
    totalDistanceMeters: number;
  };
  companion: {
    name: string;
    level: number;
    xp: number;
    hunger: number;
    happiness: number;
  };
  stats: {
    daysPlayed: number;
    pawsCollected: number;
    bonesEaten: number;
    petsSearched: number;
    questsCompleted: number;
    questsAbandoned: number;
    sightingsReported: number;
  };
}

function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

function StatRow({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  const companionName = useGameStore((s) => s.companionName);
  const [data, setData] = useState<ProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      const fresh = (await api.getProfile()) as ProfileData | { error: string };
      if ('error' in fresh) {
        setError(fresh.error);
        return;
      }
      setData(fresh);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      useGameStore.getState().setScreen('profile');
      void refetch();
    }, [refetch])
  );

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Companion card — name, level, mood. */}
        <View style={styles.card}>
          <Text style={styles.companionEmoji}>🐶</Text>
          <Text style={styles.companionName}>{data?.companion.name ?? companionName}</Text>
          <Text style={styles.companionMeta}>
            level {data?.companion.level ?? 1} · {data?.companion.xp ?? 0} xp
          </Text>
          <View style={styles.meterRow}>
            <View style={styles.meterPill}>
              <Text style={styles.meterEmoji}>☀️</Text>
              <Text style={styles.meterValue}>
                {Math.round(data?.companion.happiness ?? 0)}%
              </Text>
            </View>
            <View style={styles.meterPill}>
              <Text style={styles.meterEmoji}>🦴</Text>
              <Text style={styles.meterValue}>{Math.round(data?.companion.hunger ?? 0)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>walks together</Text>
          <StatRow label="days played" value={data?.stats.daysPlayed ?? '—'} />
          <StatRow
            label="distance walked"
            value={data ? formatDistance(data.user.totalDistanceMeters) : '—'}
          />
          <StatRow label="paws collected" value={data?.stats.pawsCollected ?? '—'} />
          <StatRow label="bones eaten" value={data?.stats.bonesEaten ?? '—'} />
          <StatRow label="points" value={data?.user.points ?? '—'} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>helping pets</Text>
          <StatRow label="pets searched" value={data?.stats.petsSearched ?? '—'} />
          <StatRow label="searches completed" value={data?.stats.questsCompleted ?? '—'} />
          <StatRow label="sightings reported" value={data?.stats.sightingsReported ?? '—'} />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.greyBg,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 100,
    gap: 12,
  },
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
  companionEmoji: {
    fontSize: 44,
    textAlign: 'center',
  },
  companionName: {
    fontFamily: SYSTEM_FONT,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 4,
  },
  companionMeta: {
    fontSize: 13,
    color: '#777',
    textAlign: 'center',
    marginTop: 2,
    marginBottom: 14,
  },
  meterRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  meterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,255,0.06)',
  },
  meterEmoji: {
    fontSize: 14,
  },
  meterValue: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.black,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  statLabel: {
    fontSize: 14,
    color: '#555',
  },
  statValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.black,
  },
  error: {
    fontSize: 12,
    color: '#a33',
    textAlign: 'center',
    marginTop: 8,
  },
});
